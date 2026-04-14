/**
 * metrics.ts — Intent classification latency tracking per profile
 * + Database query performance metrics (US-640)
 *
 * Tracks p50, p95, p99 percentiles for intent classification latency
 * per profile (pelangi, southern, makan) with SLA monitoring.
 * Also tracks database query latencies for slow query detection.
 */

import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('Metrics');

// ─── Types ───────────────────────────────────────────────────────────

export interface LatencyStats {
  p50: number;
  p95: number;
  p99: number;
  sample_count: number;
  min?: number;
  max?: number;
  mean?: number;
}

export interface LatencyMetrics {
  pelangi?: LatencyStats;
  southern?: LatencyStats;
  makan?: LatencyStats;
  [key: string]: LatencyStats | undefined;
}

export interface QueryMetric {
  queryType: string;
  durationMs: number;
  tableNames: string[];
  profile: string;
  executedAt: Date;
}

// ─── In-Memory Storage ───────────────────────────────────────────────

const latencySamples: Map<string, number[]> = new Map([
  ['pelangi', []],
  ['southern', []],
  ['makan', []],
]);

// US-640: Store query metrics with timestamps for p50/p95/p99 calculation
const queryMetrics: QueryMetric[] = [];
const MAX_QUERY_METRICS = 50000; // Keep last 50k query metrics in memory

const SLA_THRESHOLD_MS = 500;
const MAX_SAMPLES_PER_PROFILE = 10000; // Prevent unbounded memory growth

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Record a single intent classification latency measurement
 * @param profile - Profile identifier (pelangi, southern, makan)
 * @param durationMs - Latency in milliseconds
 */
export function recordIntentLatency(profile: string, durationMs: number): void {
  if (!latencySamples.has(profile)) {
    latencySamples.set(profile, []);
  }

  const samples = latencySamples.get(profile)!;
  samples.push(durationMs);

  // Keep samples bounded to prevent memory explosion
  if (samples.length > MAX_SAMPLES_PER_PROFILE) {
    samples.shift();
  }

  // Check SLA and alert if exceeded
  if (samples.length >= 20) {
    // Only compute percentiles after collecting enough samples
    const stats = computePercentiles(profile);
    if (stats && stats.p95 > SLA_THRESHOLD_MS) {
      logger.warn(
        `[Metrics] Intent classification SLA breach for profile ${profile}: p95=${stats.p95.toFixed(2)}ms > ${SLA_THRESHOLD_MS}ms`
      );
    }
  }
}

/**
 * Compute p50, p95, p99 percentiles for a given profile
 * @param profile - Profile identifier
 * @returns Latency stats with percentiles, or undefined if no samples
 */
export function computePercentiles(profile: string): LatencyStats | undefined {
  const samples = latencySamples.get(profile);
  if (!samples || samples.length === 0) {
    return undefined;
  }

  // Sort for percentile calculation
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;

  // Calculate percentiles using linear interpolation (nearest rank method)
  const p50 = calculatePercentile(sorted, 50);
  const p95 = calculatePercentile(sorted, 95);
  const p99 = calculatePercentile(sorted, 99);

  // Additional stats
  const min = sorted[0];
  const max = sorted[n - 1];
  const mean = sorted.reduce((a, b) => a + b, 0) / n;

  return {
    p50,
    p95,
    p99,
    sample_count: n,
    min,
    max,
    mean: Math.round(mean * 100) / 100,
  };
}

/**
 * Get all metrics for all profiles
 * @returns Object with latency stats per profile
 */
export function getAllMetrics(): LatencyMetrics {
  const metrics: LatencyMetrics = {};

  for (const [profile, samples] of latencySamples) {
    if (samples.length > 0) {
      const stats = computePercentiles(profile);
      if (stats) {
        metrics[profile] = stats;
      }
    }
  }

  return metrics;
}

/**
 * Clear all samples for testing purposes
 */
export function clearMetrics(): void {
  for (const key of latencySamples.keys()) {
    latencySamples.set(key, []);
  }
}

/**
 * Get sample array for a profile (for testing)
 */
export function getSamples(profile: string): number[] | undefined {
  return latencySamples.get(profile);
}

