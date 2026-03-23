/**
 * US-158: Intent Classifier Regression Detector Tests
 *
 * Test suite for regression detection functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateIntentAccuracy,
  detectIntentRegression,
  checkRegressions,
  getIntentsInWindow,
} from './regression-detector.js';
import { db } from '../db.js';
import { intentPredictions } from '../../../shared/schema.js';
import { sql } from 'drizzle-orm';

describe('Intent Regression Detector (US-158)', () => {
  beforeEach(async () => {
    // Clear test data
    await db.execute(sql`DELETE FROM ${intentPredictions} WHERE profile = 'test'`);
  });

  describe('calculateIntentAccuracy()', () => {
    it('should return null when no validated predictions exist', async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const result = await calculateIntentAccuracy('nonexistent', start, now);
      expect(result).toBeNull();
    });

    it('should calculate accuracy from validated predictions', async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Insert test data: 10 total, 7 correct = 70% accuracy
      const testIntentPredictions = [
        // Correct predictions
        { predictedIntent: 'booking_request', wasCorrect: true, createdAt: now, profile: 'test' },
        { predictedIntent: 'booking_request', wasCorrect: true, createdAt: now, profile: 'test' },
        { predictedIntent: 'booking_request', wasCorrect: true, createdAt: now, profile: 'test' },
        { predictedIntent: 'booking_request', wasCorrect: true, createdAt: now, profile: 'test' },
        { predictedIntent: 'booking_request', wasCorrect: true, createdAt: now, profile: 'test' },
        { predictedIntent: 'booking_request', wasCorrect: true, createdAt: now, profile: 'test' },
        { predictedIntent: 'booking_request', wasCorrect: true, createdAt: now, profile: 'test' },
        // Incorrect predictions
        { predictedIntent: 'booking_request', wasCorrect: false, createdAt: now, profile: 'test' },
        { predictedIntent: 'booking_request', wasCorrect: false, createdAt: now, profile: 'test' },
        { predictedIntent: 'booking_request', wasCorrect: false, createdAt: now, profile: 'test' },
      ];

      for (const pred of testIntentPredictions) {
        await db.insert(intentPredictions).values({
          id: `test-${Math.random()}`,
          conversationId: `conv-${Math.random()}`,
          phoneNumber: '601234567890',
          messageText: 'test message',
          predictedIntent: pred.predictedIntent,
          confidence: 0.85,
          tier: 'T1',
          profile: pred.profile,
          wasCorrect: pred.wasCorrect,
          createdAt: pred.createdAt,
        });
      }

      const result = await calculateIntentAccuracy('booking_request', start, now, 'test');
      expect(result).not.toBeNull();
      expect(result?.total).toBe(10);
      expect(result?.correct).toBe(7);
      expect(result?.accuracy).toBe(70);
    });

    it('should respect profile filter', async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Insert predictions with different profiles
      await db.insert(intentPredictions).values({
        id: `test-1`,
        conversationId: 'conv-1',
        phoneNumber: '601234567890',
        messageText: 'test',
        predictedIntent: 'booking_request',
        confidence: 0.85,
        tier: 'T1',
        profile: 'test-profile-1',
        wasCorrect: true,
        createdAt: now,
      });

      await db.insert(intentPredictions).values({
        id: `test-2`,
        conversationId: 'conv-2',
        phoneNumber: '601234567890',
        messageText: 'test',
        predictedIntent: 'booking_request',
        confidence: 0.85,
        tier: 'T1',
        profile: 'test-profile-2',
        wasCorrect: false,
        createdAt: now,
      });

      const result1 = await calculateIntentAccuracy('booking_request', start, now, 'test-profile-1');
      const result2 = await calculateIntentAccuracy('booking_request', start, now, 'test-profile-2');

      expect(result1?.correct).toBe(1);
      expect(result1?.total).toBe(1);
      expect(result2?.correct).toBe(0);
      expect(result2?.total).toBe(1);
    });
  });

  describe('detectIntentRegression()', () => {
    it('should detect regression when accuracy drops from 92% to 87%', async () => {
      const now = new Date();
      const baselineStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const baselineEnd = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const currentStart = baselineEnd;
      const currentEnd = now;

      // Baseline period: 92% accuracy (23 correct out of 25)
      for (let i = 0; i < 23; i++) {
        await db.insert(intentPredictions).values({
          id: `baseline-${i}`,
          conversationId: `conv-baseline-${i}`,
          phoneNumber: '601234567890',
          messageText: 'test',
          predictedIntent: 'booking_request',
          confidence: 0.9,
          tier: 'T1',
          profile: 'test',
          wasCorrect: true,
          createdAt: new Date(baselineStart.getTime() + i * 1000),
        });
      }

      for (let i = 0; i < 2; i++) {
        await db.insert(intentPredictions).values({
          id: `baseline-incorrect-${i}`,
          conversationId: `conv-baseline-incorrect-${i}`,
          phoneNumber: '601234567890',
          messageText: 'test',
          predictedIntent: 'booking_request',
          confidence: 0.6,
          tier: 'T1',
          profile: 'test',
          wasCorrect: false,
          createdAt: new Date(baselineEnd.getTime() - (2 - i) * 1000),
        });
      }

      // Current period: 87% accuracy (13 correct out of 15)
      for (let i = 0; i < 13; i++) {
        await db.insert(intentPredictions).values({
          id: `current-${i}`,
          conversationId: `conv-current-${i}`,
          phoneNumber: '601234567890',
          messageText: 'test',
          predictedIntent: 'booking_request',
          confidence: 0.85,
          tier: 'T1',
          profile: 'test',
          wasCorrect: true,
          createdAt: new Date(currentStart.getTime() + i * 1000),
        });
      }

      for (let i = 0; i < 2; i++) {
        await db.insert(intentPredictions).values({
          id: `current-incorrect-${i}`,
          conversationId: `conv-current-incorrect-${i}`,
          phoneNumber: '601234567890',
          messageText: 'test',
          predictedIntent: 'booking_request',
          confidence: 0.5,
          tier: 'T1',
          profile: 'test',
          wasCorrect: false,
          createdAt: new Date(currentEnd.getTime() - (2 - i) * 1000),
        });
      }

      const result = await detectIntentRegression('booking_request', 7, 7, 0.05, 'test');

      expect(result).not.toBeNull();
      expect(result?.status).toBe('regression_detected');
      expect(result?.intent).toBe('booking_request');
      expect(Math.abs(result?.previousAccuracy! - 92) < 1).toBe(true);
      expect(Math.abs(result?.currentAccuracy! - 86.67) < 1).toBe(true);
      expect(result?.accuracyDrop! > 5).toBe(true); // > 5% drop
    });

    it('should return null if baseline window has no data', async () => {
      // Current period only, no baseline data
      const now = new Date();
      const result = await detectIntentRegression('nonexistent', 7, 7, 0.05, 'test');
      expect(result).toBeNull();
    });

    it('should mark as healthy when accuracy is above threshold', async () => {
      const now = new Date();
      const baselineStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const baselineEnd = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const currentStart = baselineEnd;
      const currentEnd = now;

      // Baseline: 90% accuracy
      for (let i = 0; i < 9; i++) {
        await db.insert(intentPredictions).values({
          id: `baseline-h-${i}`,
          conversationId: `conv-h-${i}`,
          phoneNumber: '601234567890',
          messageText: 'test',
          predictedIntent: 'test_intent',
          confidence: 0.9,
          tier: 'T1',
          profile: 'test',
          wasCorrect: true,
          createdAt: new Date(baselineStart.getTime() + i * 1000),
        });
      }

      await db.insert(intentPredictions).values({
        id: 'baseline-h-incorrect',
        conversationId: 'conv-h-incorrect',
        phoneNumber: '601234567890',
        messageText: 'test',
        predictedIntent: 'test_intent',
        confidence: 0.6,
        tier: 'T1',
        profile: 'test',
        wasCorrect: false,
        createdAt: baselineEnd,
      });

      // Current: 89% accuracy (small drop, below 5% threshold)
      for (let i = 0; i < 8; i++) {
        await db.insert(intentPredictions).values({
          id: `current-h-${i}`,
          conversationId: `conv-current-h-${i}`,
          phoneNumber: '601234567890',
          messageText: 'test',
          predictedIntent: 'test_intent',
          confidence: 0.85,
          tier: 'T1',
          profile: 'test',
          wasCorrect: true,
          createdAt: new Date(currentStart.getTime() + i * 1000),
        });
      }

      await db.insert(intentPredictions).values({
        id: 'current-h-incorrect',
        conversationId: 'conv-current-h-incorrect',
        phoneNumber: '601234567890',
        messageText: 'test',
        predictedIntent: 'test_intent',
        confidence: 0.5,
        tier: 'T1',
        profile: 'test',
        wasCorrect: false,
        createdAt: currentEnd,
      });

      const result = await detectIntentRegression('test_intent', 7, 7, 0.05, 'test');

      expect(result?.status).toBe('healthy');
    });
  });

  describe('getIntentsInWindow()', () => {
    it('should return intents with validated predictions in window', async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Insert predictions for different intents
      await db.insert(intentPredictions).values({
        id: 'test-intent-1',
        conversationId: 'conv-1',
        phoneNumber: '601234567890',
        messageText: 'test',
        predictedIntent: 'booking_request',
        confidence: 0.9,
        tier: 'T1',
        profile: 'test',
        wasCorrect: true,
        createdAt: now,
      });

      await db.insert(intentPredictions).values({
        id: 'test-intent-2',
        conversationId: 'conv-2',
        phoneNumber: '601234567890',
        messageText: 'test',
        predictedIntent: 'cancel_booking',
        confidence: 0.85,
        tier: 'T1',
        profile: 'test',
        wasCorrect: false,
        createdAt: now,
      });

      const intents = await getIntentsInWindow(start, now, 'test');
      expect(intents).toContain('booking_request');
      expect(intents).toContain('cancel_booking');
      expect(intents.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('checkRegressions()', () => {
    it('should return healthy status when no regressions detected', async () => {
      const now = new Date();
      const result = await checkRegressions(7, 0.05, 'test');

      expect(result.overallStatus).toBe('healthy');
      expect(Array.isArray(result.intents)).toBe(true);
      expect(result.timestamp).toBeDefined();
    });
  });
});
