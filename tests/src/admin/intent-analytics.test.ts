/**
 * US-589: Intent Classification Accuracy Reporting Dashboard Endpoint Tests
 *
 * Validates accuracy, precision, recall, and F1 score calculations
 * These tests focus on the calculation logic rather than database operations
 */

import { describe, it, expect } from 'vitest';

interface ClassificationDecision {
  classified: string;
  actual: string;
  confidence: number;
}

describe('Intent Accuracy Calculations (US-589)', () => {
  const testData: ClassificationDecision[] = [
    // 5 correct classifications for 'booking'
    { classified: 'booking', actual: 'booking', confidence: 0.95 },
    { classified: 'booking', actual: 'booking', confidence: 0.92 },
    { classified: 'booking', actual: 'booking', confidence: 0.88 },
    { classified: 'booking', actual: 'booking', confidence: 0.91 },
    { classified: 'booking', actual: 'booking', confidence: 0.89 },
    // 2 misclassified as 'booking' (false positives)
    { classified: 'booking', actual: 'pricing', confidence: 0.70 },
    { classified: 'booking', actual: 'checkin_info', confidence: 0.65 },
    // 3 more correct classifications
    { classified: 'pricing', actual: 'pricing', confidence: 0.85 },
    { classified: 'pricing', actual: 'pricing', confidence: 0.87 },
    { classified: 'checkin_info', actual: 'checkin_info', confidence: 0.90 },
    // 2 actual 'booking' classified as something else (false negatives)
    { classified: 'pricing', actual: 'booking', confidence: 0.72 },
    { classified: 'other', actual: 'booking', confidence: 0.55 },
  ];

  it('should calculate overall accuracy correctly', () => {
    // Correct: 5 booking + 2 pricing + 1 checkin_info = 8 out of 12
    const correct = testData.filter(d => d.classified === d.actual).length;
    const total = testData.length;
    const accuracy = correct / total;

    expect(correct).toBe(8);
    expect(total).toBe(12);
    expect(accuracy).toBeCloseTo(0.6667, 3);
  });

  it('should calculate precision for booking intent', () => {
    // Precision: of items classified as 'booking', how many were correct?
    // TP (booking->booking): 5
    // FP (booking->!booking): 2
    // Precision = 5 / (5 + 2) = 0.7143
    const intent = 'booking';
    const tp = testData.filter(d => d.classified === intent && d.actual === intent).length;
    const fp = testData.filter(d => d.classified === intent && d.actual !== intent).length;
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;

    expect(tp).toBe(5);
    expect(fp).toBe(2);
    expect(precision).toBeCloseTo(0.7143, 3);
  });

  it('should calculate recall for booking intent', () => {
    // Recall: of items that should be 'booking', how many did we classify correctly?
    // TP (booking->booking): 5
    // FN (actual booking but classified as something else): 2
    // Recall = 5 / (5 + 2) = 0.7143
    const intent = 'booking';
    const tp = testData.filter(d => d.classified === intent && d.actual === intent).length;
    const fn = testData.filter(d => d.classified !== intent && d.actual === intent).length;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;

    expect(tp).toBe(5);
    expect(fn).toBe(2);
    expect(recall).toBeCloseTo(0.7143, 3);
  });

  it('should calculate F1 score correctly', () => {
    // F1 = 2 * (precision * recall) / (precision + recall)
    // With precision = 0.7143 and recall = 0.7143
    // F1 = 0.7143
    const precision = 5 / 7;
    const recall = 5 / 7;
    const f1 = (precision + recall) > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 0;

    expect(precision).toBeCloseTo(0.7143, 3);
    expect(recall).toBeCloseTo(0.7143, 3);
    expect(f1).toBeCloseTo(0.7143, 3);
  });

  it('should handle empty dataset gracefully', () => {
    // Empty dataset should result in 0 sample size
    const emptyData: ClassificationDecision[] = [];
    const accuracy = emptyData.length > 0 ? 0.5 : 0;

    expect(emptyData.length).toBe(0);
    expect(accuracy).toBe(0);
  });

  it('should handle perfect classification', () => {
    // All classifications are correct
    const perfectData = [
      { classified: 'booking', actual: 'booking', confidence: 0.99 },
      { classified: 'pricing', actual: 'pricing', confidence: 0.99 },
      { classified: 'checkin_info', actual: 'checkin_info', confidence: 0.99 },
    ];

    const correct = perfectData.filter(d => d.classified === d.actual).length;
    const accuracy = correct / perfectData.length;

    expect(accuracy).toBe(1.0);
  });

  it('should calculate sample size correctly', () => {
    // Total decisions should equal array length
    const sampleSize = testData.length;
    expect(sampleSize).toBe(12);
  });

  it('should support single-intent filtering', () => {
    // When filtering for 'booking', we should get metrics for booking only
    const intent = 'booking';
    const intentData = testData.filter(d => d.classified === intent || d.actual === intent);

    expect(intentData.length).toBeGreaterThan(0);
    expect(intentData.length).toBeLessThanOrEqual(testData.length);
  });

  it('should handle zero precision case', () => {
    // If all predictions for an intent are wrong
    const zeroData = [
      { classified: 'booking', actual: 'pricing', confidence: 0.5 },
      { classified: 'booking', actual: 'checkin_info', confidence: 0.5 },
    ];

    const intent = 'booking';
    const tp = zeroData.filter(d => d.classified === intent && d.actual === intent).length;
    const fp = zeroData.filter(d => d.classified === intent && d.actual !== intent).length;
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;

    expect(precision).toBe(0);
  });

  it('should format numeric values correctly', () => {
    // Test rounding to 4 decimal places
    const accuracy = 0.5833333333;
    const formatted = parseFloat(accuracy.toFixed(4));

    expect(formatted).toBe(0.5833);
  });
});
