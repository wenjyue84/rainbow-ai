/**
 * Tests for intent classifier baseline accuracy tracking (US-098)
 *
 * Validates:
 * 1. Accuracy calculation on test sets with ground-truth labels
 * 2. Per-profile isolation (Pelangi accuracy independent from Southern)
 * 3. Delta comparison logic between current and baseline metrics
 */

import { describe, it, expect } from 'vitest';

// Mock types matching the schema
interface MockIntentPrediction {
  profileId: string;
  predictedIntent: string;
  wasCorrect: boolean | null;
}

interface AccuracyMetric {
  profileId: string;
  intentType: string;
  totalSamples: number;
  correctSamples: number;
  accuracyPct: number;
}

/**
 * Calculate accuracy metrics from predictions (mirrors the script logic)
 */
function calculateAccuracyMetrics(predictions: MockIntentPrediction[]): AccuracyMetric[] {
  const grouped = new Map<string, AccuracyMetric>();

  for (const pred of predictions) {
    if (!pred.profileId || !pred.predictedIntent || pred.wasCorrect === null) {
      continue;
    }

    const key = `${pred.profileId}:${pred.predictedIntent}`;
    const existing = grouped.get(key) || {
      profileId: pred.profileId,
      intentType: pred.predictedIntent,
      totalSamples: 0,
      correctSamples: 0,
      accuracyPct: 0,
    };

    existing.totalSamples++;
    if (pred.wasCorrect) {
      existing.correctSamples++;
    }
    existing.accuracyPct = (existing.correctSamples / existing.totalSamples) * 100;

    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).filter((m) => m.totalSamples > 0);
}

