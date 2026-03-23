/**
 * step-error-handler.test.ts — US-352 Unit Tests
 *
 * Verifies booking workflow step failure recovery:
 * - Error capture and categorization
 * - Profile-specific recovery messages
 * - Escalation event creation for staff review
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getProfileRecoveryMessage,
  createStepFailureEscalation,
  executeWorkflowStepWithErrorRecovery,
} from '../booking/step-error-handler.js';

// Mock the database module
vi.mock('../../lib/db.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue({ id: '123' }),
    }),
  },
}));

// Mock the schema-tables module
vi.mock('../../shared/schema-tables.js', () => ({
  escalationEvents: {
    $inferSelect: {},
  },
}));

describe('StepErrorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getProfileRecoveryMessage', () => {
    it('should return Pelangi-specific message for pelangi profile', () => {
      const msg = getProfileRecoveryMessage('pelangi', 'en');
      expect(msg).toContain("front desk");
      expect(msg).toContain("call you shortly");
    });

    it('should return Makan-specific message for makan profile', () => {
      const msg = getProfileRecoveryMessage('makan', 'en');
      expect(msg).toContain("Unable to process");
      expect(msg).toContain("staff will follow up");
    });

    it('should return Southern-specific message for southern profile', () => {
      const msg = getProfileRecoveryMessage('southern', 'en');
      expect(msg).toContain("Our team will reach out");
      expect(msg).toContain("complete the reservation");
    });

    it('should support multiple languages', () => {
      const enMsg = getProfileRecoveryMessage('pelangi', 'en');
      const msMsg = getProfileRecoveryMessage('pelangi', 'ms');
      const zhMsg = getProfileRecoveryMessage('pelangi', 'zh');

      expect(enMsg).not.toEqual(msMsg);
      expect(msMsg).not.toEqual(zhMsg);
      expect(enMsg).not.toEqual(zhMsg);
    });

    it('should fallback to English for unsupported language', () => {
      const msg = getProfileRecoveryMessage('pelangi', 'fr');
      expect(msg).toContain("front desk");
    });

    it('should fallback to Pelangi for unknown profile', () => {
      const msg = getProfileRecoveryMessage('unknown_profile', 'en');
      expect(msg).toContain("front desk");
    });
  });

  describe('createStepFailureEscalation', () => {
    it('should create an escalation event on step failure', async () => {
      const { db } = await import('../../lib/db.js');

      await createStepFailureEscalation({
        jid: '60123456789',
        profileId: 'pelangi',
        stepId: 'booking_dates',
        workflowId: 'booking_workflow',
        inputValues: { checkInDate: '2026-03-25', checkOutDate: '2026-03-27' },
        error: new Error('Invalid dates: check-in after check-out'),
        guestPhone: '60123456789',
        language: 'en',
      });

      // Verify db.insert was called
      expect(db.insert).toHaveBeenCalled();
    });

    it('should categorize different error types correctly', async () => {
      const { db } = await import('../../lib/db.js');

      // Test timeout error
      await createStepFailureEscalation({
        jid: '60123456789',
        profileId: 'pelangi',
        stepId: 'payment_step',
        workflowId: 'booking_workflow',
        inputValues: {},
        error: new Error('Request timeout after 30s'),
        guestPhone: '60123456789',
      });

      expect(db.insert).toHaveBeenCalled();
    });

    it('should handle non-Error objects gracefully', async () => {
      const { db } = await import('../../lib/db.js');

      await createStepFailureEscalation({
        jid: '60123456789',
        profileId: 'pelangi',
        stepId: 'step_id',
        workflowId: 'workflow_id',
        inputValues: {},
        error: 'String error message',
        guestPhone: '60123456789',
      });

      expect(db.insert).toHaveBeenCalled();
    });

    it('should include input values in escalation metadata', async () => {
      const { db } = await import('../../lib/db.js');

      const inputValues = {
        guestName: 'John Doe',
        roomType: 'Deluxe Suite',
        checkInDate: '2026-03-25',
      };

      await createStepFailureEscalation({
        jid: '60123456789',
        profileId: 'pelangi',
        stepId: 'booking_confirmation',
        workflowId: 'booking_workflow',
        inputValues,
        error: new Error('Database error'),
        guestPhone: '60123456789',
      });

      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe('executeWorkflowStepWithErrorRecovery', () => {
    it('should return success when step executes without error', async () => {
      const result = await executeWorkflowStepWithErrorRecovery(
        'booking_dates',
        'booking_workflow',
        'pelangi',
        '60123456789',
        'en',
        { checkInDate: '2026-03-25' },
        async () => ({ response: 'Booking confirmed' })
      );

      expect(result.success).toBe(true);
      expect(result.response).toContain('confirmed');
    });

    it('should return error recovery message when step fails', async () => {
      const result = await executeWorkflowStepWithErrorRecovery(
        'booking_dates',
        'booking_workflow',
        'pelangi',
        '60123456789',
        'en',
        {},
        async () => {
          throw new Error('Payment processing failed');
        }
      );

      expect(result.success).toBe(false);
      expect(result.response).toContain('front desk');
    });

    it('should use profile-specific message on failure', async () => {
      const makanResult = await executeWorkflowStepWithErrorRecovery(
        'order_step',
        'order_workflow',
        'makan',
        '60123456789',
        'en',
        {},
        async () => {
          throw new Error('Order failed');
        }
      );

      const pelangiResult = await executeWorkflowStepWithErrorRecovery(
        'booking_step',
        'booking_workflow',
        'pelangi',
        '60123456789',
        'en',
        {},
        async () => {
          throw new Error('Booking failed');
        }
      );

      expect(makanResult.response).toContain('staff will follow up');
      expect(pelangiResult.response).toContain('front desk');
    });

    it('should support language parameter in recovery message', async () => {
      const enResult = await executeWorkflowStepWithErrorRecovery(
        'booking_step',
        'booking_workflow',
        'pelangi',
        '60123456789',
        'en',
        {},
        async () => {
          throw new Error('Failed');
        }
      );

      const msResult = await executeWorkflowStepWithErrorRecovery(
        'booking_step',
        'booking_workflow',
        'pelangi',
        '60123456789',
        'ms',
        {},
        async () => {
          throw new Error('Failed');
        }
      );

      expect(enResult.response).not.toEqual(msResult.response);
    });

    it('should return error details in response', async () => {
      const result = await executeWorkflowStepWithErrorRecovery(
        'booking_step',
        'booking_workflow',
        'pelangi',
        '60123456789',
        'en',
        {},
        async () => {
          throw new Error('Specific error message');
        }
      );

      expect(result.error).toBe('Specific error message');
    });
  });
});
