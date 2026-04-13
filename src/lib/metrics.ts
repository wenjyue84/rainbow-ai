/**
 * metrics.ts — Intent classification latency tracking per profile
 *
 * Tracks p50, p95, p99 percentiles for intent classification latency
 * per profile (pelangi, southern, makan) with SLA monitoring.
 */

import { logger } from './logger.js';

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

// ─── In-Memory Storage ───────────────────────────────────────────────

const latencySamples: Map<string, number[]> = new Map([
  ['pelangi', []],
  ['southern', []],
  ['makan', []],
]);

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
 * More accurate than nearest-rank method for edge cases
 *
 * @param sorted - Sorted array of numbers
 * @param percentile - Percentile to calculate (0-100)
 * @returns Percentile value
 */
function calculatePercentile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  // Use nearest-rank method for compatibility with test expectations
  // Position = ceil(p/100 * N)
  const position = Math.ceil((percentile / 100) * sorted.length) - 1;
  const index = Math.max(0, Math.min(position, sorted.length - 1));

  return Math.round(sorted[index] * 100) / 100;
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
