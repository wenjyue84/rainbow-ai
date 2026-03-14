/**
 * experiments.ts — A/B experiment framework for system prompt variants (US-837)
 *
 * Resolves which experiment variant a sender should see based on
 * deterministic hashing (MD5 of phone + experimentId).
 * Tracks per-variant metrics in the experiment_metrics DB table.
 */
import crypto from 'crypto';
import { db } from './db.js';
import { experimentMetrics } from '../../shared/schema-tables.js';
import { sql } from 'drizzle-orm';
import type { Experiment, ExperimentVariant } from '../assistant/schemas.js';

// ─── Variant Assignment ──────────────────────────────────────────────

/**
 * Deterministically assign a sender to an experiment variant.
 * Uses MD5(phone + experimentId) modulo total weight for stable assignment.
 * Returns null if no active experiment or only one variant.
 */
export function resolveVariant(
  phone: string,
  experiment: Experiment
): ExperimentVariant | null {
  if (!experiment.active || experiment.variants.length === 0) return null;
  if (experiment.variants.length === 1) return experiment.variants[0];

  const hash = crypto.createHash('md5')
    .update(phone + experiment.id)
    .digest('hex');

  // Take first 8 hex chars for a 32-bit integer range
  const hashInt = parseInt(hash.slice(0, 8), 16);
  const totalWeight = experiment.variants.reduce((sum, v) => sum + v.weight, 0);
  const bucket = hashInt % totalWeight;

  let cumulative = 0;
  for (const variant of experiment.variants) {
    cumulative += variant.weight;
    if (bucket < cumulative) return variant;
  }

  // Fallback (shouldn't happen)
  return experiment.variants[experiment.variants.length - 1];
}

/**
 * Find the first active experiment from the config and resolve
 * the system prompt override for this phone number.
 * Returns null if no experiment is active — caller should use default prompt.
 */
export function resolveExperimentPrompt(
  phone: string,
  experiments: Experiment[] | undefined
): { experimentId: string; variantId: string; systemPromptOverride: string } | null {
  if (!experiments || experiments.length === 0) return null;

  const active = experiments.find(e => e.active);
  if (!active) return null;

  const variant = resolveVariant(phone, active);
  if (!variant) return null;

  return {
    experimentId: active.id,
    variantId: variant.id,
    systemPromptOverride: variant.systemPromptOverride,
  };
}

// ─── Metrics Tracking ────────────────────────────────────────────────

function phoneHash(phone: string): string {
  return crypto.createHash('md5').update(phone).digest('hex');
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Increment message count for a variant (fire-and-forget).
 */
export function trackExperimentMessage(
  experimentId: string,
  variantId: string,
  phone: string
): void {
  const hash = phoneHash(phone);
  const windowDate = todayUTC();

  db.insert(experimentMetrics)
    .values({
      experimentId,
      variantId,
      phoneHash: hash,
      messageCount: 1,
      fallbackCount: 0,
      csatSum: 0,
      csatCount: 0,
      windowDate,
    })
    .onConflictDoUpdate({
      target: [experimentMetrics.experimentId, experimentMetrics.variantId, experimentMetrics.phoneHash, experimentMetrics.windowDate],
      set: {
        messageCount: sql`${experimentMetrics.messageCount} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .execute()
    .catch(err => console.warn('[Experiments] Failed to track message:', err.message));
}

/**
 * Increment fallback count for a variant (fire-and-forget).
 */
export function trackExperimentFallback(
  experimentId: string,
  variantId: string,
  phone: string
): void {
  const hash = phoneHash(phone);
  const windowDate = todayUTC();

  db.insert(experimentMetrics)
    .values({
      experimentId,
      variantId,
      phoneHash: hash,
      messageCount: 0,
      fallbackCount: 1,
      csatSum: 0,
      csatCount: 0,
      windowDate,
    })
    .onConflictDoUpdate({
      target: [experimentMetrics.experimentId, experimentMetrics.variantId, experimentMetrics.phoneHash, experimentMetrics.windowDate],
      set: {
        fallbackCount: sql`${experimentMetrics.fallbackCount} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .execute()
    .catch(err => console.warn('[Experiments] Failed to track fallback:', err.message));
}

/**
 * Record a CSAT score for a variant (fire-and-forget).
 */
export function trackExperimentCsat(
  experimentId: string,
  variantId: string,
  phone: string,
  score: number
): void {
  const hash = phoneHash(phone);
  const windowDate = todayUTC();

  db.insert(experimentMetrics)
    .values({
      experimentId,
      variantId,
      phoneHash: hash,
      messageCount: 0,
      fallbackCount: 0,
      csatSum: score,
      csatCount: 1,
      windowDate,
    })
    .onConflictDoUpdate({
      target: [experimentMetrics.experimentId, experimentMetrics.variantId, experimentMetrics.phoneHash, experimentMetrics.windowDate],
      set: {
        csatSum: sql`${experimentMetrics.csatSum} + ${score}`,
        csatCount: sql`${experimentMetrics.csatCount} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .execute()
    .catch(err => console.warn('[Experiments] Failed to track CSAT:', err.message));
}

// ─── Results Query ───────────────────────────────────────────────────

export interface VariantResult {
  variantId: string;
  totalMessages: number;
  totalFallbacks: number;
  fallbackRate: number;
  avgCsat: number | null;
  csatCount: number;
  uniqueUsers: number;
}

export interface ExperimentResults {
  experimentId: string;
  variants: VariantResult[];
}

/**
 * Query aggregated results for an experiment, with per-variant stats.
 */
export async function getExperimentResults(experimentId: string): Promise<ExperimentResults> {
  const rows = await db
    .select({
      variantId: experimentMetrics.variantId,
      totalMessages: sql<number>`sum(${experimentMetrics.messageCount})::int`,
      totalFallbacks: sql<number>`sum(${experimentMetrics.fallbackCount})::int`,
      csatSum: sql<number>`sum(${experimentMetrics.csatSum})::int`,
      csatCount: sql<number>`sum(${experimentMetrics.csatCount})::int`,
      uniqueUsers: sql<number>`count(distinct ${experimentMetrics.phoneHash})::int`,
    })
    .from(experimentMetrics)
    .where(sql`${experimentMetrics.experimentId} = ${experimentId}`)
    .groupBy(experimentMetrics.variantId);

  const variants: VariantResult[] = rows.map(r => ({
    variantId: r.variantId,
    totalMessages: r.totalMessages || 0,
    totalFallbacks: r.totalFallbacks || 0,
    fallbackRate: r.totalMessages > 0 ? (r.totalFallbacks || 0) / r.totalMessages : 0,
    avgCsat: r.csatCount > 0 ? (r.csatSum || 0) / r.csatCount : null,
    csatCount: r.csatCount || 0,
    uniqueUsers: r.uniqueUsers || 0,
  }));

  return { experimentId, variants };
}
