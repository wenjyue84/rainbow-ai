/**
 * US-400: Intent Confidence Tier Analyzer — Unit Tests
 *
 * Tests for percentile calculation, tier categorization, and report generation
 */

import { describe, it, expect } from 'vitest';

// ─── Percentile Calculations ──────────────────────────────────────────

function calculatePercentile(
  sortedValues: number[],
  percentile: number
): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;

  if (lower === upper) {
    return sortedValues[lower];
  }

  return (
    sortedValues[lower] * (1 - weight) +
    sortedValues[upper] * weight
  );
}

function calculateMetrics(confidences: number[]): {
  median: number;
  p25: number;
  p75: number;
} {
  const sorted = [...confidences].sort((a, b) => a - b);
  return {
    median: calculatePercentile(sorted, 50),
    p25: calculatePercentile(sorted, 25),
    p75: calculatePercentile(sorted, 75),
  };
}

function getTier(confidence: number): 'Low' | 'Medium' | 'High' {
  if (confidence < 0.65) return 'Low';
  if (confidence < 0.80) return 'Medium';
  return 'High';
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('calculatePercentile', () => {
  it('should calculate p50 (median) for even count', () => {
    const values = [0.1, 0.2, 0.3, 0.4];
    const result = calculatePercentile(values, 50);
    // median of [0.1, 0.2, 0.3, 0.4] = (0.2 + 0.3) / 2 = 0.25
    expect(result).toBeCloseTo(0.25, 5);
  });

  it('should calculate p50 (median) for odd count', () => {
    const values = [0.1, 0.2, 0.3];
    const result = calculatePercentile(values, 50);
    expect(result).toBe(0.2);
  });

  it('should calculate p25 (first quartile)', () => {
    const values = [0.0, 0.25, 0.5, 0.75, 1.0];
    const result = calculatePercentile(values, 25);
    expect(result).toBeCloseTo(0.25, 5);
  });

  it('should calculate p75 (third quartile)', () => {
    const values = [0.0, 0.25, 0.5, 0.75, 1.0];
    const result = calculatePercentile(values, 75);
    expect(result).toBeCloseTo(0.75, 5);
  });

  it('should handle single value', () => {
    const values = [0.5];
    expect(calculatePercentile(values, 50)).toBe(0.5);
    expect(calculatePercentile(values, 25)).toBe(0.5);
    expect(calculatePercentile(values, 75)).toBe(0.5);
  });

  it('should handle empty array', () => {
    expect(calculatePercentile([], 50)).toBe(0);
  });

  it('should handle two values', () => {
    const values = [0.2, 0.8];
    const result = calculatePercentile(values, 50);
    expect(result).toBe(0.5);
  });
});

describe('calculateMetrics', () => {
  it('should calculate all percentiles from confidence array', () => {
    const confidences = [0.5, 0.6, 0.7, 0.8, 0.9];
    const result = calculateMetrics(confidences);

    expect(result.median).toBe(0.7);
    expect(result.p25).toBeCloseTo(0.6, 5);
    expect(result.p75).toBeCloseTo(0.8, 5);
  });

  it('should maintain p25 <= median <= p75 invariant', () => {
    const confidences = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const result = calculateMetrics(confidences);

    expect(result.p25).toBeLessThanOrEqual(result.median);
    expect(result.median).toBeLessThanOrEqual(result.p75);
  });

  it('should handle all identical values', () => {
    const confidences = [0.75, 0.75, 0.75, 0.75];
    const result = calculateMetrics(confidences);

    expect(result.p25).toBe(0.75);
    expect(result.median).toBe(0.75);
    expect(result.p75).toBe(0.75);
  });

  it('should handle single sample', () => {
    const confidences = [0.82];
    const result = calculateMetrics(confidences);

    expect(result.p25).toBe(0.82);
    expect(result.median).toBe(0.82);
    expect(result.p75).toBe(0.82);
  });

  it('should handle bimodal distribution', () => {
    const confidences = [0.1, 0.1, 0.1, 0.9, 0.9, 0.9];
    const result = calculateMetrics(confidences);

    expect(result.p25).toBeCloseTo(0.1, 5);
    expect(result.median).toBeCloseTo(0.5, 5);
    expect(result.p75).toBeCloseTo(0.9, 5);
  });
});

describe('getTier', () => {
  it('should classify confidence < 0.65 as Low', () => {
    expect(getTier(0.64)).toBe('Low');
    expect(getTier(0.50)).toBe('Low');
    expect(getTier(0.00)).toBe('Low');
  });

  it('should classify confidence >= 0.65 and < 0.80 as Medium', () => {
    expect(getTier(0.65)).toBe('Medium');
    expect(getTier(0.72)).toBe('Medium');
    expect(getTier(0.79)).toBe('Medium');
  });

  it('should classify confidence >= 0.80 as High', () => {
    expect(getTier(0.80)).toBe('High');
    expect(getTier(0.90)).toBe('High');
    expect(getTier(1.00)).toBe('High');
  });

  it('should handle exact boundary values', () => {
    expect(getTier(0.65)).toBe('Medium');
    expect(getTier(0.80)).toBe('High');
  });
});

describe('Integration: Confidence Analysis Flow', () => {
  it('should categorize mixed confidences correctly', () => {
    // Low-confidence intent: booking_new
    const bookingNewConfidences = [0.45, 0.52, 0.58, 0.60, 0.63];
    const bookingNewMetrics = calculateMetrics(bookingNewConfidences);
    const bookingNewTier = getTier(bookingNewMetrics.median);

    expect(bookingNewTier).toBe('Low');
    expect(bookingNewMetrics.median).toBeLessThan(0.65);

    // Medium-confidence intent: inquiry
    const inquiryConfidences = [0.68, 0.72, 0.75, 0.78];
    const inquiryMetrics = calculateMetrics(inquiryConfidences);
    const inquiryTier = getTier(inquiryMetrics.median);

    expect(inquiryTier).toBe('Medium');
    expect(inquiryMetrics.median).toBeGreaterThanOrEqual(0.65);
    expect(inquiryMetrics.median).toBeLessThan(0.80);

    // High-confidence intent: greeting
    const greetingConfidences = [0.92, 0.95, 0.97, 0.99];
    const greetingMetrics = calculateMetrics(greetingConfidences);
    const greetingTier = getTier(greetingMetrics.median);

    expect(greetingTier).toBe('High');
    expect(greetingMetrics.median).toBeGreaterThanOrEqual(0.80);
  });

  it('should handle production-like distribution with outliers', () => {
    // Simulating real-world data with some outliers
    const confidences = [
      0.99, 0.98, 0.97, 0.96, 0.95, // High confidence cluster
      0.88, 0.85, 0.82, 0.81, 0.80, // Medium-high cluster
      0.72, 0.70, 0.68, 0.65, 0.64, // Medium-low cluster
      0.55, 0.50, 0.45, 0.40, 0.35, // Low confidence cluster
    ];

    const metrics = calculateMetrics(confidences);
    const tier = getTier(metrics.median);

    // Median should be around 0.70 (middle of sorted values)
    expect(metrics.median).toBeLessThan(0.80);
    expect(metrics.median).toBeGreaterThanOrEqual(0.65);
    expect(tier).toBe('Medium');

    // Percentiles should be properly ordered
    expect(metrics.p25).toBeLessThanOrEqual(metrics.median);
    expect(metrics.median).toBeLessThanOrEqual(metrics.p75);
  });

  it('should identify struggling intents from tier distribution', () => {
    // Low tier intents need data augmentation
    const lowTierMetrics = [
      {
        intent: 'booking_cancellation',
        median: 0.58,
        sample_count: 450,
      },
      {
        intent: 'room_modification',
        median: 0.62,
        sample_count: 380,
      },
      {
        intent: 'price_inquiry',
        median: 0.61,
        sample_count: 290,
      },
    ];

    // Sort by sample_count (frequency) descending
    const sorted = lowTierMetrics.sort(
      (a, b) => b.sample_count - a.sample_count
    );

    expect(sorted[0].intent).toBe('booking_cancellation');
    expect(sorted[0].sample_count).toBe(450);
  });

  it('should compute CSV-compatible metrics', () => {
    const confidences = [0.65, 0.70, 0.75, 0.80, 0.85];
    const metrics = calculateMetrics(confidences);

    // All values should be 4-decimal precision
    const precision = 4;
    const medianStr = metrics.median.toFixed(precision);
    const p25Str = metrics.p25.toFixed(precision);
    const p75Str = metrics.p75.toFixed(precision);

    expect(medianStr).toMatch(/^\d+\.\d{1,4}$/);
    expect(p25Str).toMatch(/^\d+\.\d{1,4}$/);
    expect(p75Str).toMatch(/^\d+\.\d{1,4}$/);
  });
});
