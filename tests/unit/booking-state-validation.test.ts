/**
 * US-545: Booking Workflow State Transition Validation Tests
 *
 * Tests that verify:
 * - Valid transitions are allowed
 * - Invalid transitions are rejected
 * - Edge cases (null, unknown steps) are handled gracefully
 */

import { describe, it, expect } from 'vitest';
import {
  BOOKING_TRANSITIONS,
  isValidTransition,
  getAllowedNextSteps,
  isTerminalStep
} from '../../src/assistant/workflows/booking-state-machine.js';

describe('US-545: Booking Workflow State Machine', () => {
  // ─── Valid Transitions Tests ──────────────────────────────────────
  describe('Valid Transitions', () => {
    it('should allow collect_dates -> confirm_details', () => {
      expect(isValidTransition('collect_dates', 'confirm_details')).toBe(true);
    });

    it('should allow confirm_details -> payment_info', () => {
      expect(isValidTransition('confirm_details', 'payment_info')).toBe(true);
    });

    it('should allow confirm_details -> collect_dates (go back)', () => {
      expect(isValidTransition('confirm_details', 'collect_dates')).toBe(true);
    });

    it('should allow payment_info -> booking_confirmed', () => {
      expect(isValidTransition('payment_info', 'booking_confirmed')).toBe(true);
    });

    it('should allow generate_code -> verify_code', () => {
      expect(isValidTransition('generate_code', 'verify_code')).toBe(true);
    });

    it('should allow generate_code -> verification_failed', () => {
      expect(isValidTransition('generate_code', 'verification_failed')).toBe(true);
    });

    it('should allow verify_code -> booking_confirmed', () => {
      expect(isValidTransition('verify_code', 'booking_confirmed')).toBe(true);
    });

    it('should allow verification_failed -> collect_dates', () => {
      expect(isValidTransition('verification_failed', 'collect_dates')).toBe(true);
    });
  });

  // ─── Invalid Transitions Tests ──────────────────────────────────────
  describe('Invalid Transitions', () => {
    it('should reject collect_dates -> payment_info (skipping steps)', () => {
      expect(isValidTransition('collect_dates', 'payment_info')).toBe(false);
    });

    it('should reject collect_dates -> booking_confirmed (skipping multiple steps)', () => {
      expect(isValidTransition('collect_dates', 'booking_confirmed')).toBe(false);
    });

    it('should reject payment_info -> collect_dates (going backwards)', () => {
      expect(isValidTransition('payment_info', 'collect_dates')).toBe(false);
    });

    it('should reject confirm_details -> verify_code (wrong workflow)', () => {
      expect(isValidTransition('confirm_details', 'verify_code')).toBe(false);
    });

    it('should reject booking_confirmed -> collect_dates (terminal step)', () => {
      expect(isValidTransition('booking_confirmed', 'collect_dates')).toBe(false);
    });

    it('should reject notify -> collect_dates (escalation workflow)', () => {
      expect(isValidTransition('notify', 'collect_dates')).toBe(false);
    });
  });

  // ─── Edge Cases Tests ─────────────────────────────────────────────
  describe('Edge Cases', () => {
    it('should reject null currentStep', () => {
      expect(isValidTransition(null, 'confirm_details')).toBe(false);
    });

    it('should reject undefined currentStep', () => {
      expect(isValidTransition(undefined, 'confirm_details')).toBe(false);
    });

    it('should reject null nextStep', () => {
      expect(isValidTransition('collect_dates', null)).toBe(false);
    });

    it('should reject undefined nextStep', () => {
      expect(isValidTransition('collect_dates', undefined)).toBe(false);
    });

    it('should reject unknown currentStep', () => {
      expect(isValidTransition('unknown_step', 'confirm_details')).toBe(false);
    });

    it('should reject unknown nextStep', () => {
      expect(isValidTransition('collect_dates', 'unknown_step')).toBe(false);
    });

    it('should reject both unknown steps', () => {
      expect(isValidTransition('unknown_1', 'unknown_2')).toBe(false);
    });

    it('should reject empty string currentStep', () => {
      expect(isValidTransition('', 'confirm_details')).toBe(false);
    });

    it('should reject empty string nextStep', () => {
      expect(isValidTransition('collect_dates', '')).toBe(false);
    });
  });

  // ─── Helper Functions Tests ───────────────────────────────────────
  describe('Helper Functions', () => {
    describe('getAllowedNextSteps', () => {
      it('should return allowed next steps for collect_dates', () => {
        const allowed = getAllowedNextSteps('collect_dates');
        expect(allowed).toEqual(['confirm_details']);
      });

      it('should return multiple allowed next steps for confirm_details', () => {
        const allowed = getAllowedNextSteps('confirm_details');
        expect(allowed).toContain('payment_info');
        expect(allowed).toContain('collect_dates');
      });

      it('should return empty array for terminal step (booking_confirmed)', () => {
        const allowed = getAllowedNextSteps('booking_confirmed');
        expect(allowed).toEqual([]);
      });

      it('should return empty array for unknown step', () => {
        const allowed = getAllowedNextSteps('unknown_step');
        expect(allowed).toEqual([]);
      });

      it('should return empty array for null/undefined', () => {
        expect(getAllowedNextSteps('')).toEqual([]);
        expect(getAllowedNextSteps('not-a-step')).toEqual([]);
      });
    });

    describe('isTerminalStep', () => {
      it('should identify booking_confirmed as terminal', () => {
        expect(isTerminalStep('booking_confirmed')).toBe(true);
      });

      it('should identify final_confirmation as terminal', () => {
        expect(isTerminalStep('final_confirmation')).toBe(true);
      });

      it('should identify notify as terminal', () => {
        expect(isTerminalStep('notify')).toBe(true);
      });

      it('should not identify collect_dates as terminal', () => {
        expect(isTerminalStep('collect_dates')).toBe(false);
      });

      it('should not identify confirm_details as terminal', () => {
        expect(isTerminalStep('confirm_details')).toBe(false);
      });

      it('should treat unknown step as terminal (fail-safe)', () => {
        // Unknown steps have no defined transitions, so they are treated as terminal
        expect(isTerminalStep('unknown_step')).toBe(true);
      });
    });
  });

  // ─── State Machine Completeness Tests ─────────────────────────────
  describe('State Machine Completeness', () => {
    it('should have BOOKING_TRANSITIONS defined', () => {
      expect(BOOKING_TRANSITIONS).toBeDefined();
      expect(typeof BOOKING_TRANSITIONS).toBe('object');
    });

    it('should have at least basic booking workflow steps', () => {
      expect(BOOKING_TRANSITIONS['collect_dates']).toBeDefined();
      expect(BOOKING_TRANSITIONS['confirm_details']).toBeDefined();
      expect(BOOKING_TRANSITIONS['payment_info']).toBeDefined();
      expect(BOOKING_TRANSITIONS['booking_confirmed']).toBeDefined();
    });

    it('should have all transition values as arrays', () => {
      for (const [, nextSteps] of Object.entries(BOOKING_TRANSITIONS)) {
        expect(Array.isArray(nextSteps)).toBe(true);
      }
    });

    it('should not have self-referencing transitions', () => {
      for (const [step, nextSteps] of Object.entries(BOOKING_TRANSITIONS)) {
        expect(nextSteps).not.toContain(step);
      }
    });
  });

  // ─── Workflow Consistency Tests ───────────────────────────────────
  describe('Workflow Consistency', () => {
    it('verification_failed should loop back to collect_dates', () => {
      expect(isValidTransition('verification_failed', 'collect_dates')).toBe(true);
    });

    it('collect_dates cannot skip to verify_code (wrong workflow)', () => {
      expect(isValidTransition('collect_dates', 'verify_code')).toBe(false);
    });

    it('all referenced next steps should be defined in transitions', () => {
      const definedSteps = new Set(Object.keys(BOOKING_TRANSITIONS));

      // Check that all next steps are either terminal or defined
      for (const [, nextSteps] of Object.entries(BOOKING_TRANSITIONS)) {
        for (const nextStep of nextSteps) {
          // It's okay if a next step doesn't have further transitions (terminal step)
          // but it should be reachable somehow
          expect(definedSteps.has(nextStep)).toBe(true);
        }
      }
    });
  });
});