// ─── Helper Functions ────────────────────────────────────────────────

/**
 * Calculate percentile using linear interpolation method
 * More accurate for edge cases - uses Excel's PERCENTILE.INC method
 *
 * @param sorted - Sorted array of numbers
 * @param percentile - Percentile to calculate (0-100)
 * @returns Percentile value
 */
function calculatePercentile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  // Linear interpolation method (PERCENTILE.INC / Excel method)
  // Position = (p/100) * (n - 1)
  const position = (percentile / 100) * (sorted.length - 1);
  const index = Math.floor(position);
  const remainder = position - index;

  // If position is exact integer, return that element
  if (remainder === 0) {
    return Math.round(sorted[index] * 100) / 100;
  }

  // Otherwise, interpolate between index and index+1
  const lower = sorted[index];
  const upper = index + 1 < sorted.length ? sorted[index + 1] : sorted[index];
  const interpolated = lower + remainder * (upper - lower);

  return Math.round(interpolated * 100) / 100;
}

/**
 * Normalize profile ID to standard profile name
 * @param profileId - Profile identifier (e.g., 'pelangi-capsule', 'southern-homestay', 'makan-moments')
 * @returns Normalized profile name (pelangi, southern, makan)
 */
export function normalizeProfileName(profileId: string): string {
  if (!profileId) return 'pelangi'; // Default
  const lower = profileId.toLowerCase();
  if (lower.includes('makan')) return 'makan';
  if (lower.includes('southern')) return 'southern';
  if (lower.includes('pelangi')) return 'pelangi';
  return 'pelangi'; // Default fallback
}

// ─── Database Query Metrics (US-640) ────────────────────────────────

/**
 * Record a database query execution metric
 * @param queryType - Type of query (SELECT, INSERT, UPDATE, DELETE, etc.)
 * @param durationMs - Query execution duration in milliseconds
 * @param tableNames - List of table names involved in the query
 * @param profile - Profile ID (e.g., pelangi, southern, makan)
 */
export function recordQueryMetric(
  queryType: string,
  durationMs: number,
  tableNames: string[],
  profile: string = 'pelangi'
): void {
  const metric: QueryMetric = {
    queryType,
    durationMs,
    tableNames,
    profile: normalizeProfileName(profile),
    executedAt: new Date(),
  };

  queryMetrics.push(metric);

  // Log WARNING if query exceeds 100ms threshold
  if (durationMs > 100) {
    logger.warn(
      `[SlowQuery] ${queryType} on ${tableNames.join(', ')} took ${durationMs}ms (profile: ${profile})`
    );
  }

  // Keep array bounded
  if (queryMetrics.length > MAX_QUERY_METRICS) {
    queryMetrics.shift();
  }
}

/**
 * Get query metrics from the last hour
 * @returns Array of query metrics from the last 60 minutes
 */
export function getQueryMetricsLastHour(): QueryMetric[] {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  return queryMetrics.filter(m => m.executedAt >= oneHourAgo);
}

/**
 * Calculate p50/p95/p99 latencies by query type for the last hour
 * @returns Object with latency stats per query type
 */
export function getQueryLatencyPercentiles(): Record<string, LatencyStats> {
  const lastHourMetrics = getQueryMetricsLastHour();
  const byQueryType: Record<string, number[]> = {};

  for (const metric of lastHourMetrics) {
    if (!byQueryType[metric.queryType]) {
      byQueryType[metric.queryType] = [];
    }
    byQueryType[metric.queryType].push(metric.durationMs);
  }

  const result: Record<string, LatencyStats> = {};
  for (const [queryType, durations] of Object.entries(byQueryType)) {
    if (durations.length > 0) {
      const sorted = [...durations].sort((a, b) => a - b);
      result[queryType] = {
        p50: calculatePercentile(sorted, 50),
        p95: calculatePercentile(sorted, 95),
        p99: calculatePercentile(sorted, 99),
        sample_count: durations.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: Math.round((sorted.reduce((a, b) => a + b, 0) / durations.length) * 100) / 100,
      };
    }
  }

  return result;
}

/**
 * Clear all query metrics (for testing)
 */
export function clearQueryMetrics(): void {
  queryMetrics.length = 0;
}
