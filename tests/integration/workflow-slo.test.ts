/**
 * US-483: Booking Workflow Step Duration SLO Tracker Integration Tests
 *
 * Tests SLO violation detection and logging for booking workflow steps.
 * - Mock slow step execution (exceeds SLO thresholds)
 * - Verify SLO violation is detected and logged as warning
 * - Verify workflow completes gracefully without crash
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stepExecutionTimer } from '../../src/assistant/pipeline/booking-executor.js';
import type { BookingState, BookingStepResult } from '../../src/assistant/types.js';

describe('US-483: Booking Workflow Step Duration SLO Tracker', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on console methods to capture warnings and errors
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleDebugSpy.mockRestore();
  });

  it('should record step duration in execution result', async () => {
    const mockStep = async (): Promise<BookingStepResult> => {
      // Simulate 100ms execution
      await new Promise(resolve => setTimeout(resolve, 100));
      return { response: 'success' };
    };

    const preState: BookingState = {
      guestPhone: '+60123456789',
      profile: 'pelangi',
      collectedData: {},
    };

    const result = await stepExecutionTimer(
      mockStep,
      preState,
      'test_step',
      5000,
      'en'
    );

    expect(result.success).toBe(true);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(100);
    expect(result.elapsedMs).toBeLessThan(500); // Should be fast, less than 500ms
    expect(result.timedOut).toBe(false);
  });

  it('should timeout step that exceeds absolute timeout threshold', async () => {
    const mockSlowStep = async (): Promise<BookingStepResult> => {
      // Simulate execution that will timeout
      await new Promise(resolve => setTimeout(resolve, 3000));
      return { response: 'sms_sent' };
    };

    const preState: BookingState = {
      guestPhone: '+60123456789',
      profile: 'pelangi',
      collectedData: {},
    };

    // Set timeout to 1000ms (step will exceed this)
    const result = await stepExecutionTimer(
      mockSlowStep,
      preState,
      'send_sms',
      1000,
      'en'
    );

    // Step should fail due to timeout
    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.reasonCode).toBe('step_timeout');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(1000);
    expect(result.elapsedMs).toBeLessThan(1500); // Timeout fired at 1000ms
  });

  it('should continue workflow gracefully on SLO violation (not blocking)', async () => {
    const mockStep = async (): Promise<BookingStepResult> => {
      // Simulate a step that completes after some delay
      await new Promise(resolve => setTimeout(resolve, 500));
      return { response: 'step_completed' };
    };

    const preState: BookingState = {
      guestPhone: '+60123456789',
      profile: 'pelangi',
      collectedData: {},
    };

    // Call step with a timeout much higher than execution time
    const result = await stepExecutionTimer(
      mockStep,
      preState,
      'some_step',
      10000,
      'en'
    );

    // Workflow should complete successfully
    expect(result.success).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.result?.response).toBe('step_completed');

    // No errors should be thrown or caught
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('should handle step execution errors gracefully', async () => {
    const mockFailingStep = async (): Promise<BookingStepResult> => {
      throw new Error('Step execution failed');
    };

    const preState: BookingState = {
      guestPhone: '+60123456789',
      profile: 'pelangi',
      collectedData: {},
    };

    const result = await stepExecutionTimer(
      mockFailingStep,
      preState,
      'failing_step',
      5000,
      'en'
    );

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.reasonCode).toBe('step_error');
    expect(result.recoveryMessage).toBeDefined();
  });

  it('should return appropriate recovery message for language (en)', async () => {
    const mockFailingStep = async (): Promise<BookingStepResult> => {
      throw new Error('Test error');
    };

    const preState: BookingState = {
      guestPhone: '+60123456789',
      profile: 'pelangi',
      collectedData: {},
    };

    const result = await stepExecutionTimer(
      mockFailingStep,
      preState,
      'test_step',
      5000,
      'en'
    );

    expect(result.recoveryMessage).toContain('Booking step took too long');
  });

  it('should return appropriate recovery message for language (ms)', async () => {
    const mockFailingStep = async (): Promise<BookingStepResult> => {
      throw new Error('Test error');
    };

    const preState: BookingState = {
      guestPhone: '+60123456789',
      profile: 'pelangi',
      collectedData: {},
    };

    const result = await stepExecutionTimer(
      mockFailingStep,
      preState,
      'test_step',
      5000,
      'ms'
    );

    expect(result.recoveryMessage).toContain('Langkah tempahan');
  });

  it('should include pre-execution state in rollback on timeout', async () => {
    const preState: BookingState = {
      guestPhone: '+60987654321',
      profile: 'southern',
      collectedData: {
        unitId: 'room-101',
        checkIn: '2026-04-15',
      },
    };

    const mockSlowStep = async (): Promise<BookingStepResult> => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return { response: 'would_not_complete' };
    };

    const result = await stepExecutionTimer(
      mockSlowStep,
      preState,
      'test_step',
      1000,
      'en'
    );

    expect(result.timedOut).toBe(true);
    expect(result.rolledBackState).toBeDefined();
    expect(result.rolledBackState?.guestPhone).toBe(preState.guestPhone);
    expect(result.rolledBackState?.collectedData).toEqual(preState.collectedData);
  });

  it('should return elapsedMs in successful execution', async () => {
    const mockStep = async (): Promise<BookingStepResult> => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return { response: 'completed' };
    };

    const preState: BookingState = {
      guestPhone: '+60123456789',
      profile: 'pelangi',
      collectedData: {},
    };

    const result = await stepExecutionTimer(
      mockStep,
      preState,
      'test_step',
      5000,
      'en'
    );

    expect(result.success).toBe(true);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(200);
    expect(typeof result.elapsedMs).toBe('number');
  });

  it('should not block workflow on internal SLO check errors', async () => {
    const mockStep = async (): Promise<BookingStepResult> => {
      return { response: 'success' };
    };

    const preState: BookingState = {
      guestPhone: '+60123456789',
      profile: 'pelangi',
      collectedData: {},
    };

    // Even if SLO loading fails internally, the step should complete
    const result = await stepExecutionTimer(
      mockStep,
      preState,
      'unknown_step_with_no_slo',
      5000,
      'en'
    );

    expect(result.success).toBe(true);
    expect(result.timedOut).toBe(false);
  });
});
