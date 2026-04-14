/**
 * US-619: Intent Classification Provider Latency Tracking with Timeout-Based Fallback
 *
 * Wraps AI provider classification calls with:
 * - AbortController-based timeout enforcement per-profile (default 5s)
 * - Latency measurement from request start to response
 * - Graceful fallback to keyword matching when provider timeout exceeded
 * - Logs timeout events to intent_analytics with profile, latency_ms, fallback_method
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { db } from '../../lib/db.js';
import { intentAnalytics } from '../../../shared/schema-tables.js';
import { createModuleLogger } from '../../lib/logger.js';

const logger = createModuleLogger('ClassifierT2');

/** Default provider timeout in milliseconds (5 seconds) */
const DEFAULT_PROVIDER_TIMEOUT_MS = 5000;

export interface T2ClassificationResult {
  intent: string;
  confidence: number;
  latencyMs: number;
  fallbackMethod: 'provider' | 'keyword';
  timedOut: boolean;
}

export interface T2ProviderOptions {
  profileId: string;
  /** Override timeout in ms; if not set, reads from settings.json providerTimeoutMs */
  timeoutMs?: number;
  /** Suppress analytics DB write (useful for tests that don't want DB) */
  skipAnalytics?: boolean;
}

interface KeywordIntentEntry {
  intent: string;
  keywords: Record<string, string[]>;
}

interface IntentKeywordsData {
  intents: KeywordIntentEntry[];
}

// ─── Keyword data loader (profile-aware, same pattern as intents.ts) ──────────

let defaultKeywordsCache: IntentKeywordsData | null = null;
const profileKeywordsCache = new Map<string, IntentKeywordsData>();

function loadKeywordsForProfile(profileId: string): IntentKeywordsData {
  if (profileKeywordsCache.has(profileId)) {
    return profileKeywordsCache.get(profileId)!;
  }

  const dataDir = join(process.cwd(), 'src', 'assistant', 'data');
  const profilePath = join(dataDir, `intent-keywords-${profileId}.json`);
  const defaultPath = join(dataDir, 'intent-keywords.json');

  let data: IntentKeywordsData | null = null;

  if (existsSync(profilePath)) {
    try {
      data = JSON.parse(readFileSync(profilePath, 'utf-8'));
      logger.debug(`[T2] Loaded profile-specific keywords for "${profileId}"`);
    } catch {
      // fall through to default
    }
  }

  if (!data) {
    if (!defaultKeywordsCache) {
      try {
        defaultKeywordsCache = JSON.parse(readFileSync(defaultPath, 'utf-8'));
      } catch {
        defaultKeywordsCache = { intents: [] };
      }
    }
    data = defaultKeywordsCache!;
  }

  profileKeywordsCache.set(profileId, data);
  return data;
}

// ─── Per-profile timeout config loader ────────────────────────────────────────

let settingsCache: Record<string, any> | null = null;

function getProviderTimeoutMs(profileId: string, overrideMs?: number): number {
  if (overrideMs !== undefined) return overrideMs;

  try {
    if (!settingsCache) {
      const settingsPath = join(process.cwd(), 'src', 'assistant', 'data', 'settings.json');
      settingsCache = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    }

    // Check per-profile first, then global
    const perProfile = settingsCache?.classification?.providerTimeoutMs?.[profileId];
    if (typeof perProfile === 'number') return perProfile;

    const global = settingsCache?.classification?.providerTimeoutMs?.default;
    if (typeof global === 'number') return global;
  } catch {
    // ignore, use default
  }

  return DEFAULT_PROVIDER_TIMEOUT_MS;
}

// ─── Keyword fallback classifier ──────────────────────────────────────────────

/**
 * Simple keyword fallback: scan all intents for any keyword that appears in text.
 * Returns the best-scoring match, or 'unknown' if none found.
 */
