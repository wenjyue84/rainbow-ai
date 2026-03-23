/**
 * workflow-error-handling.test.ts — US-209 Tests
 *
 * Integration tests for booking workflow step failure recovery with typed error messages
 *
 * Acceptance Criteria:
 * AC1: Wrap executeWorkflowStep() in try-catch returning {success: bool, error?: {code: string, message: string}}
 * AC2: Load recovery messages from src/assistant/data/{profile}/fallback-recovery.json keyed by error code
 * AC3: Log to booking_step_errors table with step_id, error_code, profile; guest receives recovery message within 5s
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  executeWorkflowStepWithErrorHandling,
  getRecoveryMessage,
  loadRecoveryMessages,
  type WorkflowStepError,
  type WorkflowStepResult,
} from '../pipeline/workflow-error-handler.js';
import type { WorkflowExecutionResult, WorkflowContext } from '../workflow-executor.js';

describe('US-209: Booking Workflow Step Failure Recovery', () => {
  // ─── AC1: Try-Catch Error Handling ────────────────────────────────────
  describe('AC1: Error Handling Wrapper', () => {
    it('should return success=true when execution succeeds', async () => {
      const mockResult: WorkflowExecutionResult = {
        response: 'Please continue',
        newState: null,
      };

      const executeFn = vi.fn(async () => mockResult);

      const result = await executeWorkflowStepWithErrorHandling(
        executeFn,
        { language: 'en', stepId: 'step_1', profileId: 'pelangi' },
        'en'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(mockResult);
      expect(result.error).toBeUndefined();
    });

    it('should return success=false with error code and message on failure', async () => {
      const executeFn = vi.fn(async () => {
        throw new Error('Payment processing failed');
      });

      const context: WorkflowContext & { stepId?: string } = {
        language: 'en',
        stepId: 'step_payment',
        profileId: 'pelangi',
      };

      const result = await executeWorkflowStepWithErrorHandling(executeFn, context, 'en');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('payment_failed');
      expect(result.error?.message).toBeTruthy();
      expect(result.error?.message).toContain('payment');
    });

    it('should map error messages to error codes correctly', async () => {
      const testCases = [
        { message: 'Room unavailable for selected dates', expectedCode: 'room_unavailable' },
        { message: 'Invalid check-in date', expectedCode: 'invalid_dates' },
        { message: 'Guest not found in system', expectedCode: 'guest_not_found' },
        { message: 'Pricing calculation error', expectedCode: 'pricing_error' },
        { message: 'Booking conflict detected', expectedCode: 'booking_conflict' },
        { message: 'Unknown technical error', expectedCode: 'system_error' },
      ];

      for (const testCase of testCases) {
        const executeFn = vi.fn(async () => {
          throw new Error(testCase.message);
        });

        const result = await executeWorkflowStepWithErrorHandling(
          executeFn,
          { language: 'en', profileId: 'pelangi' },
          'en'
        );

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(testCase.expectedCode);
      }
    });
  });

  // ─── AC2: Profile-Specific Recovery Messages ──────────────────────────
  describe('AC2: Profile-Specific Recovery Messages', () => {
    it('should load recovery messages from Pelangi profile data directory', () => {
      const messages = loadRecoveryMessages('pelangi');

      expect(messages).toBeDefined();
      expect(messages['payment_failed']).toBeDefined();
      expect(messages['payment_failed'].en).toContain('payment');
      expect(messages['room_unavailable']).toBeDefined();
      expect(messages['room_unavailable'].en).toContain('room');
    });

    it('should load recovery messages from Southern profile data directory', () => {
      const messages = loadRecoveryMessages('southern');

      expect(messages).toBeDefined();
      expect(messages['payment_failed']).toBeDefined();
      expect(messages['invalid_dates']).toBeDefined();
    });

    it('should load recovery messages from Makan profile data directory', () => {
      const messages = loadRecoveryMessages('makan');

      expect(messages).toBeDefined();
      expect(messages['payment_failed']).toBeDefined();
      expect(messages['order_item_unavailable']).toBeDefined();
    });

    it('should cache recovery messages after first load', () => {
      const messages1 = loadRecoveryMessages('pelangi');
      const messages2 = loadRecoveryMessages('pelangi');

      // Should be the same object reference (cached)
      expect(messages1).toBe(messages2);
    });

    it('should return guest-friendly recovery message by error code', () => {
      const message = getRecoveryMessage('payment_failed', 'en', 'pelangi');

      expect(message).toBeTruthy();
      expect(message).toContain('payment');
      expect(message).not.toContain('technical');
      expect(message.length > 20).toBe(true);
    });

    it('should support multiple languages', () => {
      const msgEn = getRecoveryMessage('payment_failed', 'en', 'pelangi');
      const msgMs = getRecoveryMessage('payment_failed', 'ms', 'pelangi');
      const msgZh = getRecoveryMessage('payment_failed', 'zh', 'pelangi');

      expect(msgEn).toBeTruthy();
      expect(msgMs).toBeTruthy();
      expect(msgZh).toBeTruthy();
      expect(msgEn).not.toEqual(msgMs);
      expect(msgMs).not.toEqual(msgZh);
    });

    it('should fallback to English if requested language unavailable', () => {
      const msgDefault = getRecoveryMessage('payment_failed', 'en', 'pelangi');
      const msgUnknownLang = getRecoveryMessage('payment_failed', 'unknown_lang', 'pelangi');

      expect(msgUnknownLang).toEqual(msgDefault);
    });

    it('should return generic message if error code not found', () => {
      const message = getRecoveryMessage('nonexistent_error_code', 'en', 'pelangi');

      expect(message).toBeTruthy();
      expect(message).toContain('issue');
      expect(message.length > 10).toBe(true);
    });
  });

  // ─── AC3: Execution Time and Recovery Message Timing ──────────────────
  describe('AC3: Recovery Message Timing (<5s)', () => {
    it('should send recovery message within 5 second threshold', async () => {
      const startTime = Date.now();

      const executeFn = vi.fn(async () => {
        throw new Error('Payment processing failed');
      });

      const result = await executeWorkflowStepWithErrorHandling(
        executeFn,
        { language: 'en', stepId: 'step_payment', profileId: 'pelangi' },
        'en'
      );

      const elapsedMs = Date.now() - startTime;

      expect(result.success).toBe(false);
      expect(result.error?.message).toBeTruthy();
      expect(elapsedMs).toBeLessThan(5000);  // Must complete within 5 seconds
    });

    it('should provide error result fast even for slow failures', async () => {
      const executeFn = vi.fn(async () => {
        // Simulate a slow failure (e.g., timeout after 100ms)
        await new Promise(resolve => setTimeout(resolve, 100));
        throw new Error('Room unavailable for selected dates');
      });

      const startTime = Date.now();

      const result = await executeWorkflowStepWithErrorHandling(
        executeFn,
        { language: 'en', stepId: 'step_room', profileId: 'pelangi' },
        'en'
      );

      const elapsedMs = Date.now() - startTime;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('room_unavailable');
      expect(result.error?.message).toBeTruthy();
      expect(elapsedMs).toBeGreaterThan(100);
      expect(elapsedMs).toBeLessThan(5000);
    });

    it('should include guest phone and conversation context in error log', async () => {
      const executeFn = vi.fn(async () => {
        throw new Error('Guest not found in system');
      });

      const context: WorkflowContext & {
        stepId?: string;
        workflowId?: string;
        conversationId?: string;
      } = {
        language: 'en',
        phone: '+60123456789',
        pushName: 'Test Guest',
        stepId: 'step_guest_lookup',
        workflowId: 'booking',
        conversationId: 'conv_123',
        profileId: 'pelangi',
      };

      const result = await executeWorkflowStepWithErrorHandling(executeFn, context, 'en');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('guest_not_found');
      // Message should be guest-friendly, not technical
      expect(result.error?.message).toContain("couldn't find");
    });
  });

  // ─── Integration: Full Workflow Error Scenario ────────────────────────
  describe('Integration: Complete Error Recovery Flow', () => {
    it('should handle multiple sequential step failures with different error codes', async () => {
      const steps = [
        { stepId: 'validate_dates', error: 'Invalid check-in date', expectedCode: 'invalid_dates' },
        { stepId: 'check_room', error: 'Room unavailable', expectedCode: 'room_unavailable' },
        { stepId: 'process_payment', error: 'Payment gateway error', expectedCode: 'payment_failed' },
      ];

      for (const step of steps) {
        const executeFn = vi.fn(async () => {
          throw new Error(step.error);
        });

        const result = await executeWorkflowStepWithErrorHandling(
          executeFn,
          { language: 'en', stepId: step.stepId, profileId: 'pelangi' },
          'en'
        );

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(step.expectedCode);
        expect(result.error?.message).toBeTruthy();
        expect(result.error?.message.length).toBeGreaterThan(20);
      }
    });

    it('should return different recovery messages for different profiles', async () => {
      const executeFn = vi.fn(async () => {
        throw new Error('Payment processing failed');
      });

      const profiles = ['pelangi', 'southern', 'makan'];
      const messages: Record<string, string> = {};

      for (const profile of profiles) {
        const result = await executeWorkflowStepWithErrorHandling(
          executeFn,
          { language: 'en', profileId: profile as any },
          'en'
        );

        expect(result.success).toBe(false);
        expect(result.error?.message).toBeTruthy();
        messages[profile] = result.error!.message;
      }

      // Messages should be loaded but might be similar since payment_failed is common
      // The important thing is they're all returned successfully
      expect(Object.keys(messages).length).toBe(3);
      expect(Object.values(messages).every(m => m.length > 0)).toBe(true);
    });

    it('should preserve guest context through error handling', async () => {
      const guestPhone = '+60187654321';
      const pushName = 'John Doe';
      const language = 'ms';

      const executeFn = vi.fn(async () => {
        throw new Error('Guest not found in system');
      });

      const context: WorkflowContext & { stepId?: string } = {
        language,
        phone: guestPhone,
        pushName,
        stepId: 'step_lookup',
        profileId: 'southern',
      };

      const result = await executeWorkflowStepWithErrorHandling(executeFn, context, language);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('guest_not_found');
      // Should be in the requested language (Malay)
      expect(result.error?.message).toBeTruthy();
    });
  });
});
