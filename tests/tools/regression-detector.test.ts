/**
 * regression-detector.test.ts
 *
 * Tests for US-636: Intent Classification Performance Regression Detector
 */

import { describe, it, expect } from 'vitest';
import { calculateRegression, IntentAccuracyData } from '../../src/tools/regression-detector.js';

describe('Regression Detector', () => {
  describe('calculateRegression', () => {
    it('should detect no regression when accuracy is stable', () => {
      const currentData: IntentAccuracyData[] = [
        {
          profileId: 'pelangi',
          intentType: 'booking',
          totalCount: 100,
          correctCount: 85,
          accuracyPct: 85,
        },
        {
          profileId: 'pelangi',
          intentType: 'checkout',
          totalCount: 50,
          correctCount: 45,
          accuracyPct: 90,
        },
      ];

      const baselineData: IntentAccuracyData[] = [
        {
          profileId: 'pelangi',
          intentType: 'booking',
          totalCount: 100,
          correctCount: 85,
          accuracyPct: 85,
        },
        {
          profileId: 'pelangi',
          intentType: 'checkout',
          totalCount: 50,
          correctCount: 45,
          accuracyPct: 90,
        },
      ];

      const result = calculateRegression('pelangi', currentData, baselineData);

      expect(result.hasRegression).toBe(false);
      expect(result.flaggedIntents).toHaveLength(0);
      expect(result.regressionPct).toBeCloseTo(0, 1);
    });

    it('should detect regression when accuracy drops more than 2%', () => {
      const currentData: IntentAccuracyData[] = [
        {
          profileId: 'pelangi',
          intentType: 'booking',
          totalCount: 100,
          correctCount: 80,
          accuracyPct: 80, // dropped from 85
        },
        {
          profileId: 'pelangi',
          intentType: 'checkout',
          totalCount: 50,
          correctCount: 45,
          accuracyPct: 90,
        },
      ];

      const baselineData: IntentAccuracyData[] = [
        {
          profileId: 'pelangi',
          intentType: 'booking',
          totalCount: 100,
          correctCount: 85,
          accuracyPct: 85,
        },
        {
          profileId: 'pelangi',
          intentType: 'checkout',
          totalCount: 50,
          correctCount: 45,
          accuracyPct: 90,
        },
      ];

      const result = calculateRegression('pelangi', currentData, baselineData);

      expect(result.hasRegression).toBe(true);
      expect(result.flaggedIntents).toHaveLength(1);
      expect(result.flaggedIntents[0].intentType).toBe('booking');
      expect(result.flaggedIntents[0].delta).toBe(-5);
    });

    it('should include per-intent breakdown in output', () => {
      const currentData: IntentAccuracyData[] = [
        {
          profileId: 'pelangi',
          intentType: 'booking',
          totalCount: 100,
          correctCount: 80,
          accuracyPct: 80,
        },
      ];

      const baselineData: IntentAccuracyData[] = [
        {
          profileId: 'pelangi',
          intentType: 'booking',
          totalCount: 100,
          correctCount: 85,
          accuracyPct: 85,
        },
      ];

      const result = calculateRegression('pelangi', currentData, baselineData);

      expect(result.perIntentBreakdown).toHaveLength(1);
      expect(result.perIntentBreakdown[0]).toMatchObject({
        intentType: 'booking',
        baselineAccuracy: 85,
        currentAccuracy: 80,
        delta: -5,
        isFlagged: true,
      });
    });

    it('should handle new intents in current period', () => {
      const currentData: IntentAccuracyData[] = [
        {
          profileId: 'pelangi',
          intentType: 'booking',
          totalCount: 100,
          correctCount: 85,
          accuracyPct: 85,
        },
        {
          profileId: 'pelangi',
          intentType: 'escalation',
          totalCount: 30,
          correctCount: 25,
          accuracyPct: 83,
        },
      ];

      const baselineData: IntentAccuracyData[] = [
        {
          profileId: 'pelangi',
          intentType: 'booking',
          totalCount: 100,
          correctCount: 85,
          accuracyPct: 85,
        },
      ];

      const result = calculateRegression('pelangi', currentData, baselineData);

      expect(result.perIntentBreakdown).toHaveLength(2);
      expect(result.perIntentBreakdown[1].intentType).toBe('escalation');
      expect(result.perIntentBreakdown[1].baselineAccuracy).toBe(0);
    });

    it('should handle missing intents in current period', () => {
      const currentData: IntentAccuracyData[] = [
        {
          profileId: 'pelangi',
          intentType: 'booking',
          totalCount: 100,
          correctCount: 85,
          accuracyPct: 85,
        },
      ];

      const baselineData: IntentAccuracyData[] = [
        {
          profileId: 'pelangi',
          intentType: 'booking',
          totalCount: 100,
          correctCount: 85,
          accuracyPct: 85,
        },
        {
          profileId: 'pelangi',
          intentType: 'escalation',
          totalCount: 30,
          correctCount: 25,
          accuracyPct: 83,
        },
      ];

      const result = calculateRegression('pelangi', currentData, baselineData);

      expect(result.perIntentBreakdown).toHaveLength(2);
      const escalation = result.perIntentBreakdown.find(i => i.intentType === 'escalation');
      expect(escalation).toBeDefined();
      expect(escalation?.currentAccuracy).toBe(0);
      expect(escalation?.isFlagged).toBe(true);
    });

    it('should calculate overall accuracy correctly', () => {
      const currentData: IntentAccuracyData[] = [
        {
          profileId: 'pelangi',
          intentType: 'booking',
          totalCount: 100,
          correctCount: 80,
          accuracyPct: 80,
        },
        {
          profileId: 'pelangi',
          intentType: 'checkout',
          totalCount: 100,
          correctCount: 100,
          accuracyPct: 100,
        },
      ];

      const baselineData: IntentAccuracyData[] = [
        {
          profileId: 'pelangi',
          intentType: 'booking',
          totalCount: 100,
          correctCount: 85,
          accuracyPct: 85,
        },
        {
          profileId: 'pelangi',
          intentType: 'checkout',
          totalCount: 100,
          correctCount: 100,
          accuracyPct: 100,
        },
      ];

      const result = calculateRegression('pelangi', currentData, baselineData);

      expect(result.accuracyCurrent).toBeCloseTo(90, 1); // (80 + 100) / 2
      expect(result.accuracyBaseline).toBeCloseTo(92.5, 1); // (85 + 100) / 2
      expect(result.regressionPct).toBeCloseTo(-2.5, 1);
    });

    it('should handle empty data gracefully', () => {
      const result = calculateRegression('pelangi', [], []);

      expect(result.accuracyCurrent).toBe(0);
      expect(result.accuracyBaseline).toBe(0);
      expect(result.regressionPct).toBe(0);
      expect(result.hasRegression).toBe(false);
      expect(result.flaggedIntents).toHaveLength(0);
    });

    it('should flag improvement correctly (should not be flagged as regression)', () => {
      const currentData: IntentAccuracyData[] = [
        {
          profileId: 'pelangi',
          intentType: 'booking',
          totalCount: 100,
          correctCount: 90,
          accuracyPct: 90,
        },
      ];

      const baselineData: IntentAccuracyData[] = [
        {
          profileId: 'pelangi',
          intentType: 'booking',
          totalCount: 100,
          correctCount: 85,
          accuracyPct: 85,
        },
      ];

      const result = calculateRegression('pelangi', currentData, baselineData);

      expect(result.hasRegression).toBe(false);
      expect(result.flaggedIntents).toHaveLength(0);
      expect(result.perIntentBreakdown[0].isFlagged).toBe(false);
    });
  });
});
