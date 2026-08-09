/**
 * Unit tests for confidence percentile calculation (US-359)
 *
 * Tests:
 * - Percentile calculation accuracy
 * - Edge cases (single sample, all identical, all high/low confidence)
 * - Distribution report generation
 */

import { describe, it, expect } from 'vitest';
import {
  calculatePercentile,
  calculateConfidencePercentiles,
  groupConfidencesByIntent,
  generateDistributionReport,
} from '../lib/analytics/confidence-percentile.js';

describe('calculatePercentile', () => {
  it('handles single element array', () => {
    expect(calculatePercentile([0.85], 50)).toBe(0.85);
    expect(calculatePercentile([0.85], 95)).toBe(0.85);
    expect(calculatePercentile([0.85], 99)).toBe(0.85);
  });

  it('handles empty array', () => {
    expect(calculatePercentile([], 50)).toBe(0);
    expect(calculatePercentile([], 95)).toBe(0);
  });

  it('calculates p50 (median) correctly', () => {
    const values = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const p50 = calculatePercentile(values, 50);
    expect(p50).toBeCloseTo(0.5, 1);
  });

  it('calculates p95 correctly', () => {
    const values = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const p95 = calculatePercentile(values, 95);
    // p95 should be near the top (around 0.91-0.95)
    expect(p95).toBeGreaterThan(0.9);
    expect(p95).toBeLessThanOrEqual(1.0);
  });

  it('calculates p99 correctly', () => {
    const values = Array.from({ length: 100 }, (_, i) => (i + 1) / 100);
    const p99 = calculatePercentile(values, 99);
    expect(p99).toBeGreaterThan(0.98);
    expect(p99).toBeLessThanOrEqual(1.0);
  });

  it('handles percentile 0 (minimum)', () => {
    expect(calculatePercentile([0.1, 0.5, 0.9], 0)).toBe(0.1);
  });

  it('handles percentile 100 (maximum)', () => {
    expect(calculatePercentile([0.1, 0.5, 0.9], 100)).toBe(0.9);
  });

  it('handles out-of-bounds percentiles', () => {
    const values = [0.1, 0.5, 0.9];
    expect(calculatePercentile(values, -10)).toBe(0.1);
    expect(calculatePercentile(values, 110)).toBe(0.9);
  });
});

describe('calculateConfidencePercentiles', () => {
  it('handles empty array', () => {
    const result = calculateConfidencePercentiles([]);
    expect(result.sampleCount).toBe(0);
    expect(result.p50).toBe(0);
    expect(result.p95).toBe(0);
    expect(result.p99).toBe(0);
  });

  it('handles single sample', () => {
    const result = calculateConfidencePercentiles([0.87]);
    expect(result.sampleCount).toBe(1);
    expect(result.min).toBe(0.87);
    expect(result.max).toBe(0.87);
    expect(result.mean).toBe(0.87);
    expect(result.p50).toBe(0.87);
    expect(result.p95).toBe(0.87);
    expect(result.p99).toBe(0.87);
  });

  it('handles all high confidence', () => {
    const values = [0.95, 0.96, 0.97, 0.98, 0.99, 1.0];
    const result = calculateConfidencePercentiles(values);
    expect(result.sampleCount).toBe(6);
    expect(result.min).toBe(0.95);
    expect(result.max).toBe(1.0);
    expect(result.p50).toBeGreaterThan(0.95);
    expect(result.p95).toBeGreaterThan(0.98);
  });

  it('handles all low confidence', () => {
    const values = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35];
    const result = calculateConfidencePercentiles(values);
    expect(result.sampleCount).toBe(6);
    expect(result.min).toBe(0.1);
    expect(result.max).toBe(0.35);
    expect(result.p50).toBeLessThan(0.3);
    expect(result.p95).toBeLessThan(0.4);
  });

  it('handles realistic distribution', () => {
    const values = [
      0.55, 0.65, 0.72, 0.78, 0.81, 0.82, 0.84, 0.85, 0.86, 0.87,
      0.88, 0.89, 0.90, 0.91, 0.92, 0.93, 0.94, 0.95, 0.96, 0.97,
      0.98, 0.99, 0.99, 0.99, 1.0
    ];
    const result = calculateConfidencePercentiles(values);
    expect(result.sampleCount).toBe(25);
    expect(result.min).toBe(0.55);
    expect(result.max).toBe(1.0);
    expect(result.mean).toBeGreaterThan(0.85);
    expect(result.p50).toBeGreaterThan(0.87);
    expect(result.p95).toBeGreaterThan(0.98);
    expect(result.p99).toBeCloseTo(1.0, 2);
  });

  it('handles identical confidence values', () => {
    const values = [0.85, 0.85, 0.85, 0.85, 0.85];
    const result = calculateConfidencePercentiles(values);
    expect(result.sampleCount).toBe(5);
    expect(result.min).toBe(0.85);
    expect(result.max).toBe(0.85);
    expect(result.mean).toBe(0.85);
    expect(result.p50).toBe(0.85);
    expect(result.p95).toBe(0.85);
    expect(result.p99).toBe(0.85);
  });
});

describe('groupConfidencesByIntent', () => {
  it('groups by intent type', () => {
    const predictions = [
      { intentType: 'booking', confidence: 0.87 },
      { intentType: 'booking', confidence: 0.92 },
      { intentType: 'inquiry', confidence: 0.95 },
      { intentType: 'inquiry', confidence: 0.88 },
    ];

    const grouped = groupConfidencesByIntent(predictions);
    expect(grouped.size).toBe(2);
    expect(grouped.get('booking')).toEqual([0.87, 0.92]);
    expect(grouped.get('inquiry')).toEqual([0.95, 0.88]);
  });

  it('handles empty array', () => {
    const grouped = groupConfidencesByIntent([]);
    expect(grouped.size).toBe(0);
  });

  it('handles single intent', () => {
    const predictions = [
      { intentType: 'booking', confidence: 0.80 },
      { intentType: 'booking', confidence: 0.90 },
    ];

    const grouped = groupConfidencesByIntent(predictions);
    expect(grouped.size).toBe(1);
    expect(grouped.has('booking')).toBe(true);
  });
});

describe('generateDistributionReport', () => {
  it('generates report for multiple intents', () => {
    const predictions = [
      { intentType: 'booking', confidence: 0.85 },
      { intentType: 'booking', confidence: 0.90 },
      { intentType: 'booking', confidence: 0.88 },
      { intentType: 'inquiry', confidence: 0.92 },
      { intentType: 'inquiry', confidence: 0.95 },
    ];

    const report = generateDistributionReport(predictions);
    expect(report.size).toBe(2);

    const bookingStats = report.get('booking');
    expect(bookingStats?.sampleCount).toBe(3);
    expect(bookingStats?.min).toBe(0.85);
    expect(bookingStats?.max).toBe(0.90);

    const inquiryStats = report.get('inquiry');
    expect(inquiryStats?.sampleCount).toBe(2);
    expect(inquiryStats?.min).toBe(0.92);
    expect(inquiryStats?.max).toBe(0.95);
  });

  it('handles empty predictions', () => {
    const report = generateDistributionReport([]);
    expect(report.size).toBe(0);
  });

  it('calculates means correctly', () => {
    const predictions = [
      { intentType: 'booking', confidence: 0.80 },
      { intentType: 'booking', confidence: 0.90 },
    ];

    const report = generateDistributionReport(predictions);
    const stats = report.get('booking');
    expect(stats?.mean).toBeCloseTo(0.85, 5);
  });
});
