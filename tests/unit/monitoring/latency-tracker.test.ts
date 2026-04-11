/**
 * US-426: Intent Classification Latency Tracker Tests
 *
 * Tests for latency tracking and percentile calculation.
 */

import { describe, it, expect } from 'vitest';
import {
  calculatePercentile,
} from '../../../src/lib/monitoring/latency-tracker.js';

describe('Latency Tracker', () => {
  describe('calculatePercentile', () => {
    it('should calculate p50 (median) correctly', () => {
      const values = [10, 20, 30, 40, 50];
      const p50 = calculatePercentile(values, 50);
      expect(p50).toBe(30);
    });

    it('should calculate p95 correctly', () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1-100
      const p95 = calculatePercentile(values, 95);
      expect(p95).toBe(95);
    });

    it('should calculate p99 correctly', () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1-100
      const p99 = calculatePercentile(values, 99);
      expect(p99).toBe(99);
    });

    it('should handle single value', () => {
      const values = [42];
      expect(calculatePercentile(values, 50)).toBe(42);
      expect(calculatePercentile(values, 95)).toBe(42);
      expect(calculatePercentile(values, 99)).toBe(42);
    });

    it('should return null for empty array', () => {
      const values: number[] = [];
      expect(calculatePercentile(values, 50)).toBeNull();
      expect(calculatePercentile(values, 95)).toBeNull();
    });

    it('should handle unsorted input', () => {
      const values = [50, 10, 30, 20, 40];
      const p50 = calculatePercentile(values, 50);
      expect(p50).toBe(30);
    });

    it('should use nearest-rank method correctly', () => {
      // Using nearest-rank: ceil(p/100 * n) - 1
      // For p50 with n=6: ceil(50/100 * 6) - 1 = ceil(3) - 1 = 2 (value: 30)
      const values = [10, 20, 30, 40, 50, 60];
      const p50 = calculatePercentile(values, 50);
      expect(p50).toBe(30);
    });

    it('should handle duplicate values', () => {
      const values = [10, 10, 10, 20, 20, 30];
      const p50 = calculatePercentile(values, 50);
      expect(p50).toBeDefined();
      expect(p50).toBeGreaterThanOrEqual(10);
      expect(p50).toBeLessThanOrEqual(30);
    });

    it('should calculate percentile 0 (min)', () => {
      const values = [10, 20, 30, 40, 50];
      const p0 = calculatePercentile(values, 0);
      expect(p0).toBe(10);
    });

    it('should calculate percentile 100 (max)', () => {
      const values = [10, 20, 30, 40, 50];
      const p100 = calculatePercentile(values, 100);
      expect(p100).toBe(50);
    });

    it('should handle large dataset', () => {
      const values = Array.from({ length: 1000 }, (_, i) => i + 1);
      const p50 = calculatePercentile(values, 50);
      const p95 = calculatePercentile(values, 95);
      const p99 = calculatePercentile(values, 99);

      expect(p50).toBeDefined();
      expect(p95).toBeDefined();
      expect(p99).toBeDefined();
      expect(p50).toBeLessThan(p95);
      expect(p95).toBeLessThan(p99);
    });
  });
});
