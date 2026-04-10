/**
 * Tests for Booking Success Funnel Analyzer (US-322)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, dbReady } from '../lib/db.js';
import { bookingStageTransitions } from '../../shared/schema.js';
import { sql } from 'drizzle-orm';
import {
  buildFunnelWithMetrics,
  BOOKING_FUNNEL_STAGES,
  type BookingFunnelStage,
} from '../routes/admin/analytics-booking-funnel.js';

describe('Booking Success Funnel Analyzer (US-322)', () => {
  let isDbReady = false;

  beforeAll(async () => {
    const ready = await dbReady;
    isDbReady = ready ?? false;
    if (isDbReady) {
      await db.delete(bookingStageTransitions).where(
        sql`profile = 'test-profile'`
      ).catch(() => {});
    }
  });

  afterAll(async () => {
    if (isDbReady) {
      await db.delete(bookingStageTransitions).where(
        sql`profile = 'test-profile'`
      ).catch(() => {});
    }
  });

  describe('buildFunnelWithMetrics', () => {
    it('builds funnel with correct stage order', () => {
      const stageCounts: Record<BookingFunnelStage, number> = {
        intent_matched: 100,
        guest_confirmed: 45,
        booking_finalized: 12,
      };
      const stageConfidences: Record<BookingFunnelStage, number> = {
        intent_matched: 0.85,
        guest_confirmed: 0.78,
        booking_finalized: 0.92,
      };

      const { funnel, conversions } = buildFunnelWithMetrics(stageCounts, stageConfidences);

      expect(funnel).toHaveLength(3);
      expect(funnel[0].stage).toBe('intent_matched');
      expect(funnel[1].stage).toBe('guest_confirmed');
      expect(funnel[2].stage).toBe('booking_finalized');
    });

    it('calculates conversion percentages correctly', () => {
      const stageCounts: Record<BookingFunnelStage, number> = {
        intent_matched: 100,
        guest_confirmed: 50,
        booking_finalized: 10,
      };
      const stageConfidences: Record<BookingFunnelStage, number> = {};

      const { conversions } = buildFunnelWithMetrics(stageCounts, stageConfidences);

      expect(conversions[0].percentage).toBe('100.0%');
      expect(conversions[1].percentage).toBe('50.0%');
      expect(conversions[2].percentage).toBe('10.0%');
    });

    it('calculates drop-from-previous percentages', () => {
      const stageCounts: Record<BookingFunnelStage, number> = {
        intent_matched: 100,
        guest_confirmed: 60,
        booking_finalized: 12,
      };
      const stageConfidences: Record<BookingFunnelStage, number> = {};

      const { conversions } = buildFunnelWithMetrics(stageCounts, stageConfidences);

      expect(conversions[0].drop_from_previous).toBe('N/A');
      expect(conversions[1].drop_from_previous).toBe('40.0%');
      expect(conversions[2].drop_from_previous).toBe('80.0%');
    });

    it('handles zero counts gracefully', () => {
      const stageCounts: Record<BookingFunnelStage, number> = {
        intent_matched: 0,
        guest_confirmed: 0,
        booking_finalized: 0,
      };
      const stageConfidences: Record<BookingFunnelStage, number> = {};

      const { conversions } = buildFunnelWithMetrics(stageCounts, stageConfidences);

      expect(conversions[0].percentage).toBe('0.0%');
      expect(conversions[1].percentage).toBe('0.0%');
      expect(conversions[2].percentage).toBe('0.0%');
    });

    it('includes confidence scores in funnel', () => {
      const stageCounts: Record<BookingFunnelStage, number> = {
        intent_matched: 100,
        guest_confirmed: 50,
        booking_finalized: 10,
      };
      const stageConfidences: Record<BookingFunnelStage, number> = {
        intent_matched: 0.95,
        guest_confirmed: 0.87,
        booking_finalized: 0.92,
      };

      const { funnel } = buildFunnelWithMetrics(stageCounts, stageConfidences);

      expect(funnel[0].confidence_score).toBeCloseTo(0.95);
      expect(funnel[1].confidence_score).toBeCloseTo(0.87);
      expect(funnel[2].confidence_score).toBeCloseTo(0.92);
    });
  });

  describe('BOOKING_FUNNEL_STAGES', () => {
    it('has all required stages in correct order', () => {
      expect(BOOKING_FUNNEL_STAGES).toContain('intent_matched');
      expect(BOOKING_FUNNEL_STAGES).toContain('guest_confirmed');
      expect(BOOKING_FUNNEL_STAGES).toContain('booking_finalized');

      expect(BOOKING_FUNNEL_STAGES[0]).toBe('intent_matched');
      expect(BOOKING_FUNNEL_STAGES[1]).toBe('guest_confirmed');
      expect(BOOKING_FUNNEL_STAGES[2]).toBe('booking_finalized');
    });
  });
});
