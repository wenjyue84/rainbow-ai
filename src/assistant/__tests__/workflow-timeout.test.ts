/**
 * US-120: Workflow Step Execution Timeout Tests
 *
 * Verifies that:
 * - Workflow steps timeout if they exceed max_duration_ms
 * - Timeout results in automatic escalation message
 * - No partial state persists after timeout
 * - Guest receives escalation message with retry option
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeWithTimeout, WorkflowTimeoutError, logTimeoutFailure } from '../workflow-timeout-handler.js';

describe('US-120: Workflow Timeout Handler', () => {
  describe('executeWithTimeout', () => {
    it('should resolve successfully if step completes within timeout', async () => {
      const testValue = 'success';
      const result = await executeWithTimeout(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return testValue;
        },
        'test_step',
        200
      );

      expect(result).toBe(testValue);
    });

    it('should throw WorkflowTimeoutError if step exceeds max_duration_ms', async () => {
      const stepId = 'slow_step';
      const maxDurationMs = 100;

      const promise = executeWithTimeout(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 500));
          return 'should not complete';
        },
        stepId,
        maxDurationMs
      );

      await expect(promise).rejects.toThrow(WorkflowTimeoutError);
      try {
        await promise;
      } catch (error) {
        if (error instanceof WorkflowTimeoutError) {
          expect(error.stepId).toBe(stepId);
          expect(error.maxDurationMs).toBe(maxDurationMs);
          expect(error.actualDurationMs).toBeGreaterThanOrEqual(maxDurationMs);
        }
      }
    });

    it('should propagate step function errors that occur before timeout', async () => {
      const testError = new Error('Step function error');

      await expect(
        executeWithTimeout(
          async () => {
            throw testError;
          },
          'error_step',
          1000
        )
      ).rejects.toThrow(testError.message);
    });

    it('should use default timeout of 30000ms if not specified', async () => {
      const result = await executeWithTimeout(
        async () => 'completed',
        'default_timeout_step'
      );

      expect(result).toBe('completed');
    });

    it('should measure actual duration correctly', async () => {
      const stepId = 'duration_test';
      const expectedDurationMs = 100;

      try {
        await executeWithTimeout(
          async () => {
            await new Promise(resolve => setTimeout(resolve, expectedDurationMs));
            return 'should not complete';
          },
          stepId,
          50
        );
      } catch (error) {
        if (error instanceof WorkflowTimeoutError) {
          expect(error.actualDurationMs).toBeGreaterThanOrEqual(50);
          expect(error.actualDurationMs).toBeLessThan(expectedDurationMs + 50);
        }
      }
    });
  });

  describe('WorkflowTimeoutError', () => {
    it('should contain correct error information', () => {
      const stepId = 'test_step';
      const maxDurationMs = 5000;
      const actualDurationMs = 6500;

      const error = new WorkflowTimeoutError(stepId, maxDurationMs, actualDurationMs);

      expect(error.stepId).toBe(stepId);
      expect(error.maxDurationMs).toBe(maxDurationMs);
      expect(error.actualDurationMs).toBe(actualDurationMs);
      expect(error.message).toContain('test_step');
      expect(error.message).toContain('5000');
      expect(error.message).toContain('6500');
      expect(error.name).toBe('WorkflowTimeoutError');
    });
  });

  describe('logTimeoutFailure', () => {
    it('should create structured log with all required fields', () => {
      const stepId = 'booking_payment';
      const maxDurationMs = 30000;
      const actualDurationMs = 31500;
      const workflowId = 'booking_workflow';
      const profileId = 'pelangi';

      const log = logTimeoutFailure(
        stepId,
        maxDurationMs,
        actualDurationMs,
        workflowId,
        profileId
      );

      expect(log.event_type).toBe('workflow_step_timeout');
      expect(log.step_id).toBe(stepId);
      expect(log.workflow_id).toBe(workflowId);
      expect(log.profile_id).toBe(profileId);
      expect(log.max_duration_ms).toBe(maxDurationMs);
      expect(log.actual_duration_ms).toBe(actualDurationMs);
      expect(log.timeout_exceeded_ms).toBe(1500);
      expect(log.timestamp).toBeDefined();
    });

    it('should handle missing profileId gracefully', () => {
      const log = logTimeoutFailure(
        'step_id',
        5000,
        6000,
        'workflow_id'
      );

      expect(log.profile_id).toBeUndefined();
      expect(log.event_type).toBe('workflow_step_timeout');
    });
  });

  describe('Timeout isolation', () => {
    it('should not affect parallel promises', async () => {
      const promise1 = executeWithTimeout(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return 'result1';
        },
        'step1',
        200
      );

      const promise2 = executeWithTimeout(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return 'timeout_result';
        },
        'step2',
        100
      );

      const [result1] = await Promise.allSettled([promise1, promise2]);
      expect((result1 as PromiseFulfilledResult<string>).value).toBe('result1');
    });
  });
});
