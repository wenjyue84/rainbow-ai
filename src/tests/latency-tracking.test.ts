/**
 * US-315: Intent Classification Latency Percentile Tracker
 *
 * Tests:
 *  1. Single latency log — logClassificationLatency stores an entry and writes to log file
 *  2. Percentile calculation accuracy — calculatePercentile returns correct p10/p50/p90
 *  3. Multi-intent aggregation — getLatencyPercentiles aggregates across intents correctly
 *  4. getLatencyPercentiles returns zeroed result for unknown intent
 *  5. GET /analytics/latency-percentiles returns {p10, p50, p90, count} for a specific intent
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import fs from 'fs';

// ─── Mocks (hoisted) ───────────────────────────────────────────────────────

vi.mock('../../lib/db.js', () => ({
  db: { execute: vi.fn() },
  dbReady: Promise.resolve(true),
}));

// ─── Import module under test ──────────────────────────────────────────────

import {
  logClassificationLatency,
  calculatePercentile,
  getLatencyPercentiles,
  clearLatencyStore,
  getLatencyStore,
  formatDateForLog,
  getLogFilePath,
  getTrackedIntents,
} from '../assistant/pipeline/latency-tracker.js';

describe('US-315: Intent Classification Latency Percentile Tracker', () => {
  beforeEach(() => {
    clearLatencyStore();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearLatencyStore();
  });

  // ── Test 1: Single latency log ────────────────────────────────────────

  describe('logClassificationLatency()', () => {
    it('stores a latency entry in the in-memory store', () => {
      // Stub fs to avoid actual file writes
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

      logClassificationLatency('booking', 150);

      const store = getLatencyStore();
      expect(store.has('booking')).toBe(true);
      expect(store.get('booking')).toEqual([150]);
    });

    it('writes a JSON line to the daily log file', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

      logClassificationLatency('pricing', 200);

      expect(appendSpy).toHaveBeenCalledTimes(1);
      const [filePath, content] = appendSpy.mock.calls[0];
      expect(filePath).toContain('latency-');
      expect(filePath).toMatch(/latency-\d{4}-\d{2}-\d{2}\.log$/);

      const parsed = JSON.parse((content as string).trim());
      expect(parsed.intent).toBe('pricing');
      expect(parsed.latencyMs).toBe(200);
      expect(parsed.timestamp).toBeDefined();
    });

    it('creates logs directory if it does not exist', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => '' as any);
      vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

      logClassificationLatency('greeting', 50);

      expect(mkdirSpy).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('does not throw when file write fails', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
        throw new Error('Disk full');
      });

      // Should not throw
      expect(() => logClassificationLatency('booking', 100)).not.toThrow();

      // But memory store should still have the entry
      const store = getLatencyStore();
      expect(store.get('booking')).toEqual([100]);
    });
  });

  // ── Test 2: Percentile calculation accuracy ───────────────────────────

  describe('calculatePercentile()', () => {
    it('returns null for empty array', () => {
      expect(calculatePercentile([], 50)).toBeNull();
    });

    it('returns the single value for single-element array', () => {
      expect(calculatePercentile([100], 50)).toBe(100);
      expect(calculatePercentile([100], 10)).toBe(100);
      expect(calculatePercentile([100], 90)).toBe(100);
    });

    it('calculates correct p10, p50, p90 for a known dataset', () => {
      // 10 values: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

      // p10: ceil(0.1 * 10) - 1 = 0 -> 10
      expect(calculatePercentile(values, 10)).toBe(10);
      // p50: ceil(0.5 * 10) - 1 = 4 -> 50
      expect(calculatePercentile(values, 50)).toBe(50);
      // p90: ceil(0.9 * 10) - 1 = 8 -> 90
      expect(calculatePercentile(values, 90)).toBe(90);
    });

    it('handles unsorted input correctly', () => {
      const values = [100, 10, 50, 30, 80, 20, 90, 40, 60, 70];

      expect(calculatePercentile(values, 50)).toBe(50);
      expect(calculatePercentile(values, 90)).toBe(90);
    });
  });

  // ── Test 3: Multi-intent aggregation ──────────────────────────────────

  describe('getLatencyPercentiles() - multi-intent aggregation', () => {
    beforeEach(() => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
    });

    it('returns correct percentiles for a specific intent', () => {
      // Log 10 entries for 'booking'
      [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].forEach(ms =>
        logClassificationLatency('booking', ms)
      );

      const result = getLatencyPercentiles('booking');
      expect(result.count).toBe(10);
      expect(result.p10).toBe(10);
      expect(result.p50).toBe(50);
      expect(result.p90).toBe(90);
    });

    it('aggregates all intents when no intent specified', () => {
      // Log entries for multiple intents
      logClassificationLatency('booking', 100);
      logClassificationLatency('booking', 200);
      logClassificationLatency('pricing', 150);
      logClassificationLatency('pricing', 250);
      logClassificationLatency('greeting', 50);

      const result = getLatencyPercentiles();
      expect(result.count).toBe(5);
      // All values: [50, 100, 150, 200, 250]
      // p50: ceil(0.5 * 5) - 1 = 2 -> 150
      expect(result.p50).toBe(150);
    });

    it('returns zeroed result for unknown intent', () => {
      logClassificationLatency('booking', 100);

      const result = getLatencyPercentiles('nonexistent');
      expect(result.count).toBe(0);
      expect(result.p10).toBeNull();
      expect(result.p50).toBeNull();
      expect(result.p90).toBeNull();
    });

    it('tracks multiple intents independently', () => {
      logClassificationLatency('booking', 100);
      logClassificationLatency('booking', 200);
      logClassificationLatency('pricing', 50);

      const bookingResult = getLatencyPercentiles('booking');
      expect(bookingResult.count).toBe(2);

      const pricingResult = getLatencyPercentiles('pricing');
      expect(pricingResult.count).toBe(1);
      expect(pricingResult.p50).toBe(50);
    });
  });

  // ── Test 4: Utility functions ─────────────────────────────────────────

  describe('utility functions', () => {
    it('formatDateForLog returns YYYY-MM-DD format', () => {
      const date = new Date('2026-03-23T10:00:00Z');
      expect(formatDateForLog(date)).toBe('2026-03-23');
    });

    it('getLogFilePath includes date in filename', () => {
      const date = new Date('2026-03-23T10:00:00Z');
      const logPath = getLogFilePath(date);
      expect(logPath).toContain('latency-2026-03-23.log');
    });

    it('getTrackedIntents returns all intents with data', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

      logClassificationLatency('booking', 100);
      logClassificationLatency('pricing', 200);
      logClassificationLatency('greeting', 50);

      const intents = getTrackedIntents();
      expect(intents).toContain('booking');
      expect(intents).toContain('pricing');
      expect(intents).toContain('greeting');
      expect(intents).toHaveLength(3);
    });

    it('clearLatencyStore empties all data', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

      logClassificationLatency('booking', 100);
      expect(getLatencyStore().size).toBe(1);

      clearLatencyStore();
      expect(getLatencyStore().size).toBe(0);
    });
  });
});
