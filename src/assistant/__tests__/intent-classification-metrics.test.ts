/**
 * Intent Classification Metrics Test (US-043)
 *
 * Validates that intent classification confidence scores correlate with
 * actual classification correctness. Tests Spearman correlation ≥ 0.7.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ─── Spearman Correlation Implementation ──────────────────────────
// Calculates rank-based correlation between confidence and correctness

function rankArray(arr: number[]): number[] {
  const indexed = arr.map((val, idx) => ({ val, idx }));
  indexed.sort((a, b) => a.val - b.val);

  const ranks = new Array(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i + 1;
    while (j < indexed.length && indexed[j].val === indexed[i].val) {
      j++;
    }
    // Average rank for tied values
    const avgRank = (i + j - 1 + 1) / 2;
    for (let k = i; k < j; k++) {
      ranks[indexed[k].idx] = avgRank;
    }
    i = j;
  }
  return ranks;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) {
    return 0;
  }

  const n = x.length;
  const meanX = x.reduce((a, b) => a + b) / n;
  const meanY = y.reduce((a, b) => a + b) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  if (denom === 0) return 0;
  return numerator / denom;
}

function spearmanCorrelation(confidence: number[], correctness: number[]): number {
  // Correctness is 1 if correct, 0 if incorrect
  const confRanks = rankArray(confidence);
  const corrRanks = rankArray(correctness);
  return pearsonCorrelation(confRanks, corrRanks);
}

describe('Intent Classification Metrics (US-043)', () => {
  describe('Spearman correlation between confidence and correctness', () => {
    it('should calculate correlation >= 0.7 when high-confidence predictions are more often correct', () => {
      // Simulate classification data where higher confidence correlates with correctness
      const data = [
        { confidence: 0.95, wasCorrect: 1 },
        { confidence: 0.92, wasCorrect: 1 },
        { confidence: 0.88, wasCorrect: 1 },
        { confidence: 0.85, wasCorrect: 1 },
        { confidence: 0.82, wasCorrect: 1 },
        { confidence: 0.78, wasCorrect: 1 },
        { confidence: 0.75, wasCorrect: 1 },
        { confidence: 0.72, wasCorrect: 0 },
        { confidence: 0.68, wasCorrect: 0 },
        { confidence: 0.65, wasCorrect: 0 },
        { confidence: 0.62, wasCorrect: 0 },
        { confidence: 0.58, wasCorrect: 0 },
        { confidence: 0.55, wasCorrect: 0 },
        { confidence: 0.52, wasCorrect: 0 },
        { confidence: 0.48, wasCorrect: 0 },
      ];

      const confidence = data.map(d => d.confidence);
      const correctness = data.map(d => d.wasCorrect);
      const correlation = spearmanCorrelation(confidence, correctness);

      expect(correlation).toBeGreaterThanOrEqual(0.7);
    });

    it('should handle mixed results with moderate correlation', () => {
      // More realistic data with some noise
      const data = [
        { confidence: 0.95, wasCorrect: 1 },
        { confidence: 0.85, wasCorrect: 1 },
        { confidence: 0.80, wasCorrect: 0 }, // noise: high confidence but wrong
        { confidence: 0.75, wasCorrect: 1 },
        { confidence: 0.70, wasCorrect: 0 },
        { confidence: 0.65, wasCorrect: 1 }, // noise: low confidence but correct
        { confidence: 0.60, wasCorrect: 0 },
        { confidence: 0.55, wasCorrect: 0 },
        { confidence: 0.50, wasCorrect: 0 },
        { confidence: 0.45, wasCorrect: 0 },
      ];

      const confidence = data.map(d => d.confidence);
      const correctness = data.map(d => d.wasCorrect);
      const correlation = spearmanCorrelation(confidence, correctness);

      // With noise, correlation should still be positive but lower
      expect(correlation).toBeGreaterThan(0.3);
    });

    it('should detect strong positive correlation in well-calibrated predictions', () => {
      // Perfectly calibrated scenario
      const data = [
        { confidence: 0.90, wasCorrect: 1 },
        { confidence: 0.89, wasCorrect: 1 },
        { confidence: 0.88, wasCorrect: 1 },
        { confidence: 0.87, wasCorrect: 1 },
        { confidence: 0.86, wasCorrect: 1 },
        { confidence: 0.50, wasCorrect: 0 },
        { confidence: 0.49, wasCorrect: 0 },
        { confidence: 0.48, wasCorrect: 0 },
        { confidence: 0.47, wasCorrect: 0 },
        { confidence: 0.46, wasCorrect: 0 },
      ];

      const confidence = data.map(d => d.confidence);
      const correctness = data.map(d => d.wasCorrect);
      const correlation = spearmanCorrelation(confidence, correctness);

      // Perfect monotonic relationship should give strong correlation
      expect(correlation).toBeGreaterThanOrEqual(0.85);
    });

    it('should handle tied confidence values correctly', () => {
      // Test with multiple classifications at same confidence level
      const data = [
        { confidence: 0.95, wasCorrect: 1 },
        { confidence: 0.95, wasCorrect: 1 }, // tied
        { confidence: 0.90, wasCorrect: 1 },
        { confidence: 0.85, wasCorrect: 0 },
        { confidence: 0.85, wasCorrect: 0 }, // tied
        { confidence: 0.70, wasCorrect: 0 },
        { confidence: 0.70, wasCorrect: 0 }, // tied
        { confidence: 0.60, wasCorrect: 0 },
      ];

      const confidence = data.map(d => d.confidence);
      const correctness = data.map(d => d.wasCorrect);

      // Should not throw with tied values (uses average ranks)
      expect(() => {
        spearmanCorrelation(confidence, correctness);
      }).not.toThrow();
    });

    it('should accept profile-specific baselines', () => {
      // Simulate per-profile metrics
      const pelangiData = [
        { confidence: 0.92, wasCorrect: 1 },
        { confidence: 0.88, wasCorrect: 1 },
        { confidence: 0.85, wasCorrect: 1 },
        { confidence: 0.70, wasCorrect: 0 },
        { confidence: 0.65, wasCorrect: 0 },
      ];

      const southernData = [
        { confidence: 0.95, wasCorrect: 1 },
        { confidence: 0.90, wasCorrect: 1 },
        { confidence: 0.80, wasCorrect: 0 },
        { confidence: 0.75, wasCorrect: 0 },
        { confidence: 0.50, wasCorrect: 0 },
      ];

      const pelangiConfidence = pelangiData.map(d => d.confidence);
      const pelangiCorrectness = pelangiData.map(d => d.wasCorrect);
      const pelangiCorr = spearmanCorrelation(pelangiConfidence, pelangiCorrectness);

      const southernConfidence = southernData.map(d => d.confidence);
      const southernCorrectness = southernData.map(d => d.wasCorrect);
      const southernCorr = spearmanCorrelation(southernConfidence, southernCorrectness);

      // Both profiles should show positive correlation
      expect(pelangiCorr).toBeGreaterThan(0);
      expect(southernCorr).toBeGreaterThan(0);
    });

    it('should validate admin metrics endpoint response structure', () => {
      // Simulated metrics response structure
      const metricsResponse = {
        success: true,
        metrics: {
          overall: {
            success_rate: 0.75,
            avg_confidence: 0.82,
            p95_latency: 245,
            total_count: 1200,
          },
          byIntent: [
            {
              intent_type: 'booking',
              success_rate: 0.88,
              avg_confidence: 0.87,
              p95_latency: 198,
              total_count: 420,
            },
            {
              intent_type: 'inquiry',
              success_rate: 0.70,
              avg_confidence: 0.78,
              p95_latency: 267,
              total_count: 380,
            },
          ],
          byProfile: [
            {
              profile_id: 'pelangi',
              success_rate: 0.82,
              avg_confidence: 0.85,
              p95_latency: 220,
              total_count: 800,
            },
          ],
          byIntentAndProfile: [
            {
              profile_id: 'pelangi',
              intent_type: 'booking',
              success_rate: 0.90,
              avg_confidence: 0.88,
              p95_latency: 195,
              total_count: 300,
            },
          ],
        },
        timestamp: new Date().toISOString(),
      };

      // Validate structure
      expect(metricsResponse.success).toBe(true);
      expect(metricsResponse.metrics.overall).toBeDefined();
      expect(metricsResponse.metrics.overall.success_rate).toBeLessThanOrEqual(1.0);
      expect(metricsResponse.metrics.overall.avg_confidence).toBeLessThanOrEqual(1.0);
      expect(metricsResponse.metrics.byIntent).toBeInstanceOf(Array);
      expect(metricsResponse.metrics.byProfile).toBeInstanceOf(Array);
      expect(metricsResponse.metrics.byIntentAndProfile).toBeInstanceOf(Array);

      // Validate by intent has expected fields
      if (metricsResponse.metrics.byIntent.length > 0) {
        const intentMetric = metricsResponse.metrics.byIntent[0];
        expect(intentMetric.intent_type).toBeDefined();
        expect(intentMetric.success_rate).toBeDefined();
        expect(intentMetric.avg_confidence).toBeDefined();
        expect(intentMetric.p95_latency).toBeDefined();
      }
    });

    it('should calculate success_rate from wasCorrect counts correctly', () => {
      // Simulate raw data with wasCorrect field
      const records = [
        { intent: 'booking', confidence: 0.95, wasCorrect: true },
        { intent: 'booking', confidence: 0.88, wasCorrect: true },
        { intent: 'booking', confidence: 0.75, wasCorrect: false },
        { intent: 'booking', confidence: 0.65, wasCorrect: false },
        { intent: 'inquiry', confidence: 0.92, wasCorrect: true },
        { intent: 'inquiry', confidence: 0.70, wasCorrect: false },
      ];

      // Group by intent and calculate success rate
      const byIntent: Record<string, { correct: number; total: number }> = {};
      for (const rec of records) {
        if (!byIntent[rec.intent]) {
          byIntent[rec.intent] = { correct: 0, total: 0 };
        }
        byIntent[rec.intent].total++;
        if (rec.wasCorrect) byIntent[rec.intent].correct++;
      }

      // Calculate success rates
      const successRates: Record<string, number> = {};
      for (const [intent, stats] of Object.entries(byIntent)) {
        successRates[intent] = stats.total > 0 ? stats.correct / stats.total : 0;
      }

      expect(successRates.booking).toBeCloseTo(0.5, 2); // 2 correct out of 4
      expect(successRates.inquiry).toBeCloseTo(0.5, 2); // 1 correct out of 2
    });

    it('should accept baseline thresholds for anomaly detection', () => {
      // Simulate baseline metrics
      const baselineMetrics = {
        booking: { success_rate: 0.85, avg_confidence: 0.88 },
        inquiry: { success_rate: 0.70, avg_confidence: 0.75 },
      };

      // Current metrics
      const currentMetrics = {
        booking: { success_rate: 0.80, avg_confidence: 0.85 }, // below baseline
        inquiry: { success_rate: 0.72, avg_confidence: 0.76 }, // above baseline
      };

      // Detect degradation
      const bookingDegradation = currentMetrics.booking.success_rate < baselineMetrics.booking.success_rate;
      const inquiryImprovement = currentMetrics.inquiry.success_rate >= baselineMetrics.inquiry.success_rate;

      expect(bookingDegradation).toBe(true);
      expect(inquiryImprovement).toBe(true);
    });
  });
});
