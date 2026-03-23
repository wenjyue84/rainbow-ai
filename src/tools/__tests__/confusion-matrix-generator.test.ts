import { describe, it, expect } from 'vitest';
import {
  buildConfusionMatrix,
  calculateAccuracy,
  formatAsCSV,
  type ConfusionMatrixResult,
} from '../confusion-matrix-generator.js';

describe('Confusion Matrix Generator', () => {
  describe('buildConfusionMatrix', () => {
    it('should build confusion matrix from simple dataset', () => {
      const rows = [
        { predictedIntent: 'booking', actualIntent: 'inquiry' },
        { predictedIntent: 'booking', actualIntent: 'inquiry' },
        { predictedIntent: 'payment', actualIntent: 'booking' },
      ];

      const result = buildConfusionMatrix(rows, 5);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        predictedIntent: 'booking',
        actualIntent: 'inquiry',
        count: 2,
      });
      expect(result[1]).toEqual({
        predictedIntent: 'payment',
        actualIntent: 'booking',
        count: 1,
      });
    });

    it('should return top N pairs sorted by count descending', () => {
      const rows = [
        { predictedIntent: 'a', actualIntent: 'b' },
        { predictedIntent: 'a', actualIntent: 'b' },
        { predictedIntent: 'a', actualIntent: 'b' },
        { predictedIntent: 'c', actualIntent: 'd' },
        { predictedIntent: 'c', actualIntent: 'd' },
        { predictedIntent: 'e', actualIntent: 'f' },
      ];

      const result = buildConfusionMatrix(rows, 2);

      expect(result).toHaveLength(2);
      expect(result[0].count).toBe(3); // a->b with 3 occurrences
      expect(result[1].count).toBe(2); // c->d with 2 occurrences
    });

    it('should handle empty dataset', () => {
      const result = buildConfusionMatrix([], 5);
      expect(result).toEqual([]);
    });

    it('should handle single row', () => {
      const rows = [{ predictedIntent: 'check_in', actualIntent: 'booking' }];
      const result = buildConfusionMatrix(rows, 5);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        predictedIntent: 'check_in',
        actualIntent: 'booking',
        count: 1,
      });
    });

    it('should respect topN limit', () => {
      const rows = Array.from({ length: 10 }, (_, i) => ({
        predictedIntent: `intent_${i % 3}`,
        actualIntent: `intent_${(i + 1) % 3}`,
      }));

      const result = buildConfusionMatrix(rows, 3);
      expect(result).toHaveLength(3);
    });

    it('should aggregate multiple misclassifications per pair', () => {
      const rows = [
        { predictedIntent: 'booking', actualIntent: 'inquiry' },
        { predictedIntent: 'booking', actualIntent: 'inquiry' },
        { predictedIntent: 'booking', actualIntent: 'inquiry' },
        { predictedIntent: 'booking', actualIntent: 'inquiry' },
      ];

      const result = buildConfusionMatrix(rows, 5);

      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(4);
    });
  });

  describe('calculateAccuracy', () => {
    it('should calculate 100% accuracy when no misclassifications', () => {
      const accuracy = calculateAccuracy(100, 0);
      expect(accuracy).toBe(100);
    });

    it('should calculate 50% accuracy with half misclassified', () => {
      const accuracy = calculateAccuracy(100, 50);
      expect(accuracy).toBe(50);
    });

    it('should return 0 when totalEvaluated is 0', () => {
      const accuracy = calculateAccuracy(0, 0);
      expect(accuracy).toBe(0);
    });

    it('should round to 2 decimal places', () => {
      const accuracy = calculateAccuracy(1000, 333);
      // (1000 - 333) / 1000 = 0.667 = 66.7%
      expect(accuracy).toBe(66.7);
    });

    it('should handle partial misclassification', () => {
      const accuracy = calculateAccuracy(200, 1);
      // (200 - 1) / 200 = 0.995 = 99.5%
      expect(accuracy).toBe(99.5);
    });
  });

  describe('formatAsCSV', () => {
    it('should format result as CSV with header and data rows', () => {
      const result: ConfusionMatrixResult = {
        profile: 'pelangi',
        days: 7,
        totalEvaluated: 100,
        totalMisclassified: 10,
        overallAccuracy: 90,
        topPairs: [
          { predictedIntent: 'booking', actualIntent: 'inquiry', count: 5, percentage: 50 },
          { predictedIntent: 'payment', actualIntent: 'booking', count: 3, percentage: 30 },
          { predictedIntent: 'check_in', actualIntent: 'booking', count: 2, percentage: 20 },
        ],
      };

      const csv = formatAsCSV(result);

      expect(csv).toContain('# Confusion Matrix — profile=pelangi days=7');
      expect(csv).toContain('# Total evaluated: 100');
      expect(csv).toContain('# Total misclassified: 10');
      expect(csv).toContain('# Overall accuracy: 90%');
      expect(csv).toContain('predicted_intent,actual_intent,count,percentage');
      expect(csv).toContain('booking,inquiry,5,50');
      expect(csv).toContain('payment,booking,3,30');
      expect(csv).toContain('check_in,booking,2,20');
    });

    it('should handle empty top pairs', () => {
      const result: ConfusionMatrixResult = {
        profile: 'pelangi',
        days: 7,
        totalEvaluated: 0,
        totalMisclassified: 0,
        overallAccuracy: 0,
        topPairs: [],
      };

      const csv = formatAsCSV(result);

      expect(csv).toContain('# Total evaluated: 0');
      expect(csv).toContain('# Total misclassified: 0');
      expect(csv).toContain('predicted_intent,actual_intent,count,percentage');
    });

    it('should format percentages correctly in CSV', () => {
      const result: ConfusionMatrixResult = {
        profile: 'southern',
        days: 30,
        totalEvaluated: 50,
        totalMisclassified: 5,
        overallAccuracy: 90,
        topPairs: [
          { predictedIntent: 'a', actualIntent: 'b', count: 3, percentage: 60 },
          { predictedIntent: 'c', actualIntent: 'd', count: 2, percentage: 40 },
        ],
      };

      const csv = formatAsCSV(result);
      const lines = csv.split('\n');
      // Filter: exclude comments (#) and the header line
      const dataLines = lines.filter(
        (line) => !line.startsWith('#') && line !== '' && !line.includes('predicted_intent')
      );

      expect(dataLines[0]).toBe('a,b,3,60');
      expect(dataLines[1]).toBe('c,d,2,40');
    });

    it('should distinguish between different profiles in header', () => {
      const result1: ConfusionMatrixResult = {
        profile: 'pelangi',
        days: 7,
        totalEvaluated: 100,
        totalMisclassified: 10,
        overallAccuracy: 90,
        topPairs: [],
      };

      const csv1 = formatAsCSV(result1);
      expect(csv1).toContain('profile=pelangi');

      const result2: ConfusionMatrixResult = {
        ...result1,
        profile: 'southern',
      };

      const csv2 = formatAsCSV(result2);
      expect(csv2).toContain('profile=southern');
    });
  });

  describe('Integration: Full workflow', () => {
    it('should correctly process a realistic dataset to 95% accuracy', () => {
      // Note: buildConfusionMatrix only processes misclassifications (predicted != actual)
      // Correct classifications are filtered out naturally by confusion matrix logic
      const misclassifiedRows: Array<{ predictedIntent: string; actualIntent: string }> = [
        { predictedIntent: 'booking', actualIntent: 'inquiry' },
        { predictedIntent: 'booking', actualIntent: 'inquiry' },
        { predictedIntent: 'payment', actualIntent: 'booking' },
        { predictedIntent: 'check_in', actualIntent: 'booking' },
        { predictedIntent: 'check_in', actualIntent: 'inquiry' },
      ];

      const topPairs = buildConfusionMatrix(misclassifiedRows, 5);
      const totalEvaluated = 100;
      const totalMisclassified = 5;
      const accuracy = calculateAccuracy(totalEvaluated, totalMisclassified);

      // Verify 95% accuracy
      expect(accuracy).toBe(95);

      // Verify top pair is booking->inquiry with 2 occurrences (40% of misclassifications)
      expect(topPairs[0].predictedIntent).toBe('booking');
      expect(topPairs[0].actualIntent).toBe('inquiry');
      expect(topPairs[0].count).toBe(2);

      // Format as CSV and verify structure
      const result: ConfusionMatrixResult = {
        profile: 'pelangi',
        days: 7,
        totalEvaluated,
        totalMisclassified,
        overallAccuracy: accuracy,
        topPairs: topPairs.map((p) => ({
          ...p,
          percentage: (p.count / totalMisclassified) * 100,
        })),
      };

      const csv = formatAsCSV(result);
      expect(csv).toContain('# Overall accuracy: 95%');
      expect(csv).toContain('booking,inquiry');
    });
  });
});
