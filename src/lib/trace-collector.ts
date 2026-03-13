/**
 * trace-collector.ts — Structured conversation trace emission (US-427)
 *
 * Emits one JSON trace per pipeline turn capturing tier, intent, LLM provider,
 * token usage, and stage latencies. Supports two backends:
 *   - "db"   → writes to `conversation_traces` table (default)
 *   - "file" → appends JSONL to logs/traces.jsonl
 *
 * Emission is always fire-and-forget — never blocks the response path.
 *
 * T1 regex matches are suppressed unless traces.debug_mode = true.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { conversationTraces } from '../../shared/schema-tables.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface TraceEvent {
  trace_id: string;
  jid: string;
  profile_id: string;
  tier: 'T1' | 'T2' | 'T3' | 'T4';
  intent: string | null;
  llm_provider: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  stage_latencies: {
    classification_ms: number;
    llm_ms: number;
    total_ms: number;
  };
  error?: string;
}

export interface TraceConfig {
  enabled: boolean;
  backend: 'db' | 'file';
  debug_mode: boolean;
}

// ─── Tier derivation ────────────────────────────────────────────────

/**
 * Derive T1-T4 tier label from devMetadata.source string.
 *
 * Source values (set in tier-classification.ts):
 *   'regex'              → T1 (no LLM)
 *   'fuzzy'              → T2
 *   'fuzzy+llm-reply'    → T2 (fuzzy classify + LLM reply)
 *   'semantic'           → T3
 *   'semantic+llm-reply' → T3
 *   'split-model-fast'   → T3 (split model, fast path)
 *   'split-model'        → T4 (split model with LLM reply)
 *   'tiered-llm-fallback'→ T4
 *   'llm'                → T4 (default mode)
 *   anything else        → T4
 */
export function deriveTier(source: string | undefined): 'T1' | 'T2' | 'T3' | 'T4' {
  if (!source) return 'T4';
  if (source === 'regex') return 'T1';
  if (source.startsWith('fuzzy')) return 'T2';
  if (source.startsWith('semantic') || source === 'split-model-fast') return 'T3';
  return 'T4';
}

/** Extract LLM provider name from model string (e.g. "moonshotai/kimi-k2.5" → "nvidia-kimi") */
function extractProvider(model: string | undefined): string | null {
  if (!model || model === 'none (tiered)') return null;
  if (model.includes('kimi')) return 'nvidia-kimi';
  if (model.includes('gemini')) return 'google-gemini';
  if (model.includes('groq') || model.includes('llama') || model.includes('qwen')) return 'groq';
  if (model.includes('ollama')) return 'ollama';
  if (model.includes('openrouter')) return 'openrouter';
  return model.split('/')[0] || model;
}

// ─── JSONL file backend ─────────────────────────────────────────────

const JSONL_PATH = path.join(process.cwd(), 'logs', 'traces.jsonl');

function appendToFile(event: TraceEvent): void {
  try {
    fs.mkdirSync(path.dirname(JSONL_PATH), { recursive: true });
    fs.appendFileSync(JSONL_PATH, JSON.stringify(event) + '\n', 'utf-8');
  } catch (err: any) {
    console.warn(`[TraceCollector] JSONL write failed: ${err.message}`);
  }
}

// ─── DB backend ─────────────────────────────────────────────────────

async function insertToDb(event: TraceEvent): Promise<void> {
  await db.insert(conversationTraces).values({
    traceId: event.trace_id,
    jid: event.jid,
    profileId: event.profile_id,
    tier: event.tier,
    intent: event.intent,
    llmProvider: event.llm_provider,
    model: event.model,
    promptTokens: event.prompt_tokens,
    completionTokens: event.completion_tokens,
    classificationMs: event.stage_latencies.classification_ms,
    llmMs: event.stage_latencies.llm_ms,
    totalMs: event.stage_latencies.total_ms,
    error: event.error ?? null,
  });
}

// ─── Main emit function ─────────────────────────────────────────────

/**
 * Emit a structured trace event for one pipeline turn.
 * Always fire-and-forget — never awaited by callers.
 *
 * @param params - Trace data from PipelineState and DevMetadata
 * @param config - Traces configuration from settings.json
 */
export function emitTrace(
  params: {
    jid: string;
    profileId: string;
    devMetadataSource: string | undefined;
    intent: string | null | undefined;
    model: string | undefined;
    promptTokens: number | undefined;
    completionTokens: number | undefined;
    responseTimeMs: number | undefined;
    traceStart: number;
    error?: string;
  },
  config: TraceConfig
): void {
  if (!config.enabled) return;

  const tier = deriveTier(params.devMetadataSource);

  // Suppress T1 regex matches unless debug_mode is enabled
  if (tier === 'T1' && !config.debug_mode) return;

  const totalMs = Math.round(performance.now() - params.traceStart);
  const llmMs = params.responseTimeMs ?? 0;
  // For T1/T2 fast-path, classification_ms ≈ total time; for T3/T4 LLM calls, responseTime is the LLM time
  const classificationMs = tier === 'T4' || tier === 'T3' ? Math.max(0, totalMs - llmMs) : llmMs;

  const event: TraceEvent = {
    trace_id: randomUUID(),
    jid: params.jid,
    profile_id: params.profileId,
    tier,
    intent: params.intent ?? null,
    llm_provider: extractProvider(params.model),
    model: params.model ?? null,
    prompt_tokens: params.promptTokens ?? null,
    completion_tokens: params.completionTokens ?? null,
    stage_latencies: {
      classification_ms: classificationMs,
      llm_ms: llmMs,
      total_ms: totalMs,
    },
    ...(params.error ? { error: params.error } : {}),
  };

  // Fire-and-forget: run asynchronously after response is sent
  if (config.backend === 'file') {
    setImmediate(() => appendToFile(event));
  } else {
    setImmediate(() => {
      insertToDb(event).catch((err: any) => {
        console.warn(`[TraceCollector] DB insert failed: ${err.message}`);
        // Fallback to file on DB error
        appendToFile(event);
      });
    });
  }
}

// ─── Query helper (for admin API) ───────────────────────────────────

export interface TraceQueryOptions {
  jid?: string;
  limit?: number;
}

export async function queryTraces(opts: TraceQueryOptions): Promise<any[]> {
  const { jid, limit = 50 } = opts;
  const safeLimit = Math.min(limit, 500);

  const rows = await db
    .select()
    .from(conversationTraces)
    .orderBy(conversationTraces.createdAt)
    .limit(safeLimit);

  // Filter by JID in JS (avoids importing `eq` from drizzle in this module)
  const filtered = jid ? rows.filter(r => r.jid === jid) : rows;

  return filtered.reverse().map(r => ({
    id: r.id,
    trace_id: r.traceId,
    jid: r.jid,
    profile_id: r.profileId,
    tier: r.tier,
    intent: r.intent,
    llm_provider: r.llmProvider,
    model: r.model,
    prompt_tokens: r.promptTokens,
    completion_tokens: r.completionTokens,
    stage_latencies: {
      classification_ms: r.classificationMs,
      llm_ms: r.llmMs,
      total_ms: r.totalMs,
    },
    error: r.error,
    created_at: r.createdAt,
  }));
}
