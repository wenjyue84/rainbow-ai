/**
 * US-426: Intent Classification Latency Tracker
 *
 * Provides functions to record intent classification latency measurements
 * to the database for percentile analysis and SLA monitoring.
 */

import { db } from '../db.js';
import { intentClassificationMetrics } from '../../shared/schema-tables.js';
import { createModuleLogger } from '../logger.js';

const logger = createModuleLogger('LatencyTracker');

/**
 * Record an intent classification latency measurement.
 *
 * @param intentId - The classified intent name (e.g., "booking", "pricing")
 * @param durationMs - The classification latency in milliseconds
 * @param profileId - The profile ID (defaults to 'pelangi')
 *
 * Fires asynchronously and never blocks the caller. Errors are logged but not thrown.
 */
export async function recordIntentLatency(
  intentId: string,
  durationMs: number,
  profileId: string = 'pelangi'
): Promise<void> {
  try {
    await db.insert(intentClassificationMetrics).values({
      intentId,
      latencyMs: durationMs,
      profileId,
    });
  } catch (err) {
    logger.error(
      `Failed to record latency for intent=${intentId}, profile=${profileId}: ${(err as Error).message}`
    );
  }
}

/**
 * Calculate a percentile from an array of numbers.
 *
 * Uses the nearest-rank method:
 * - Sort values ascending
 * - For percentile p, index = ceil(p/100 * n) - 1
 *
 * @param values - Array of latency values (in milliseconds)
 * @param percentile - Percentile to calculate (0-100)
 * @returns The percentile value, or null if no values
 */
export function calculatePercentile(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1);
  return sorted[index];
}

/**
 * Get latency percentiles for a specific intent and profile.
 *
 * @param intentId - The intent to query
 * @param profileId - The profile to query (defaults to 'pelangi')
 * @returns Object with p50, p95, p99 percentiles and count of measurements
 */
export async function getIntentLatencyPercentiles(
  intentId: string,
  profileId: string = 'pelangi'
): Promise<{
  p50: number | null;
  p95: number | null;
  p99: number | null;
  count: number;
  minLatency: number | null;
  maxLatency: number | null;
  avgLatency: number | null;
}> {
  try {
    const records = await db
      .select()
      .from(intentClassificationMetrics)
      .where(
        intentId ? (qb) => qb.where(intentId === intentId ? {intentId, profileId} : {profileId}) : undefined
      );

    const values = records.map(r => r.latencyMs);
    if (values.length === 0) {
      return {
        p50: null,
        p95: null,
        p99: null,
        count: 0,
        minLatency: null,
        maxLatency: null,
        avgLatency: null,
      };
    }

    const avgLatency = values.reduce((a, b) => a + b, 0) / values.length;

    return {
      p50: calculatePercentile(values, 50),
      p95: calculatePercentile(values, 95),
      p99: calculatePercentile(values, 99),
      count: values.length,
      minLatency: Math.min(...values),
      maxLatency: Math.max(...values),
      avgLatency: Math.round(avgLatency * 100) / 100,
    };
  } catch (err) {
    logger.error(
      `Failed to get percentiles for intent=${intentId}, profile=${profileId}: ${(err as Error).message}`
    );
    return {
      p50: null,
      p95: null,
      p99: null,
      count: 0,
      minLatency: null,
      maxLatency: null,
      avgLatency: null,
    };
  }
}

/**
 * Get latency percentiles for all intents in a profile.
 *
 * @param profileId - The profile to query (defaults to 'pelangi')
 * @returns Map of intent -> percentile metrics
 */
export async function getAllIntentLatencyPercentiles(
  profileId: string = 'pelangi'
): Promise<
  Map<
    string,
    {
      p50: number | null;
      p95: number | null;
      p99: number | null;
      count: number;
      minLatency: number | null;
      maxLatency: number | null;
      avgLatency: number | null;
    }
  >
> {
  try {
    const records = await db
      .select()
      .from(intentClassificationMetrics)
      .where((qb) =>
        profileId ? qb.where({profileId}) : undefined
      );

    // Group by intent
    const groupedByIntent = new Map<string, number[]>();
    for (const record of records) {
      const intents = groupedByIntent.get(record.intentId) || [];
      intents.push(record.latencyMs);
      groupedByIntent.set(record.intentId, intents);
    }

    // Calculate percentiles for each intent
    const result = new Map();
    for (const [intentId, values] of groupedByIntent) {
      const avgLatency = values.reduce((a, b) => a + b, 0) / values.length;
      result.set(intentId, {
        p50: calculatePercentile(values, 50),
        p95: calculatePercentile(values, 95),
        p99: calculatePercentile(values, 99),
        count: values.length,
        minLatency: Math.min(...values),
        maxLatency: Math.max(...values),
        avgLatency: Math.round(avgLatency * 100) / 100,
      });
    }

    return result;
  } catch (err) {
    logger.error(
      `Failed to get all percentiles for profile=${profileId}: ${(err as Error).message}`
    );
    return new Map();
  }
}
