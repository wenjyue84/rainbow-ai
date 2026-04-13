import { describe, it, expect, beforeEach } from 'vitest';
import { computeConfusionMatrix, type ConfusionMatrixReport, type ConfusionMatrixRow } from '../intent-accuracy-scorer.js';

/**
 * Test suite for intent accuracy scorer
 * Verifies confusion matrix computation, accuracy calculations, and misclassification pair rankings
 */

describe('Intent Accuracy Scorer', () => {
  describe('computeConfusionMatrix', () => {
    it('should generate confusion matrix from feedback records', () => {
      const feedbackData = [
        { predictedIntent: 'booking', actualIntent: 'booking' },
        { predictedIntent: 'booking', actualIntent: 'booking' },
        { predictedIntent: 'booking', actualIntent: 'inquiry' },
        { predictedIntent: 'inquiry', actualIntent: 'inquiry' },
        { predictedIntent: 'inquiry', actualIntent: 'booking' },
      ];

      const report = computeConfusionMatrix(feedbackData, 'pelangi');

      expect(report.profile).toBe('pelangi');
      expect(report.totalSamples).toBe(5);
      expect(report.matrix).toBeDefined();
    });

    it('should show booking misclassified as inquiry 12 times', () => {
      const feedbackData = Array(12)
        .fill(null)
        .map(() => ({ predictedIntent: 'inquiry', actualIntent: 'booking' }))
        .concat(Array(88).fill(null).map(() => ({ predictedIntent: 'booking', actualIntent: 'booking' })));

      const report = computeConfusionMatrix(feedbackData, 'pelangi');

      const bookingRow = report.matrix.find((m) => m.actualIntent === 'booking');
      expect(bookingRow).toBeDefined();

      const misclassifiedAsInquiry = bookingRow!.predictions['inquiry'] || 0;
      expect(misclassifiedAsInquiry).toBe(12);
    });

    it('should calculate per-intent accuracy', () => {
      const feedbackData = [
        { predictedIntent: 'booking', actualIntent: 'booking' },
        { predictedIntent: 'booking', actualIntent: 'booking' },
        { predictedIntent: 'inquiry', actualIntent: 'booking' }, // wrong
        { predictedIntent: 'inquiry', actualIntent: 'inquiry' },
        { predictedIntent: 'inquiry', actualIntent: 'inquiry' },
      ];

      const report = computeConfusionMatrix(feedbackData, 'pelangi');

      const bookingAccuracy = report.intentAccuracy.booking;
      const inquiryAccuracy = report.intentAccuracy.inquiry;

      // booking: 2 correct out of 3 = 66.67%
      expect(bookingAccuracy).toBeCloseTo(66.67, 1);

      // inquiry: 2 correct out of 2 = 100%
      expect(inquiryAccuracy).toBeCloseTo(100, 1);
    });

    it('should flag intents with <75% accuracy', () => {
      const feedbackData = [
        { predictedIntent: 'booking', actualIntent: 'booking' },
        { predictedIntent: 'inquiry', actualIntent: 'booking' }, // wrong
        { predictedIntent: 'inquiry', actualIntent: 'booking' }, // wrong
        { predictedIntent: 'inquiry', actualIntent: 'booking' }, // wrong
        { predictedIntent: 'inquiry', actualIntent: 'inquiry' },
        { predictedIntent: 'inquiry', actualIntent: 'inquiry' },
      ];

      const report = computeConfusionMatrix(feedbackData, 'pelangi');

      // booking has 25% accuracy (1/4)
      const lowAccuracyIntents = report.lowAccuracyIntents;
      expect(lowAccuracyIntents).toContain('booking');
      expect(lowAccuracyIntents.length).toBeGreaterThan(0);
    });

    it('should identify top 5 misclassification pairs sorted by frequency', () => {
      const feedbackData = [
        // Top pair: booking -> inquiry (12 times)
        ...Array(12)
          .fill(null)
          .map(() => ({ predictedIntent: 'inquiry', actualIntent: 'booking' })),
        // Second pair: inquiry -> booking (8 times)
        ...Array(8)
          .fill(null)
          .map(() => ({ predictedIntent: 'booking', actualIntent: 'inquiry' })),
        // Third pair: checkAvailability -> booking (5 times)
        ...Array(5)
          .fill(null)
          .map(() => ({ predictedIntent: 'booking', actualIntent: 'checkAvailability' })),
        // Correct predictions
        ...Array(20)
          .fill(null)
          .map(() => ({ predictedIntent: 'booking', actualIntent: 'booking' })),
        ...Array(10)
          .fill(null)
          .map(() => ({ predictedIntent: 'inquiry', actualIntent: 'inquiry' })),
        ...Array(5)
          .fill(null)
          .map(() => ({ predictedIntent: 'checkAvailability', actualIntent: 'checkAvailability' })),
      ];

      const report = computeConfusionMatrix(feedbackData, 'pelangi');

      expect(report.topMisclassificationPairs.length).toBeLessThanOrEqual(5);

      // Top pair should be booking -> inquiry
      if (report.topMisclassificationPairs.length > 0) {
        expect(report.topMisclassificationPairs[0].from).toBe('booking');
        expect(report.topMisclassificationPairs[0].to).toBe('inquiry');
        expect(report.topMisclassificationPairs[0].count).toBe(12);
      }
    });

    it('should group accuracy data by profile', () => {
      // Pelangi: booking intent has 1 correct out of 2 predictions = 50%
      const feedbackDataPelangi = [
        { predictedIntent: 'booking', actualIntent: 'booking' },
        { predictedIntent: 'inquiry', actualIntent: 'booking' }, // misclassified
      ];

      // Southern: booking intent has 2 correct out of 2 predictions = 100%
      const feedbackDataSouthern = [
        { predictedIntent: 'booking', actualIntent: 'booking' },
        { predictedIntent: 'booking', actualIntent: 'booking' },
      ];

      const reportPelangi = computeConfusionMatrix(feedbackDataPelangi, 'pelangi');
      const reportSouthern = computeConfusionMatrix(feedbackDataSouthern, 'southern');

      expect(reportPelangi.profile).toBe('pelangi');
      expect(reportSouthern.profile).toBe('southern');

      // Pelangi has lower booking accuracy (50%) vs Southern (100%)
      expect(reportPelangi.intentAccuracy.booking).toBeLessThan(
        reportSouthern.intentAccuracy.booking
      );
    });

    it('should handle empty feedback data gracefully', () => {
      const report = computeConfusionMatrix([], 'pelangi');

      expect(report.profile).toBe('pelangi');
      expect(report.totalSamples).toBe(0);
      expect(report.matrix.length).toBe(0);
      expect(report.intentAccuracy).toEqual({});
      expect(report.lowAccuracyIntents).toEqual([]);
      expect(report.topMisclassificationPairs).toEqual([]);
    });

    it('should handle records with null/undefined intents', () => {
      const feedbackData = [
        { predictedIntent: 'booking', actualIntent: 'booking' },
        { predictedIntent: null, actualIntent: 'booking' },
        { predictedIntent: 'inquiry', actualIntent: null },
        { predictedIntent: undefined, actualIntent: 'inquiry' },
      ];

      const report = computeConfusionMatrix(feedbackData as any, 'pelangi');

      // Should only count records with both intents defined
      expect(report.totalSamples).toBe(1);
      expect(report.matrix.length).toBeGreaterThanOrEqual(0);
    });

    it('should calculate accuracy as percentage (0-100)', () => {
      const feedbackData = [
        // booking intent: 3 correct, 1 wrong = 3/4 = 75%
        { predictedIntent: 'booking', actualIntent: 'booking' },
        { predictedIntent: 'booking', actualIntent: 'booking' },
        { predictedIntent: 'booking', actualIntent: 'booking' },
        { predictedIntent: 'inquiry', actualIntent: 'booking' }, // misclassified
      ];

      const report = computeConfusionMatrix(feedbackData, 'pelangi');

      // 3 correct out of 4 booking samples = 75%
      expect(report.intentAccuracy.booking).toBeCloseTo(75, 1);
      expect(report.intentAccuracy.booking).toBeGreaterThanOrEqual(0);
      expect(report.intentAccuracy.booking).toBeLessThanOrEqual(100);
    });

    it('should include intent metadata in confusion matrix rows', () => {
      const feedbackData = [
        { predictedIntent: 'booking', actualIntent: 'booking' },
        { predictedIntent: 'booking', actualIntent: 'booking' },
        { predictedIntent: 'inquiry', actualIntent: 'booking' }, // misclassified
      ];

      const report = computeConfusionMatrix(feedbackData, 'pelangi');

      const bookingRow = report.matrix.find((m) => m.actualIntent === 'booking');
      expect(bookingRow).toBeDefined();
      expect(bookingRow!.actualIntent).toBe('booking');
      expect(bookingRow!.predictions).toBeDefined();
      expect(typeof bookingRow!.predictions).toBe('object');
    });
  });

  describe('Report Structure', () => {
    it('should include timestamp in report', () => {
      const feedbackData = [{ predictedIntent: 'booking', actualIntent: 'booking' }];

      const report = computeConfusionMatrix(feedbackData, 'pelangi');

      expect(report.timestamp).toBeDefined();
      expect(typeof report.timestamp).toBe('string');
      // Verify ISO format
      expect(new Date(report.timestamp)).toBeInstanceOf(Date);
    });

    it('should include all required report fields', () => {
      const feedbackData = [{ predictedIntent: 'booking', actualIntent: 'booking' }];

      const report = computeConfusionMatrix(feedbackData, 'pelangi');

      expect(report).toHaveProperty('profile');
      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('totalSamples');
      expect(report).toHaveProperty('matrix');
      expect(report).toHaveProperty('intentAccuracy');
      expect(report).toHaveProperty('lowAccuracyIntents');
      expect(report).toHaveProperty('topMisclassificationPairs');
    });
  });
});
