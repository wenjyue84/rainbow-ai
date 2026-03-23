/**
 * US-292: Booking Conversion Rate Analyzer Tests
 *
 * Tests:
 * 1. 45 booking initiations with 36 completions → 80.0% completion_rate, 20.0% abandonment_rate
 * 2. Funnel visualization shows correct % at each step
 * 3. Abandonment step breakdown identifies where guests drop off
 * 4. Edge cases: zero initiations, zero completions, perfect conversion
 */

import { describe, it, expect } from 'vitest';
import {
  calculateConversionMetrics,
  buildFunnel,
  BOOKING_FUNNEL_STEPS,
} from '../../routes/admin/analytics-booking-conversion.js';

describe('Booking Conversion Rate Analyzer (US-292)', () => {
  describe('calculateConversionMetrics', () => {
    it('AC3: 45 initiations and 36 completions → 80.0% completion_rate and 20.0% abandonment_rate', () => {
      const result = calculateConversionMetrics({
        bookingConversations: 45,
        completedBookings: 36,
        abandonmentStepBreakdown: {
          'select-room': 5,
          'enter-dates': 3,
          'confirm-payment': 1,
        },
      });

      expect(result.bookingConversations).toBe(45);
      expect(result.completedBookings).toBe(36);
      expect(result.completionRate).toBe('80.0%');
      expect(result.abandonmentRate).toBe('20.0%');
      expect(result.abandonmentStepBreakdown).toEqual({
        'select-room': 5,
        'enter-dates': 3,
        'confirm-payment': 1,
      });
    });

    it('handles zero booking conversations gracefully', () => {
      const result = calculateConversionMetrics({
        bookingConversations: 0,
        completedBookings: 0,
        abandonmentStepBreakdown: {},
      });

      expect(result.completionRate).toBe('0.0%');
      expect(result.abandonmentRate).toBe('0.0%');
    });

    it('handles zero completions (100% abandonment)', () => {
      const result = calculateConversionMetrics({
        bookingConversations: 20,
        completedBookings: 0,
        abandonmentStepBreakdown: { 'select-room': 20 },
      });

      expect(result.completionRate).toBe('0.0%');
      expect(result.abandonmentRate).toBe('100.0%');
    });

    it('handles perfect conversion (0% abandonment)', () => {
      const result = calculateConversionMetrics({
        bookingConversations: 50,
        completedBookings: 50,
        abandonmentStepBreakdown: {},
      });

      expect(result.completionRate).toBe('100.0%');
      expect(result.abandonmentRate).toBe('0.0%');
    });

    it('calculates fractional percentages correctly', () => {
      const result = calculateConversionMetrics({
        bookingConversations: 30,
        completedBookings: 22,
        abandonmentStepBreakdown: {},
      });

      expect(result.completionRate).toBe('73.3%');
      expect(result.abandonmentRate).toBe('26.7%');
    });
  });

  describe('buildFunnel', () => {
    it('AC2: shows % of guests reaching each workflow step', () => {
      // 45 total initiations, step counts decrease through funnel
      const stepCounts: Record<string, number> = {
        'select-room': 36,
        'enter-dates': 32,
        'confirm-payment': 23,
        'finalize': 16,
      };

      const funnel = buildFunnel(45, stepCounts);

      expect(funnel).toHaveLength(BOOKING_FUNNEL_STEPS.length);
      expect(funnel[0]).toEqual({ step: 'select-room', reached: 36, reachedPct: '80.0%' });
      expect(funnel[1]).toEqual({ step: 'enter-dates', reached: 32, reachedPct: '71.1%' });
      expect(funnel[2]).toEqual({ step: 'confirm-payment', reached: 23, reachedPct: '51.1%' });
      expect(funnel[3]).toEqual({ step: 'finalize', reached: 16, reachedPct: '35.6%' });
    });

    it('handles zero initiations', () => {
      const funnel = buildFunnel(0, {});

      expect(funnel).toHaveLength(BOOKING_FUNNEL_STEPS.length);
      for (const step of funnel) {
        expect(step.reached).toBe(0);
        expect(step.reachedPct).toBe('0.0%');
      }
    });

    it('handles missing step counts (defaults to 0)', () => {
      const stepCounts: Record<string, number> = {
        'select-room': 10,
        // enter-dates missing
        'confirm-payment': 5,
        // finalize missing
      };

      const funnel = buildFunnel(20, stepCounts);

      expect(funnel[0].reached).toBe(10);
      expect(funnel[1].reached).toBe(0);
      expect(funnel[1].reachedPct).toBe('0.0%');
      expect(funnel[2].reached).toBe(5);
      expect(funnel[3].reached).toBe(0);
    });
  });

  describe('BOOKING_FUNNEL_STEPS', () => {
    it('defines the expected funnel steps in order', () => {
      expect(BOOKING_FUNNEL_STEPS).toEqual([
        'select-room',
        'enter-dates',
        'confirm-payment',
        'finalize',
      ]);
    });
  });
});