export function classifyByKeyword(
  text: string,
  profileId: string = 'pelangi'
): { intent: string; confidence: number } {
  const loweredText = text.toLowerCase();
  const data = loadKeywordsForProfile(profileId);

  let bestIntent = 'unknown';
  let bestScore = 0;

  for (const entry of data.intents) {
    const allKeywords = Object.values(entry.keywords).flat();
    for (const keyword of allKeywords) {
      const lowerKeyword = keyword.toLowerCase();
      // Require word-boundary match: keyword must not be an interior substring of another word.
      // Uses regex with word boundaries for ASCII keywords; falls back to exact includes for CJK.
      const isAscii = /^[\x00-\x7F]+$/.test(lowerKeyword);
      let matched = false;
      if (isAscii) {
        // Escape regex special chars in keyword
        const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        matched = new RegExp(`\\b${escaped}\\b`).test(loweredText);
      } else {
        // CJK / non-ASCII: exact substring match is acceptable (no word boundaries in CJK)
        matched = loweredText.includes(lowerKeyword);
      }

      if (matched) {
        // Scoring: longer keyword = more specific = higher confidence
        const score = lowerKeyword.length / Math.max(loweredText.length, 1);
        const normalized = Math.min(0.85, 0.5 + score * 2);
        if (normalized > bestScore) {
          bestScore = normalized;
          bestIntent = entry.intent;
        }
      }
    }
  }

  return { intent: bestIntent, confidence: bestScore > 0 ? bestScore : 0.1 };
}

// ─── Analytics logger (fire-and-forget) ──────────────────────────────────────

function logToAnalytics(
  profileId: string,
  intent: string,
  confidence: number,
  latencyMs: number,
  skipAnalytics: boolean
): void {
  if (skipAnalytics) return;

  db.insert(intentAnalytics)
    .values({ profileId, intentType: intent, confidence, latencyMs })
    .execute()
    .catch((err: any) =>
      logger.debug('t2-analytics-insert', { error: String(err) })
    );
}

// ─── Main export: providerTimeoutHandler ──────────────────────────────────────

/**
 * Wraps an AI provider classification call with timeout enforcement.
 *
 * On timeout:
 *   - Aborts the provider call via AbortController
 *   - Falls back to keyword matching from intent-keywords.json
 *   - Logs timeout event to intent_analytics
 *
 * @param providerFn - Async function that performs the AI provider call;
 *                     receives an AbortSignal to cancel on timeout
 * @param options    - Profile, timeout override, analytics toggle
 * @returns T2ClassificationResult with latency, fallback method, and intent
 */
export async function providerTimeoutHandler(
  providerFn: (signal: AbortSignal) => Promise<{ intent: string; confidence: number }>,
  text: string,
  options: T2ProviderOptions
): Promise<T2ClassificationResult> {
  const { profileId, skipAnalytics = false } = options;
  const timeoutMs = getProviderTimeoutMs(profileId, options.timeoutMs);

  const controller = new AbortController();
  const startTime = Date.now();

  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const providerResult = await providerFn(controller.signal);
    const latencyMs = Date.now() - startTime;

    clearTimeout(timeoutHandle);

    console.log(
      `[ClassifierT2-US619] Provider responded in ${latencyMs}ms ` +
      `(timeout=${timeoutMs}ms, profile=${profileId}, intent=${providerResult.intent})`
    );

    logToAnalytics(profileId, providerResult.intent, providerResult.confidence, latencyMs, skipAnalytics);

    return {
      intent: providerResult.intent,
      confidence: providerResult.confidence,
      latencyMs,
      fallbackMethod: 'provider',
      timedOut: false,
    };
  } catch (err: any) {
    clearTimeout(timeoutHandle);
    const latencyMs = Date.now() - startTime;

    const isTimeout = err?.name === 'AbortError' || controller.signal.aborted;

    if (isTimeout) {
      console.warn(
        `[ClassifierT2-US619] Provider timeout after ${latencyMs}ms ` +
        `(threshold=${timeoutMs}ms, profile=${profileId}) → keyword fallback`
      );

      const fallback = classifyByKeyword(text, profileId);

      // Log timeout event to analytics — intentType prefixed to distinguish from normal classifications
      logToAnalytics(profileId, `timeout:${fallback.intent}`, fallback.confidence, latencyMs, skipAnalytics);

      return {
        intent: fallback.intent,
        confidence: fallback.confidence,
        latencyMs,
        fallbackMethod: 'keyword',
        timedOut: true,
      };
    }

    // Non-timeout error: re-throw so caller handles it
    throw err;
  }
}

/** Clears caches — useful for tests that need fresh state */
export function clearT2Caches(): void {
  settingsCache = null;
  defaultKeywordsCache = null;
  profileKeywordsCache.clear();
}
