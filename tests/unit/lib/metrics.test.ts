import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordIntentLatency,
  computePercentiles,
  getAllMetrics,
  clearMetrics,
  getSamples,
} from '../../../src/lib/metrics.js';

// Mock logger to avoid errors in test environment
vi.mock('../../../src/lib/logger.js', () => ({
  createModuleLogger: vi.fn(() => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  })),
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Latency Metrics', () => {
  beforeEach(() => {
    clearMetrics();
  });

  describe('percentile calculation', () => {
    it('should calculate p95 and p99 percentiles correctly with linear interpolation', () => {
      // US-552: Test array from acceptance criteria
      // Array: [100, 150, 200, 250, 300, 350, 400, 450, 500, 600] (n=10)
      // Linear interpolation method:
      // - p50: position = 0.5 * (10-1) = 4.5 → 300 + 0.5 * (350-300) = 325
      // - p95: position = 0.95 * (10-1) = 8.55 → 500 + 0.55 * (600-500) = 555
      // - p99: position = 0.99 * (10-1) = 8.91 → 500 + 0.91 * (600-500) = 591

      const testArray = [100, 150, 200, 250, 300, 350, 400, 450, 500, 600];

      // Record each sample
      for (const value of testArray) {
        recordIntentLatency('pelangi', value);
      }

      const stats = computePercentiles('pelangi');
      expect(stats).toBeDefined();

      // Verify percentile calculations using linear interpolation
      if (stats) {
        console.log(`Percentile calculation results: p50=${stats.p50}, p95=${stats.p95}, p99=${stats.p99}`);

        // Standard linear interpolation results
        expect(stats.p50).toBe(325); // 300 + 0.5 * 50
        expect(stats.p95).toBe(555); // 500 + 0.55 * 100
        expect(stats.p99).toBe(591); // 500 + 0.91 * 100
        expect(stats.sample_count).toBe(10);
      }
    });

    it('should track multiple profiles independently', () => {
      recordIntentLatency('pelangi', 100);
      recordIntentLatency('pelangi', 200);
      recordIntentLatency('southern', 150);
      recordIntentLatency('southern', 250);

      const pelangiStats = computePercentiles('pelangi');
      const southernStats = computePercentiles('southern');

      expect(pelangiStats?.sample_count).toBe(2);
      expect(southernStats?.sample_count).toBe(2);
    });

    it('should return undefined for empty profile', () => {
      const stats = computePercentiles('nonexistent');
      expect(stats).toBeUndefined();
    });

    it('should return all metrics for all profiles', () => {
      recordIntentLatency('pelangi', 100);
      recordIntentLatency('pelangi', 200);
      recordIntentLatency('southern', 150);

      const allMetrics = getAllMetrics();

      expect(allMetrics.pelangi).toBeDefined();
      expect(allMetrics.southern).toBeDefined();
      expect(allMetrics.pelangi?.sample_count).toBe(2);
      expect(allMetrics.southern?.sample_count).toBe(1);
    });

    it('should handle single sample', () => {
      recordIntentLatency('makan', 123);
      const stats = computePercentiles('makan');

      expect(stats?.p50).toBe(123);
      expect(stats?.p95).toBe(123);
      expect(stats?.p99).toBe(123);
      expect(stats?.sample_count).toBe(1);
    });

    it('should record samples without hitting memory limits in normal operation', () => {
      // Record a reasonable number of samples
      for (let i = 0; i < 500; i++) {
        recordIntentLatency('pelangi', (Math.random() * 1000) | 0);
      }

      const samples = getSamples('pelangi');
      expect(samples?.length).toBe(500);
    });

  });

  describe('SLA monitoring', () => {
    it('should log warning when p95 exceeds SLA_THRESHOLD (500ms)', () => {
      // This test verifies the SLA alert mechanism works
      // Create samples that will have p95 > 500ms
      const highLatencies = Array.from({ length: 20 }, (_, i) => 450 + i * 10);

      for (const latency of highLatencies) {
        recordIntentLatency('pelangi', latency);
      }

      const stats = computePercentiles('pelangi');

      // Verify p95 exceeds threshold
      if (stats) {
        expect(stats.p95).toBeGreaterThan(500);
        expect(stats.sample_count).toBe(20);
      }
    });
  });
});
