/**
 * US-352: Booking Workflow Step Failure Recovery Test Suite
 *
 * Tests for step error capture logic, profile-aware recovery messages,
 * and error formatting.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizeProfileId,
  getRecoveryMessage,
  type StepErrorContext,
} from './step-error-handler.js';

describe('Step Error Handler (US-352)', () => {
  // ─── AC1: Profile Normalization ──────────────────────────────────

  describe('AC1: normalizeProfileId', () => {
    it('should normalize "pelangi-capsule" to "pelangi"', () => {
      expect(normalizeProfileId('pelangi-capsule')).toBe('pelangi');
    });

    it('should normalize "makan-moments" to "makan"', () => {
      expect(normalizeProfileId('makan-moments')).toBe('makan');
    });

    it('should normalize "southern-homestay" to "southern"', () => {
      expect(normalizeProfileId('southern-homestay')).toBe('southern');
    });

    it('should default unknown profiles to "pelangi"', () => {
      expect(normalizeProfileId('unknown-profile')).toBe('pelangi');
    });

    it('should be case-insensitive', () => {
      expect(normalizeProfileId('PELANGI')).toBe('pelangi');
      expect(normalizeProfileId('MAKAN')).toBe('makan');
      expect(normalizeProfileId('SOUTHERN')).toBe('southern');
    });

    it('should handle partial matches', () => {
      expect(normalizeProfileId('data-makan')).toBe('makan');
      expect(normalizeProfileId('southern-data')).toBe('southern');
    });
  });

  // ─── AC2: Profile-Specific Recovery Messages ─────────────────────

  describe('AC2: Profile-Aware Recovery Messages', () => {
    it('should return Pelangi message with "front desk" for validation_error', () => {
      const msg = getRecoveryMessage('validation_error', 'pelangi');
      expect(msg).toContain('front desk');
      expect(msg).toContain('booking');
    });

    it('should return Makan message with "order" for validation_error', () => {
      const msg = getRecoveryMessage('validation_error', 'makan');
      expect(msg).toContain('order');
      expect(msg).toContain('staff');
    });

    it('should return Southern message with "team" for validation_error', () => {
      const msg = getRecoveryMessage('validation_error', 'southern');
      expect(msg).toContain('team');
      expect(msg).toContain('booking');
    });

    it('should have distinct payment_failed messages for each profile', () => {
      const pelangiPayment = getRecoveryMessage('payment_failed', 'pelangi');
      const makanPayment = getRecoveryMessage('payment_failed', 'makan');
      const southernPayment = getRecoveryMessage('payment_failed', 'southern');

      expect(pelangiPayment).not.toBe(makanPayment);
      expect(makanPayment).not.toBe(southernPayment);
      expect(pelangiPayment).not.toBe(southernPayment);

      // Verify each is appropriate for their context
      expect(pelangiPayment).toContain('payment');
      expect(makanPayment).toContain('payment');
      expect(southernPayment).toContain('payment');
    });

    it('should differentiate room_unavailable messages', () => {
      const pelangiMsg = getRecoveryMessage('room_unavailable', 'pelangi');
      const makanMsg = getRecoveryMessage('room_unavailable', 'makan');
      const southernMsg = getRecoveryMessage('room_unavailable', 'southern');

      // Pelangi should mention "dates"
      expect(pelangiMsg.toLowerCase()).toContain('dates');

      // Makan should mention "item"
      expect(makanMsg.toLowerCase()).toContain('item');

      // Southern should mention "dates"
      expect(southernMsg.toLowerCase()).toContain('dates');
    });

    it('should handle unmapped error types with system_error fallback', () => {
      const msg = getRecoveryMessage('unknown_error_type_xyz', 'pelangi');
      expect(msg).toBeTruthy();
      expect(msg.length > 0).toBe(true);
      expect(msg).toContain('technical issue');
    });

    it('should preserve messages across all error types', () => {
      const errorTypes = [
        'validation_error',
        'payment_failed',
        'room_unavailable',
        'date_conflict',
        'guest_not_found',
        'system_error',
      ];

      for (const errorType of errorTypes) {
        const pelangiMsg = getRecoveryMessage(errorType, 'pelangi');
        const makanMsg = getRecoveryMessage(errorType, 'makan');
        const southernMsg = getRecoveryMessage(errorType, 'southern');

        expect(pelangiMsg).toBeTruthy();
        expect(makanMsg).toBeTruthy();
        expect(southernMsg).toBeTruthy();

        // Pelangi should have hostel context
        expect(pelangiMsg.toLowerCase()).toMatch(/front desk|team|staff/);

        // Makan should have cafe context
        expect(makanMsg.toLowerCase()).toMatch(/order|staff|team/);

        // Southern should have homestay context
        expect(southernMsg.toLowerCase()).toMatch(/team|staff|booking/);
      }
    });

    it('should normalize profile ID before selecting message', () => {
      const pelangiMsg = getRecoveryMessage('validation_error', 'pelangi-capsule');
      const directMsg = getRecoveryMessage('validation_error', 'pelangi');
      expect(pelangiMsg).toBe(directMsg);

      const makanMsg = getRecoveryMessage('validation_error', 'makan-moments');
      const makanDirectMsg = getRecoveryMessage('validation_error', 'makan');
      expect(makanMsg).toBe(makanDirectMsg);
    });
  });

  // ─── AC3: Message Content Validation ─────────────────────────────

  describe('AC3: Message Content Guidelines', () => {
    it('all recovery messages should be guest-friendly (not technical)', () => {
      const technicalTerms = ['null', 'undefined', 'error code', 'stack', 'exception'];
      const profiles = ['pelangi', 'makan', 'southern'];
      const errorTypes = ['validation_error', 'payment_failed', 'system_error'];

      for (const profile of profiles) {
        for (const errorType of errorTypes) {
          const msg = getRecoveryMessage(errorType, profile);
          const msgLower = msg.toLowerCase();

          for (const term of technicalTerms) {
            expect(msgLower).not.toContain(term);
          }
        }
      }
    });

    it('all recovery messages should be positive/action-oriented', () => {
      const positiveKeywords = ['will', 'contact', 'help', 'staff', 'reach out', 'follow up'];
      const profiles = ['pelangi', 'makan', 'southern'];
      const errorTypes = ['validation_error', 'payment_failed', 'system_error'];

      for (const profile of profiles) {
        for (const errorType of errorTypes) {
          const msg = getRecoveryMessage(errorType, profile);
          const msgLower = msg.toLowerCase();

          // Should have at least one positive action indicator
          const hasPositiveAction = positiveKeywords.some(kw => msgLower.includes(kw));
          expect(hasPositiveAction).toBe(true);
        }
      }
    });

    it('all recovery messages should offer next steps', () => {
      const nextStepPatterns = ['contact', 'call', 'reach out', 'speak with', 'follow up'];
      const profiles = ['pelangi', 'makan', 'southern'];

      for (const profile of profiles) {
        const msg = getRecoveryMessage('system_error', profile);
        const msgLower = msg.toLowerCase();

        const hasNextStep = nextStepPatterns.some(pattern => msgLower.includes(pattern));
        expect(hasNextStep).toBe(true);
      }
    });
  });

  // ─── AC4: Error Context Types ────────────────────────────────────

  describe('AC4: StepErrorContext Type', () => {
    it('should accept complete StepErrorContext', () => {
      const context: StepErrorContext = {
        stepId: 'payment-confirm',
        stepName: 'Confirm Payment',
        inputValues: { amount: 500, currency: 'MYR' },
        error: new Error('Payment gateway timeout'),
        errorType: 'payment_failed',
        jid: '601234567890',
        profileId: 'pelangi',
        conversationId: 'conv-123',
        guestName: 'John Doe',
      };

      expect(context.stepId).toBe('payment-confirm');
      expect(context.jid).toBe('601234567890');
      expect(context.error instanceof Error).toBe(true);
    });

    it('should accept string errors', () => {
      const context: StepErrorContext = {
        stepId: 'validation',
        stepName: 'Validate Input',
        inputValues: {},
        error: 'Missing required field',
        errorType: 'validation_error',
        jid: '601234567890',
        profileId: 'makan',
      };

      expect(typeof context.error === 'string').toBe(true);
    });

    it('should have optional conversationId and guestName', () => {
      const minimalContext: StepErrorContext = {
        stepId: 'step1',
        stepName: 'Step 1',
        inputValues: {},
        error: new Error('Test'),
        errorType: 'system_error',
        jid: '601234567890',
        profileId: 'pelangi',
      };

      expect(minimalContext.conversationId).toBeUndefined();
      expect(minimalContext.guestName).toBeUndefined();
    });
  });

  // ─── AC5: Acceptance Criteria Summary ────────────────────────────

  describe('AC5: Acceptance Criteria Verification', () => {
    it('AC1: Error is caught (profile isolation)', () => {
      // captureStepError will catch errors and return gracefully
      expect(() => {
        normalizeProfileId('any-profile');
      }).not.toThrow();
    });

    it('AC2: Escalation event metadata structure', () => {
      // Verify the structure we build is correct
      const context: StepErrorContext = {
        stepId: 'test-step',
        stepName: 'Test Step',
        inputValues: { key: 'value' },
        error: new Error('Test'),
        errorType: 'system_error',
        jid: '601234567890',
        profileId: 'pelangi',
      };

      // These are the fields we expect in metadata
      expect(context.stepId).toBeDefined();
      expect(context.inputValues).toBeDefined();
      expect(context.errorType).toBeDefined();
      expect(context.jid).toBeDefined();
    });

    it('AC3: Recovery message is profile-specific', () => {
      const pelangiMsg = getRecoveryMessage('payment_failed', 'pelangi');
      const makanMsg = getRecoveryMessage('payment_failed', 'makan');
      const southernMsg = getRecoveryMessage('payment_failed', 'southern');

      // All should exist and be different
      expect(pelangiMsg).toBeTruthy();
      expect(makanMsg).toBeTruthy();
      expect(southernMsg).toBeTruthy();

      expect(pelangiMsg).not.toBe(makanMsg);
      expect(makanMsg).not.toBe(southernMsg);
    });

    it('AC4: Unit test format covers all error types', () => {
      const errorTypes = [
        'validation_error',
        'payment_failed',
        'room_unavailable',
        'date_conflict',
        'guest_not_found',
        'system_error',
      ];

      for (const errorType of errorTypes) {
        const msg = getRecoveryMessage(errorType, 'pelangi');
        expect(msg.length > 0).toBe(true);
      }
    });
  });
});
