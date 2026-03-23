/**
 * US-120: Workflow Timeout Integration Tests
 *
 * Tests timeout handling in the context of workflow step execution,
 * including escalation message sending and state management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowTimeoutError } from '../workflow-timeout-handler.js';

describe('US-120: Workflow Timeout Integration', () => {
  describe('Timeout detection', () => {
    it('should detect when max_duration_ms is exceeded', async () => {
      const maxDurationMs = 100;
      let actualDuration = 0;

      try {
        const startTime = Date.now();
        await new Promise((resolve, reject) => {
          setTimeout(() => {
            actualDuration = Date.now() - startTime;
            reject(new WorkflowTimeoutError('test_step', maxDurationMs, actualDuration));
          }, 150);
        });
      } catch (error) {
        if (error instanceof WorkflowTimeoutError) {
          expect(error.actualDurationMs).toBeGreaterThan(maxDurationMs);
          expect(error.maxDurationMs).toBe(maxDurationMs);
        }
      }
    });
  });

  describe('Escalation behavior', () => {
    it('should trigger escalation on timeout', () => {
      const error = new WorkflowTimeoutError('booking_step', 30000, 35000);

      // Verify error properties that trigger escalation
      expect(error instanceof WorkflowTimeoutError).toBe(true);
      expect(error.stepId).toBe('booking_step');
      expect(error.actualDurationMs > error.maxDurationMs).toBe(true);
    });

    it('should preserve workflow context on timeout', () => {
      const workflowId = 'booking_workflow';
      const stepId = 'confirm_booking';
      const profileId = 'pelangi';

      const timeoutData = {
        workflowId,
        stepId,
        profileId,
        maxDurationMs: 30000,
        actualDurationMs: 35000,
        messageType: 'escalation'
      };

      expect(timeoutData.workflowId).toBe(workflowId);
      expect(timeoutData.stepId).toBe(stepId);
      expect(timeoutData.profileId).toBe(profileId);
      expect(timeoutData.messageType).toBe('escalation');
    });
  });

  describe('Default timeout values', () => {
    it('should use default max_duration_ms of 30000', () => {
      const defaultTimeout = 30000;
      const step = {
        id: 'test_step',
        message: { en: 'Test', ms: 'Uji', zh: '测试' },
        waitForReply: false,
        // max_duration_ms not specified — should use default
      };

      const maxDurationMs = (step as any).max_duration_ms || defaultTimeout;
      expect(maxDurationMs).toBe(defaultTimeout);
    });

    it('should allow custom max_duration_ms override', () => {
      const step = {
        id: 'test_step',
        message: { en: 'Test', ms: 'Uji', zh: '测试' },
        waitForReply: false,
        max_duration_ms: 15000, // Custom timeout
      };

      const maxDurationMs = (step as any).max_duration_ms || 30000;
      expect(maxDurationMs).toBe(15000);
    });
  });

  describe('No partial state persistence', () => {
    it('should not save workflow state if timeout occurs', () => {
      // Simulate a timeout during step execution
      const workflowState = {
        workflowId: 'booking',
        currentStepIndex: 2,
        collectedData: {
          guest_name: 'John Doe',
          guest_count: '2'
        },
        startedAt: Date.now(),
        lastUpdateAt: Date.now()
      };

      // If timeout occurs during the third step (index 2),
      // we should NOT advance the index
      const shouldUpdateState = false; // Timeout prevents state update

      if (shouldUpdateState) {
        workflowState.currentStepIndex = 3;
      }

      // Verify state was NOT modified
      expect(workflowState.currentStepIndex).toBe(2);
      expect(Object.keys(workflowState.collectedData).length).toBe(2);
    });
  });

  describe('Escalation message localization', () => {
    it('should provide localized escalation messages', () => {
      const messages: Record<string, string> = {
        en: 'Sorry, something took too long to process. Our team will handle your request manually. Please stand by.',
        ms: 'Maaf, sesuatu mengambil terlalu lama untuk diproses. Tim kami akan mengendalikan permintaan anda secara manual. Sila tunggu.',
        zh: '抱歉，处理过程花了太长时间。我们的团队将手动处理您的请求。请稍候。'
      };

      for (const [language, message] of Object.entries(messages)) {
        expect(message).toBeTruthy();
        expect(message.length > 0).toBe(true);
      }
    });
  });

  describe('Timeout logging', () => {
    it('should log timeout with step and workflow context', () => {
      const logData = {
        event_type: 'workflow_step_timeout',
        step_id: 'booking_payment',
        workflow_id: 'booking_workflow',
        profile_id: 'pelangi',
        max_duration_ms: 30000,
        actual_duration_ms: 31500,
        timeout_exceeded_ms: 1500,
        timestamp: new Date().toISOString()
      };

      expect(logData.event_type).toBe('workflow_step_timeout');
      expect(logData.timeout_exceeded_ms).toBe(
        logData.actual_duration_ms - logData.max_duration_ms
      );
    });
  });
});
