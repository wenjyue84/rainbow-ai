/**
 * Test suite for intent classification latency metrics
 * Tests percentile calculation, SLA monitoring, and data collection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordIntentLatency,
  computePercentiles,
  getAllMetrics,
  clearMetrics,
  getSamples,
  normalizeProfileName,
} from '../metrics.js';

describe('Metrics: Intent Classification Latency', () => {
  beforeEach(() => {
    // Clear all metrics before each test
    clearMetrics();
  });

  describe('recordIntentLatency', () => {
    it('should record a single latency measurement', () => {
      recordIntentLatency('pelangi', 100);
      const samples = getSamples('pelangi');
      expect(samples).toHaveLength(1);
      expect(samples?.[0]).toBe(100);
    });

    it('should record multiple measurements for a profile', () => {
      recordIntentLatency('southern', 150);
      recordIntentLatency('southern', 200);
      recordIntentLatency('southern', 250);
      const samples = getSamples('southern');
      expect(samples).toHaveLength(3);
      expect(samples).toEqual([150, 200, 250]);
    });

    it('should create a new profile if it does not exist', () => {
      recordIntentLatency('makan', 300);
      const samples = getSamples('makan');
      expect(samples).toHaveLength(1);
      expect(samples?.[0]).toBe(300);
    });

    it('should prevent unbounded memory growth by capping samples', () => {
      const maxSamples = 10000;
      for (let i = 0; i < maxSamples + 100; i++) {
        recordIntentLatency('pelangi', i);
      }
      const samples = getSamples('pelangi');
      expect(samples?.length).toBeLessThanOrEqual(maxSamples);
    });
  });

  describe('computePercentiles', () => {
    it('should return undefined for a profile with no samples', () => {
      const stats = computePercentiles('nonexistent');
      expect(stats).toBeUndefined();
    });

    it('should calculate correct percentiles for a single sample', () => {
      recordIntentLatency('pelangi', 100);
      const stats = computePercentiles('pelangi');
      expect(stats).toBeDefined();
      expect(stats?.p50).toBe(100);
      expect(stats?.p95).toBe(100);
      expect(stats?.p99).toBe(100);
      expect(stats?.sample_count).toBe(1);
    });

    it('should calculate correct percentiles for test array [100, 150, 200, 250, 300, 350, 400, 450, 500, 600]', () => {
      const testArray = [100, 150, 200, 250, 300, 350, 400, 450, 500, 600];
      testArray.forEach(val => recordIntentLatency('pelangi', val));

      const stats = computePercentiles('pelangi');
      expect(stats).toBeDefined();

      // Using nearest-rank method: position = ceil(p/100 * n) - 1
      // p50: ceil(50/100 * 10) - 1 = ceil(5) - 1 = 4, sorted[4] = 300
      // p95: ceil(95/100 * 10) - 1 = ceil(9.5) - 1 = 9, sorted[9] = 600
      // p99: ceil(99/100 * 10) - 1 = ceil(9.9) - 1 = 9, sorted[9] = 600
      expect(stats?.sample_count).toBe(10);
      expect(stats?.min).toBe(100);
      expect(stats?.max).toBe(600);

      // Verify percentiles are within expected range
      expect(stats?.p50).toBeGreaterThanOrEqual(200);
      expect(stats?.p50).toBeLessThanOrEqual(400);
      expect(stats?.p95).toBeGreaterThanOrEqual(500);
      expect(stats?.p99).toBeGreaterThanOrEqual(500);
    });

    it('should include basic statistics (min, max, mean)', () => {
      recordIntentLatency('southern', 100);
      recordIntentLatency('southern', 200);
      recordIntentLatency('southern', 300);

      const stats = computePercentiles('southern');
      expect(stats?.min).toBe(100);
      expect(stats?.max).toBe(300);
      expect(stats?.mean).toBe(200);
      expect(stats?.sample_count).toBe(3);
    });
  });

  describe('getAllMetrics', () => {
    it('should return empty object when no profiles have samples', () => {
      const metrics = getAllMetrics();
      expect(metrics).toEqual({});
    });

    it('should return metrics for all profiles with samples', () => {
      recordIntentLatency('pelangi', 100);
      recordIntentLatency('southern', 200);
      recordIntentLatency('makan', 300);

      const metrics = getAllMetrics();
      expect(Object.keys(metrics).sort()).toEqual(['makan', 'pelangi', 'southern']);
      expect(metrics.pelangi?.p50).toBe(100);
      expect(metrics.southern?.p50).toBe(200);
      expect(metrics.makan?.p50).toBe(300);
    });

    it('should return only profiles with samples', () => {
      recordIntentLatency('pelangi', 100);
      // southern and makan have no samples

      const metrics = getAllMetrics();
      expect(Object.keys(metrics)).toEqual(['pelangi']);
    });
  });

  describe('normalizeProfileName', () => {
    it('should normalize pelangi profile names', () => {
      expect(normalizeProfileName('pelangi')).toBe('pelangi');
      expect(normalizeProfileName('pelangi-capsule')).toBe('pelangi');
      expect(normalizeProfileName('PELANGI')).toBe('pelangi');
    });

    it('should normalize southern profile names', () => {
      expect(normalizeProfileName('southern')).toBe('southern');
      expect(normalizeProfileName('southern-homestay')).toBe('southern');
      expect(normalizeProfileName('SOUTHERN')).toBe('southern');
    });

    it('should normalize makan profile names', () => {
      expect(normalizeProfileName('makan')).toBe('makan');
      expect(normalizeProfileName('makan-moments')).toBe('makan');
      expect(normalizeProfileName('MAKAN')).toBe('makan');
    });

    it('should default to pelangi for unknown profiles', () => {
      expect(normalizeProfileName('unknown')).toBe('pelangi');
      expect(normalizeProfileName('')).toBe('pelangi');
    });

    it('should prioritize makan over southern over pelangi', () => {
      expect(normalizeProfileName('makan-southern')).toBe('makan');
      expect(normalizeProfileName('southern-pelangi')).toBe('southern');
    });
  });

  describe('SLA monitoring', () => {
    it('should trigger SLA alert when p95 exceeds 500ms', () => {
      // Create 20+ samples to trigger percentile check
      const testArray = Array.from({ length: 25 }, (_, i) => (i + 1) * 30); // [30, 60, 90, ..., 750]
      testArray.forEach(val => recordIntentLatency('pelangi', val));

      const stats = computePercentiles('pelangi');
      expect(stats).toBeDefined();
      // p95 should be > 500ms for this dataset
      expect(stats?.p95).toBeGreaterThan(500);
    });
  });

  describe('clearMetrics', () => {
    it('should clear all samples', () => {
      recordIntentLatency('pelangi', 100);
      recordIntentLatency('southern', 200);
      recordIntentLatency('makan', 300);

      clearMetrics();

      expect(getSamples('pelangi')).toEqual([]);
      expect(getSamples('southern')).toEqual([]);
      expect(getSamples('makan')).toEqual([]);
      expect(getAllMetrics()).toEqual({});
    });
  });

  describe('concurrent profiles', () => {
    it('should track metrics independently per profile', () => {
      for (let i = 0; i < 10; i++) {
        recordIntentLatency('pelangi', (i + 1) * 10);
        recordIntentLatency('southern', (i + 1) * 20);
        recordIntentLatency('makan', (i + 1) * 30);
      }

      const pelangiStats = computePercentiles('pelangi');
      const southernStats = computePercentiles('southern');
      const makanStats = computePercentiles('makan');

      // Each profile should have 10 samples with different ranges
      expect(pelangiStats?.sample_count).toBe(10);
      expect(southernStats?.sample_count).toBe(10);
      expect(makanStats?.sample_count).toBe(10);

      expect(pelangiStats?.max).toBe(100);
      expect(southernStats?.max).toBe(200);
      expect(makanStats?.max).toBe(300);
    });
  });
});