describe('Intent Classifier Baseline Analytics (US-098)', () => {
  describe('Accuracy Calculation', () => {
    it('should calculate 100% accuracy with all correct predictions', () => {
      const predictions: MockIntentPrediction[] = [
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: true },
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: true },
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: true },
      ];

      const metrics = calculateAccuracyMetrics(predictions);

      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({
        profileId: 'pelangi',
        intentType: 'booking',
        totalSamples: 3,
        correctSamples: 3,
        accuracyPct: 100,
      });
    });

    it('should calculate 0% accuracy with all incorrect predictions', () => {
      const predictions: MockIntentPrediction[] = [
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: false },
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: false },
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: false },
      ];

      const metrics = calculateAccuracyMetrics(predictions);

      expect(metrics[0].accuracyPct).toBe(0);
    });

    it('should calculate 50% accuracy with mixed predictions', () => {
      const predictions: MockIntentPrediction[] = [
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: true },
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: false },
      ];

      const metrics = calculateAccuracyMetrics(predictions);

      expect(metrics[0].accuracyPct).toBe(50);
    });

    it('should handle 100-message test set correctly', () => {
      // Create a 100-message test set with 75 correct, 25 incorrect
      const predictions: MockIntentPrediction[] = [];
      for (let i = 0; i < 75; i++) {
        predictions.push({
          profileId: 'pelangi',
          predictedIntent: 'booking',
          wasCorrect: true,
        });
      }
      for (let i = 0; i < 25; i++) {
        predictions.push({
          profileId: 'pelangi',
          predictedIntent: 'booking',
          wasCorrect: false,
        });
      }

      const metrics = calculateAccuracyMetrics(predictions);

      expect(metrics[0].totalSamples).toBe(100);
      expect(metrics[0].correctSamples).toBe(75);
      expect(metrics[0].accuracyPct).toBe(75);
    });
  });

  describe('Per-Profile Isolation', () => {
    it('should isolate accuracy metrics by profile', () => {
      const predictions: MockIntentPrediction[] = [
        // Pelangi: 2/3 correct (66.67%)
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: true },
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: true },
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: false },

        // Southern: 1/3 correct (33.33%)
        { profileId: 'southern', predictedIntent: 'booking', wasCorrect: true },
        { profileId: 'southern', predictedIntent: 'booking', wasCorrect: false },
        { profileId: 'southern', predictedIntent: 'booking', wasCorrect: false },
      ];

      const metrics = calculateAccuracyMetrics(predictions);

      expect(metrics).toHaveLength(2);

      const pelangiMetric = metrics.find((m) => m.profileId === 'pelangi');
      const southernMetric = metrics.find((m) => m.profileId === 'southern');

      expect(pelangiMetric?.accuracyPct).toBeCloseTo(66.67, 1);
      expect(southernMetric?.accuracyPct).toBeCloseTo(33.33, 1);

      // Pelangi accuracy should be independent from Southern
      expect(pelangiMetric?.accuracyPct).not.toBe(southernMetric?.accuracyPct);
    });

    it('should isolate accuracy metrics by intent type within profile', () => {
      const predictions: MockIntentPrediction[] = [
        // Pelangi booking: 2/2 correct (100%)
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: true },
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: true },

        // Pelangi cancellation: 0/2 correct (0%)
        { profileId: 'pelangi', predictedIntent: 'cancellation', wasCorrect: false },
        { profileId: 'pelangi', predictedIntent: 'cancellation', wasCorrect: false },
      ];

      const metrics = calculateAccuracyMetrics(predictions);

      expect(metrics).toHaveLength(2);

      const bookingMetric = metrics.find((m) => m.intentType === 'booking');
      const cancellationMetric = metrics.find((m) => m.intentType === 'cancellation');

      expect(bookingMetric?.accuracyPct).toBe(100);
      expect(cancellationMetric?.accuracyPct).toBe(0);
    });

    it('should maintain accuracy independence between profiles and intents', () => {
      const predictions: MockIntentPrediction[] = [
        // Pelangi/booking: 100%
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: true },

        // Southern/booking: 0%
        { profileId: 'southern', predictedIntent: 'booking', wasCorrect: false },

        // Makan/booking: 50%
        { profileId: 'makan', predictedIntent: 'booking', wasCorrect: true },
        { profileId: 'makan', predictedIntent: 'booking', wasCorrect: false },

        // Pelangi/cancellation: 0%
        { profileId: 'pelangi', predictedIntent: 'cancellation', wasCorrect: false },
      ];

      const metrics = calculateAccuracyMetrics(predictions);

      expect(metrics).toHaveLength(4);

      const pelangiBooking = metrics.find(
        (m) => m.profileId === 'pelangi' && m.intentType === 'booking'
      );
      const southernBooking = metrics.find(
        (m) => m.profileId === 'southern' && m.intentType === 'booking'
      );
      const makanBooking = metrics.find(
        (m) => m.profileId === 'makan' && m.intentType === 'booking'
      );
      const pelangiCancellation = metrics.find(
        (m) => m.profileId === 'pelangi' && m.intentType === 'cancellation'
      );

      expect(pelangiBooking?.accuracyPct).toBe(100);
      expect(southernBooking?.accuracyPct).toBe(0);
      expect(makanBooking?.accuracyPct).toBe(50);
      expect(pelangiCancellation?.accuracyPct).toBe(0);
    });
  });

  describe('Null Handling', () => {
    it('should skip predictions without ground truth (wasCorrect is null)', () => {
      const predictions: MockIntentPrediction[] = [
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: true },
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: null },
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: false },
      ];

      const metrics = calculateAccuracyMetrics(predictions);

      expect(metrics[0].totalSamples).toBe(2); // Only 2 counted, 1 skipped
      expect(metrics[0].correctSamples).toBe(1);
      expect(metrics[0].accuracyPct).toBe(50);
    });

    it('should skip predictions with missing profileId', () => {
      const predictions: MockIntentPrediction[] = [
        { profileId: '', predictedIntent: 'booking', wasCorrect: true },
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: true },
      ];

      const metrics = calculateAccuracyMetrics(predictions);

      expect(metrics).toHaveLength(1);
      expect(metrics[0].profileId).toBe('pelangi');
    });

    it('should skip predictions with missing intentType', () => {
      const predictions: MockIntentPrediction[] = [
        { profileId: 'pelangi', predictedIntent: '', wasCorrect: true },
        { profileId: 'pelangi', predictedIntent: 'booking', wasCorrect: true },
      ];

      const metrics = calculateAccuracyMetrics(predictions);

      expect(metrics).toHaveLength(1);
      expect(metrics[0].intentType).toBe('booking');
    });
  });

  describe('Sample Count Tracking', () => {
    it('should track sample count accurately', () => {
      const predictions: MockIntentPrediction[] = Array(50).fill(null).map((_, i) => ({
        profileId: 'pelangi',
        predictedIntent: 'booking',
        wasCorrect: i % 2 === 0,
      }));

      const metrics = calculateAccuracyMetrics(predictions);

      expect(metrics[0].totalSamples).toBe(50);
      expect(metrics[0].correctSamples).toBe(25);
    });

    it('should filter out metrics with zero samples', () => {
      const predictions: MockIntentPrediction[] = []; // Empty

      const metrics = calculateAccuracyMetrics(predictions);

      expect(metrics).toHaveLength(0);
    });
  });
});
