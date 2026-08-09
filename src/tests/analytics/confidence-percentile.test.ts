/**
 * US-359: Per-Intent Confidence Percentile Analytics Dashboard
 *
 * Unit tests for confidence percentile calculation.
 * Verifies percentile math and handles edge cases.
 */

import { describe, test, expect } from 'vitest';
import {
  calculatePercentile,
  calculateConfidencePercentiles,
  groupConfidencesByIntent,
  generateDistributionReport,
} from '../../lib/analytics/confidence-percentile.js';

describe('US-359: Confidence Percentile Calculator', () => {
  describe('calculatePercentile', () => {
    test('calculates p50 (median) of sorted array', () => {
      const values = [0.1, 0.3, 0.5, 0.7, 0.9];
      expect(calculatePercentile(values, 50)).toBeCloseTo(0.5);
    });

    test('calculates p95 of sorted array', () => {
      const values = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
      const p95 = calculatePercentile(values, 95);
      expect(p95).toBeGreaterThan(0.9);
      expect(p95).toBeLessThanOrEqual(1.0);
    });

    test('returns only value for single-element array', () => {
      expect(calculatePercentile([0.75], 50)).toBe(0.75);
      expect(calculatePercentile([0.75], 95)).toBe(0.75);
      expect(calculatePercentile([0.75], 99)).toBe(0.75);
    });

    test('returns 0 for empty array', () => {
      expect(calculatePercentile([], 50)).toBe(0);
    });

    test('returns first element for p0', () => {
      const values = [0.1, 0.5, 0.9];
      expect(calculatePercentile(values, 0)).toBe(0.1);
    });

    test('returns last element for p100', () => {
      const values = [0.1, 0.5, 0.9];
      expect(calculatePercentile(values, 100)).toBe(0.9);
    });
  });

  describe('calculateConfidencePercentiles', () => {
    test('calculates p50/p95/p99 for a normal distribution', () => {
      const confidences = Array.from({ length: 100 }, (_, i) => (i + 1) / 100);
      const result = calculateConfidencePercentiles(confidences);

      expect(result.sampleCount).toBe(100);
      expect(result.p50).toBeCloseTo(0.5, 1);
      expect(result.p95).toBeGreaterThan(0.9);
      expect(result.p99).toBeGreaterThan(0.95);
      expect(result.min).toBeCloseTo(0.01);
      expect(result.max).toBeCloseTo(1.0);
      expect(result.mean).toBeCloseTo(0.505, 2);
    });

    test('handles single sample (edge case)', () => {
      const result = calculateConfidencePercentiles([0.88]);
      expect(result.sampleCount).toBe(1);
      expect(result.p50).toBe(0.88);
      expect(result.p95).toBe(0.88);
      expect(result.p99).toBe(0.88);
      expect(result.min).toBe(0.88);
      expect(result.max).toBe(0.88);
      expect(result.mean).toBe(0.88);
    });

    test('handles all high confidence values', () => {
      const confidences = [0.95, 0.96, 0.97, 0.98, 0.99, 1.0];
      const result = calculateConfidencePercentiles(confidences);

      expect(result.sampleCount).toBe(6);
      expect(result.p50).toBeGreaterThan(0.96);
      expect(result.p95).toBeGreaterThanOrEqual(0.99);
      expect(result.min).toBeCloseTo(0.95);
      expect(result.max).toBeCloseTo(1.0);
    });

    test('handles all identical values', () => {
      const confidences = [0.75, 0.75, 0.75, 0.75];
      const result = calculateConfidencePercentiles(confidences);

      expect(result.p50).toBe(0.75);
      expect(result.p95).toBe(0.75);
      expect(result.p99).toBe(0.75);
      expect(result.mean).toBe(0.75);
    });

    test('returns zero stats for empty array', () => {
      const result = calculateConfidencePercentiles([]);
      expect(result.sampleCount).toBe(0);
      expect(result.p50).toBe(0);
      expect(result.p95).toBe(0);
      expect(result.p99).toBe(0);
    });

    test('p50 <= p95 <= p99 invariant holds', () => {
      const confidences = [0.3, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];
      const result = calculateConfidencePercentiles(confidences);

      expect(result.p50).toBeLessThanOrEqual(result.p95);
      expect(result.p95).toBeLessThanOrEqual(result.p99);
    });
  });

  describe('groupConfidencesByIntent', () => {
    test('groups predictions by intent type', () => {
      const predictions = [
        { intentType: 'booking', confidence: 0.9 },
        { intentType: 'inquiry', confidence: 0.8 },
        { intentType: 'booking', confidence: 0.85 },
        { intentType: 'escalation', confidence: 0.95 },
      ];

      const grouped = groupConfidencesByIntent(predictions);

      expect(grouped.size).toBe(3);
      expect(grouped.get('booking')).toEqual([0.9, 0.85]);
      expect(grouped.get('inquiry')).toEqual([0.8]);
      expect(grouped.get('escalation')).toEqual([0.95]);
    });

    test('handles empty predictions array', () => {
      const grouped = groupConfidencesByIntent([]);
      expect(grouped.size).toBe(0);
    });
  });

  describe('generateDistributionReport', () => {
    test('generates per-intent distribution report', () => {
      const predictions = [
        { intentType: 'booking', confidence: 0.9 },
        { intentType: 'booking', confidence: 0.85 },
        { intentType: 'booking', confidence: 0.7 },
        { intentType: 'inquiry', confidence: 0.95 },
        { intentType: 'inquiry', confidence: 0.92 },
      ];

      const report = generateDistributionReport(predictions);

      expect(report.size).toBe(2);

      const bookingStats = report.get('booking')!;
      expect(bookingStats.sampleCount).toBe(3);
      expect(bookingStats.p50).toBeGreaterThan(0.8);

      const inquiryStats = report.get('inquiry')!;
      expect(inquiryStats.sampleCount).toBe(2);
      expect(inquiryStats.mean).toBeCloseTo(0.935);
    });

    test('handles single prediction per intent', () => {
      const predictions = [
        { intentType: 'booking', confidence: 0.88 },
      ];

      const report = generateDistributionReport(predictions);
      const bookingStats = report.get('booking')!;

      expect(bookingStats.sampleCount).toBe(1);
      expect(bookingStats.p50).toBe(0.88);
      expect(bookingStats.p99).toBe(0.88);
    });
  });
});
