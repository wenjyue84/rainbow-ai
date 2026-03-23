/**
 * US-315: Intent Classification Latency Percentile Tracker
 *
 * Logs intent classification latency metrics to daily log files and provides
 * percentile calculation utilities for the analytics endpoint.
 *
 * Fire-and-forget — never blocks the classification pipeline.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Directory for latency log files */
const LOGS_DIR = path.resolve(__dirname, '../../logs');

/** In-memory store for latency records (keyed by intent) */
const latencyStore: Map<string, number[]> = new Map();

/**
 * Get today's date formatted as YYYY-MM-DD.
 */
export function formatDateForLog(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Get the log file path for a given date.
 */
export function getLogFilePath(date: Date = new Date()): string {
  return path.join(LOGS_DIR, `latency-${formatDateForLog(date)}.log`);
}

/**
 * Log a classification latency measurement.
 *
 * - Writes to `src/logs/latency-${YYYY-MM-DD}.log` (append, one JSON line per entry)
 * - Stores in memory for percentile queries
 * - Fire-and-forget: errors are caught and logged, never thrown
 *
 * @param intent - The classified intent name (e.g. "booking", "pricing")
 * @param latencyMs - The classification latency in milliseconds
 */
export function logClassificationLatency(intent: string, latencyMs: number): void {
  // Store in memory for percentile queries
  const existing = latencyStore.get(intent) || [];
  existing.push(latencyMs);
  latencyStore.set(intent, existing);

  // Write to log file (fire-and-forget)
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    const logEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      intent,
      latencyMs,
    });

    const logPath = getLogFilePath();
    fs.appendFileSync(logPath, logEntry + '\n', 'utf-8');
  } catch (err) {
    console.warn(`[LatencyTracker] Failed to write log: ${(err as Error).message}`);
  }
}

/**
 * Calculate percentiles from an array of numbers.
 *
 * Uses the nearest-rank method:
 * - Sort values ascending
 * - For percentile p, index = ceil(p/100 * n) - 1
 *
 * @param values - Array of latency values
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
 * Get latency percentiles for a specific intent.
 *
 * @param intent - The intent to query (if undefined, aggregates all intents)
 * @returns Object with p10, p50, p90, and count
 */
export function getLatencyPercentiles(intent?: string): {
  p10: number | null;
  p50: number | null;
  p90: number | null;
  count: number;
} {
  let values: number[];

  if (intent) {
    values = latencyStore.get(intent) || [];
  } else {
    // Aggregate all intents
    values = [];
    for (const entries of latencyStore.values()) {
      values.push(...entries);
    }
  }

  return {
    p10: calculatePercentile(values, 10),
    p50: calculatePercentile(values, 50),
    p90: calculatePercentile(values, 90),
    count: values.length,
  };
}

/**
 * Get all intents with latency data.
 *
 * @returns Array of intent names that have recorded latencies
 */
export function getTrackedIntents(): string[] {
  return Array.from(latencyStore.keys());
}

/**
 * Clear all in-memory latency data. Useful for testing.
 */
export function clearLatencyStore(): void {
  latencyStore.clear();
}

/**
 * Get the raw latency store (read-only). Useful for testing/debugging.
 */
export function getLatencyStore(): ReadonlyMap<string, readonly number[]> {
  return latencyStore;
}
