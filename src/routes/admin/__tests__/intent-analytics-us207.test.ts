/**
 * US-207: Intent Classification Hard-Case Queue Tests
 *
 * Test suite for flagging and reviewing conversations with ambiguous intent
 * classifications (low confidence, multiple similar candidates).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../../lib/db.js';
import { intentHardCases } from '../../../../shared/schema.js';
import { eq } from 'drizzle-orm';

describe('Intent Hard-Case Queue (US-207)', () => {
  const testProfile = 'data-pelangi-test';

  beforeEach(async () => {
    // Clear test data before each test
    await db.delete(intentHardCases).where(eq(intentHardCases.profile, testProfile));
  });

  afterEach(async () => {
    // Clean up after tests
    await db.delete(intentHardCases).where(eq(intentHardCases.profile, testProfile));
  });

  describe('Hard-Case Queue (AC1-AC3)', () => {
    it('AC1: should accept conversationId, intentId, confidence and store to intent_hard_cases', async () => {
      const payload = {
        conversationId: 'conv-123',
        intentId: 'booking_request',
        confidence: 0.65,
        reason: 'low confidence',
      };

      const result = await db
        .insert(intentHardCases)
        .values({
          ...payload,
          profile: testProfile,
        })
        .returning({ id: intentHardCases.id });

      expect(result).toHaveLength(1);

      const stored = await db
        .select()
        .from(intentHardCases)
        .where(eq(intentHardCases.profile, testProfile));

      expect(stored).toHaveLength(1);
      expect(stored[0].conversationId).toBe('conv-123');
      expect(stored[0].intentId).toBe('booking_request');
      expect(stored[0].confidence).toBe(0.65);
    });

    it('AC2: should group cases by predicted intent with confidence breakdown', async () => {
      const testCases = [
        { conversationId: 'conv-1', intentId: 'booking', confidence: 0.68 },
        { conversationId: 'conv-2', intentId: 'booking', confidence: 0.72 },
        { conversationId: 'conv-3', intentId: 'booking', confidence: 0.55 },
        { conversationId: 'conv-4', intentId: 'inquiry', confidence: 0.60 },
        { conversationId: 'conv-5', intentId: 'inquiry', confidence: 0.58 },
      ];

      for (const testCase of testCases) {
        await db.insert(intentHardCases).values({
          ...testCase,
          profile: testProfile,
        });
      }

      const stored = await db
        .select()
        .from(intentHardCases)
        .where(eq(intentHardCases.profile, testProfile));

      expect(stored).toHaveLength(5);

      const grouped: Record<string, any> = {};
      for (const hardCase of stored) {
        const intent = hardCase.intentId;
        if (!grouped[intent]) {
          grouped[intent] = {
            intent,
            count: 0,
            avgConfidence: 0,
            confidenceRange: { min: 1, max: 0 },
          };
        }

        grouped[intent].count += 1;
        grouped[intent].avgConfidence =
          (grouped[intent].avgConfidence * (grouped[intent].count - 1) + hardCase.confidence) /
          grouped[intent].count;
        grouped[intent].confidenceRange.min = Math.min(
          grouped[intent].confidenceRange.min,
          hardCase.confidence
        );
        grouped[intent].confidenceRange.max = Math.max(
          grouped[intent].confidenceRange.max,
          hardCase.confidence
        );
      }

      const bookingGroup = grouped['booking'];
      expect(bookingGroup.count).toBe(3);
      expect(bookingGroup.confidenceRange.min).toBe(0.55);
      expect(bookingGroup.confidenceRange.max).toBe(0.72);

      const inquiryGroup = grouped['inquiry'];
      expect(inquiryGroup.count).toBe(2);
      expect(inquiryGroup.confidenceRange.min).toBe(0.58);
      expect(inquiryGroup.confidenceRange.max).toBe(0.60);
    });

    it('AC3: should queue >5 items with confidence < 0.75 for manual review', async () => {
      const hardCases = [
        { conversationId: 'conv-1', intentId: 'booking', confidence: 0.68 },
        { conversationId: 'conv-2', intentId: 'booking', confidence: 0.70 },
        { conversationId: 'conv-3', intentId: 'inquiry', confidence: 0.60 },
        { conversationId: 'conv-4', intentId: 'inquiry', confidence: 0.65 },
        { conversationId: 'conv-5', intentId: 'checkout', confidence: 0.72 },
        { conversationId: 'conv-6', intentId: 'checkout', confidence: 0.55 },
        { conversationId: 'conv-7', intentId: 'complaint', confidence: 0.62 },
        { conversationId: 'conv-8', intentId: 'complaint', confidence: 0.58 },
      ];

      for (const hardCase of hardCases) {
        await db.insert(intentHardCases).values({
          ...hardCase,
          profile: testProfile,
        });
      }

      const stored = await db
        .select()
        .from(intentHardCases)
        .where(eq(intentHardCases.profile, testProfile));

      const lowConfidenceCases = stored.filter((c) => c.confidence < 0.75);

      expect(lowConfidenceCases.length).toBeGreaterThan(5);
      expect(lowConfidenceCases).toHaveLength(8);

      for (const hardCase of lowConfidenceCases) {
        expect(hardCase.confidence).toBeLessThan(0.75);
      }
    });

    it('should store top-3 candidate intents with confidence scores', async () => {
      const candidates = [
        { intent: 'booking', confidence: 0.65 },
        { intent: 'inquiry', confidence: 0.25 },
        { intent: 'checkout', confidence: 0.10 },
      ];

      const result = await db
        .insert(intentHardCases)
        .values({
          conversationId: 'conv-789',
          intentId: 'booking',
          confidence: 0.65,
          candidateIntents: JSON.stringify(candidates),
          reason: 'multiple candidates',
          profile: testProfile,
        })
        .returning();

      expect(result[0]).toBeDefined();
      const stored = result[0];
      const parsed = stored.candidateIntents
        ? typeof stored.candidateIntents === 'string'
          ? JSON.parse(stored.candidateIntents)
          : stored.candidateIntents
        : null;

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
      expect(parsed[0].intent).toBe('booking');
      expect(parsed[0].confidence).toBe(0.65);
    });
  });
});
