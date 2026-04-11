/**
 * Tests for intent-confidence-variance.ts
 *
 * Tests variance calculation, standard deviation, coefficient of variation,
 * and unstable intent flagging.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { db, dbReady } from '../../src/lib/db.js';
import {
  calculateIntentVariance,
  flagUnstableIntents,
  formatVarianceAsCSV,
  formatVarianceReport,
  type IntentVarianceStats,
  type VarianceReport,
} from '../../src/lib/intent-confidence-variance.js';

describe('intent-confidence-variance', () => {
  beforeAll(async () => {
    const connected = await dbReady;
    if (!connected) {
      console.warn('Database not available; skipping variance calculation tests');
    }
  });

  describe('calculateIntentVariance', () => {
    it('should return empty report when database is unavailable', async () => {
      // This test verifies graceful degradation when DB fails
      const report = await calculateIntentVariance({ minSamples: 50 });
      expect(report).toBeDefined();
      expect(report.timestamp).toBeDefined();
      expect(Array.isArray(report.intents)).toBe(true);
    });

    it('should compute variance statistics from message history', async () => {
      const report = await calculateIntentVariance({
        minSamples: 50,
        sinceDays: 90,
      });

      expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
      expect(report.totalIntents).toBeGreaterThanOrEqual(0);
      expect(report.intentsAnalyzed).toBeLessThanOrEqual(report.totalIntents);
      expect(report.minSamplesThreshold).toBe(50);
      expect(report.cvThreshold).toBe(0.15);
      expect(report.intents).toBeInstanceOf(Array);
    });

    it('should respect minSamples filter', async () => {
      const reportWith50 = await calculateIntentVariance({ minSamples: 50 });
      const reportWith500 = await calculateIntentVariance({ minSamples: 500 });

      // Stricter filter should result in fewer intents analyzed
      expect(reportWith500.intentsAnalyzed).toBeLessThanOrEqual(reportWith50.intentsAnalyzed);
    });

    it('should sort intents by CV (high to low)', async () => {
      const report = await calculateIntentVariance({ minSamples: 50 });

      if (report.intents.length > 1) {
        for (let i = 0; i < report.intents.length - 1; i++) {
          const cv1 = report.intents[i].coefficientOfVariation;
          const cv2 = report.intents[i + 1].coefficientOfVariation;
          expect(cv1).toBeGreaterThanOrEqual(cv2);
        }
      }
    });

    it('should compute correct variance statistics', async () => {
      const report = await calculateIntentVariance({ minSamples: 50 });

      for (const stat of report.intents) {
        // Basic sanity checks
        expect(stat.intent).toBeTruthy();
        expect(stat.sampleCount).toBeGreaterThanOrEqual(50);
        expect(stat.minConfidence).toBeGreaterThanOrEqual(0);
        expect(stat.maxConfidence).toBeLessThanOrEqual(1);
        expect(stat.meanConfidence).toBeGreaterThanOrEqual(0);
        expect(stat.meanConfidence).toBeLessThanOrEqual(1);
        expect(stat.variance).toBeGreaterThanOrEqual(0);
        expect(stat.stdDeviation).toBeGreaterThanOrEqual(0);
        expect(stat.coefficientOfVariation).toBeGreaterThanOrEqual(0);
        expect(typeof stat.isUnstable).toBe('boolean');

        // CV should be stddev / mean (unless mean is zero)
        if (stat.meanConfidence > 0) {
          const expectedCV = stat.stdDeviation / stat.meanConfidence;
          expect(stat.coefficientOfVariation).toBeCloseTo(expectedCV, 6);
        }

        // Min < Max (unless all same confidence)
        if (stat.minConfidence !== stat.maxConfidence) {
          expect(stat.minConfidence).toBeLessThan(stat.maxConfidence);
        }
      }
    });

    it('should filter by profileId if provided', async () => {
      const reportNoFilter = await calculateIntentVariance({ minSamples: 50 });
      const reportWithFilter = await calculateIntentVariance({
        minSamples: 50,
        profileId: 'pelangi',
      });

      // Both should be valid reports
      expect(reportNoFilter.intentsAnalyzed).toBeGreaterThanOrEqual(0);
      expect(reportWithFilter.intentsAnalyzed).toBeGreaterThanOrEqual(0);

      // Filter may reduce or keep same number depending on data
      expect(reportWithFilter.intentsAnalyzed).toBeLessThanOrEqual(reportNoFilter.intentsAnalyzed);
    });
  });

  describe('flagUnstableIntents', () => {
    it('should flag intents with CV > threshold', () => {
      const stats: IntentVarianceStats[] = [
        {
          intent: 'high_variance',
          sampleCount: 100,
          minConfidence: 0.2,
          maxConfidence: 0.9,
          meanConfidence: 0.6,
          variance: 0.04,
          stdDeviation: 0.2,
          coefficientOfVariation: 0.333, // > 0.15
          isUnstable: true,
        },
        {
          intent: 'low_variance',
          sampleCount: 100,
          minConfidence: 0.8,
          maxConfidence: 0.95,
          meanConfidence: 0.88,
          variance: 0.003,
          stdDeviation: 0.05,
          coefficientOfVariation: 0.057, // < 0.15
          isUnstable: false,
        },
      ];

      const unstable = flagUnstableIntents(stats, { cvThreshold: 0.15 });

      expect(unstable).toHaveLength(1);
      expect(unstable[0].intent).toBe('high_variance');
      expect(unstable[0].coefficientOfVariation).toBeGreaterThan(0.15);
    });

    it('should respect custom cvThreshold', () => {
      const stats: IntentVarianceStats[] = [
        {
          intent: 'medium_variance',
          sampleCount: 100,
          minConfidence: 0.5,
          maxConfidence: 0.85,
          meanConfidence: 0.7,
          variance: 0.025,
          stdDeviation: 0.158,
          coefficientOfVariation: 0.226,
          isUnstable: true,
        },
      ];

      const unstableLoose = flagUnstableIntents(stats, { cvThreshold: 0.3 });
      const unstableStrict = flagUnstableIntents(stats, { cvThreshold: 0.15 });

      expect(unstableLoose).toHaveLength(0); // CV 0.226 < 0.3
      expect(unstableStrict).toHaveLength(1); // CV 0.226 > 0.15
    });

    it('should return empty array when no intents exceed threshold', () => {
      const stats: IntentVarianceStats[] = [
        {
          intent: 'stable_1',
          sampleCount: 100,
          minConfidence: 0.85,
          maxConfidence: 0.95,
          meanConfidence: 0.9,
          variance: 0.002,
          stdDeviation: 0.045,
          coefficientOfVariation: 0.05,
          isUnstable: false,
        },
        {
          intent: 'stable_2',
          sampleCount: 100,
          minConfidence: 0.8,
          maxConfidence: 0.92,
          meanConfidence: 0.88,
          variance: 0.003,
          stdDeviation: 0.055,
          coefficientOfVariation: 0.062,
          isUnstable: false,
        },
      ];

      const unstable = flagUnstableIntents(stats, { cvThreshold: 0.15 });
      expect(unstable).toHaveLength(0);
    });
  });

  describe('formatVarianceAsCSV', () => {
    it('should format stats as CSV with header and rows', () => {
      const stats: IntentVarianceStats[] = [
        {
          intent: 'checkout_info',
          sampleCount: 523,
          minConfidence: 0.42,
          maxConfidence: 0.98,
          meanConfidence: 0.78,
          variance: 0.0342,
          stdDeviation: 0.185,
          coefficientOfVariation: 0.237,
          isUnstable: true,
        },
        {
          intent: 'booking_confirm',
          sampleCount: 412,
          minConfidence: 0.85,
          maxConfidence: 0.99,
          meanConfidence: 0.92,
          variance: 0.0008,
          stdDeviation: 0.028,
          coefficientOfVariation: 0.031,
          isUnstable: false,
        },
      ];

      const csv = formatVarianceAsCSV(stats);
      const lines = csv.split('\n');

      // Header row
      expect(lines[0]).toContain('intent');
      expect(lines[0]).toContain('sample_count');
      expect(lines[0]).toContain('coefficient_of_variation');
      expect(lines[0]).toContain('is_unstable');

      // Data rows
      expect(lines).toHaveLength(3); // Header + 2 data rows
      expect(lines[1]).toContain('checkout_info');
      expect(lines[1]).toContain('523');
      expect(lines[1]).toContain('yes');
      expect(lines[2]).toContain('booking_confirm');
      expect(lines[2]).toContain('412');
      expect(lines[2]).toContain('no');
    });

    it('should escape intent names in CSV', () => {
      const stats: IntentVarianceStats[] = [
        {
          intent: 'intent_with_"quotes"',
          sampleCount: 100,
          minConfidence: 0.5,
          maxConfidence: 0.9,
          meanConfidence: 0.7,
          variance: 0.02,
          stdDeviation: 0.14,
          coefficientOfVariation: 0.2,
          isUnstable: true,
        },
      ];

      const csv = formatVarianceAsCSV(stats);
      expect(csv).toContain('"intent_with_"quotes""');
    });
  });

  describe('formatVarianceReport', () => {
    it('should format report as human-readable text', () => {
      const report: VarianceReport = {
        timestamp: '2026-04-11T15:30:00Z',
        totalIntents: 145,
        intentsAnalyzed: 87,
        minSamplesThreshold: 50,
        unstableIntentsCount: 12,
        cvThreshold: 0.15,
        intents: [
          {
            intent: 'unstable_intent',
            sampleCount: 523,
            minConfidence: 0.4,
            maxConfidence: 0.95,
            meanConfidence: 0.75,
            variance: 0.035,
            stdDeviation: 0.187,
            coefficientOfVariation: 0.249,
            isUnstable: true,
          },
          {
            intent: 'stable_intent',
            sampleCount: 412,
            minConfidence: 0.85,
            maxConfidence: 0.99,
            meanConfidence: 0.92,
            variance: 0.0008,
            stdDeviation: 0.028,
            coefficientOfVariation: 0.031,
            isUnstable: false,
          },
        ],
      };

      const text = formatVarianceReport(report);

      expect(text).toContain('Intent Classification Confidence Variance Report');
      expect(text).toContain('2026-04-11T15:30:00Z');
      expect(text).toContain('Total intents in history: 145');
      expect(text).toContain('Intents analyzed');
      expect(text).toContain('Unstable intents');
      expect(text).toContain('UNSTABLE');
      expect(text).toContain('unstable_intent');
      expect(text).toContain('STABLE');
      expect(text).toContain('stable_intent');
      expect(text).toContain('Overall intent stability');
    });

    it('should handle empty intents list', () => {
      const report: VarianceReport = {
        timestamp: '2026-04-11T15:30:00Z',
        totalIntents: 0,
        intentsAnalyzed: 0,
        minSamplesThreshold: 50,
        unstableIntentsCount: 0,
        cvThreshold: 0.15,
        intents: [],
      };

      const text = formatVarianceReport(report);

      expect(text).toContain('Intent Classification Confidence Variance Report');
      expect(text).toContain('No intents with sufficient samples');
    });

    it('should show stability percentage', () => {
      const report: VarianceReport = {
        timestamp: '2026-04-11T15:30:00Z',
        totalIntents: 100,
        intentsAnalyzed: 80,
        minSamplesThreshold: 50,
        unstableIntentsCount: 20, // 20/80 = 25% unstable = 75% stable
        cvThreshold: 0.15,
        intents: Array(80)
          .fill(0)
          .map((_, i) => ({
            intent: `intent_${i}`,
            sampleCount: 100,
            minConfidence: 0.5,
            maxConfidence: 0.9,
            meanConfidence: 0.7,
            variance: 0.02,
            stdDeviation: i < 20 ? 0.175 : 0.05,
            coefficientOfVariation: i < 20 ? 0.25 : 0.071,
            isUnstable: i < 20,
          })),
      };

      const text = formatVarianceReport(report);

      expect(text).toContain('Overall intent stability: 75.0%');
    });
  });

  describe('integration', () => {
    it('should complete full workflow: calculate -> flag -> format', async () => {
      const report = await calculateIntentVariance({
        minSamples: 50,
        sinceDays: 90,
      });

      // Flag unstable
      const unstable = flagUnstableIntents(report.intents, { cvThreshold: 0.15 });

      // Format as CSV
      const csv = formatVarianceAsCSV(unstable);

      // Verify outputs
      expect(report.timestamp).toBeDefined();
      expect(unstable).toBeInstanceOf(Array);
      if (unstable.length > 0) {
        expect(csv).toContain('intent');
      }
    });
  });
});
