/**
 * US-264: Booking Workflow Step Timeout Detection with Auto-Rollback
 *
 * Tests:
 * 1. workflows.json booking steps have timeout field (default 5000ms)
 * 2. stepExecutionTimer triggers rollback on timeout and returns step_timeout reason code
 * 3. Booking confirmation step timeout triggers guest state rollback and prevents partial confirmation
 * 4. Recovery message matches expected text
 * 5. Successful steps within timeout return normally
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  stepExecutionTimer,
  executeBookingStepWithTimeout,
  getStepTimeout,
  BookingStepTimeoutError,
  DEFAULT_STEP_TIMEOUT_MS,
  STEP_TIMEOUT_REASON_CODE,
  TIMEOUT_RECOVERY_MESSAGES,
} from '../pipeline/booking-executor.js';
import type { BookingState, BookingStepResult } from '../types.js';

// ─── Helper: Load workflows.json ─────────────────────────────────────

function loadWorkflows() {
  const raw = readFileSync(join(process.cwd(), 'src/assistant/data/workflows.json'), 'utf-8');
  return JSON.parse(raw);
}

// ─── Helper: Create a delayed step function ──────────────────────────

function createDelayedStep(
  delayMs: number,
  result: BookingStepResult
): () => Promise<BookingStepResult> {
  return () =>
    new Promise((resolve) => {
      setTimeout(() => resolve(result), delayMs);
    });
}

function createFailingStep(
  delayMs: number,
  errorMessage: string
): () => Promise<BookingStepResult> {
  return () =>
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(errorMessage)), delayMs);
    });
}

// ─── Test: workflows.json timeout fields ─────────────────────────────

describe('US-264: workflows.json booking step timeout fields', () => {
  const { workflows } = loadWorkflows();
  const bookingWorkflow = workflows.find((w: any) => w.id === 'booking_payment_handler');

  it('booking_payment_handler workflow exists and has nodes', () => {
    expect(bookingWorkflow).toBeDefined();
    expect(bookingWorkflow.nodes).toBeDefined();
    expect(Array.isArray(bookingWorkflow.nodes)).toBe(true);
  });

  it('each booking step node has a timeout field', () => {
    for (const node of bookingWorkflow.nodes) {
      expect(node.timeout).toBeDefined();
      expect(typeof node.timeout).toBe('number');
    }
  });

  it('timeout defaults to 5000ms for all booking steps', () => {
    for (const node of bookingWorkflow.nodes) {
      expect(node.timeout).toBe(5000);
    }
  });

  it('confirm_booking_msg node has timeout field', () => {
    const confirmNode = bookingWorkflow.nodes.find(
      (n: any) => n.id === 'confirm_booking_msg'
    );
    expect(confirmNode).toBeDefined();
    expect(confirmNode.timeout).toBe(5000);
  });
});

// ─── Test: getStepTimeout ────────────────────────────────────────────

describe('US-264: getStepTimeout', () => {
  it('returns node timeout when defined', () => {
    const nodes = [
      { id: 'step_a', timeout: 3000 },
      { id: 'step_b', timeout: 8000 },
    ];
    expect(getStepTimeout('step_a', nodes)).toBe(3000);
    expect(getStepTimeout('step_b', nodes)).toBe(8000);
  });

  it('returns DEFAULT_STEP_TIMEOUT_MS when node has no timeout', () => {
    const nodes = [{ id: 'step_a' }];
    expect(getStepTimeout('step_a', nodes)).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });

  it('returns DEFAULT_STEP_TIMEOUT_MS when node not found', () => {
    const nodes = [{ id: 'step_a', timeout: 3000 }];
    expect(getStepTimeout('nonexistent', nodes)).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });

  it('returns DEFAULT_STEP_TIMEOUT_MS when no nodes provided', () => {
    expect(getStepTimeout('any_step')).toBe(DEFAULT_STEP_TIMEOUT_MS);
    expect(getStepTimeout('any_step', undefined)).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });
});

// ─── Test: stepExecutionTimer — successful execution ─────────────────

describe('US-264: stepExecutionTimer — successful step', () => {
  const preState: BookingState = {
    stage: 'confirm',
    checkIn: '2026-04-01',
    checkOut: '2026-04-03',
    guests: 2,
  };

  const expectedResult: BookingStepResult = {
    response: 'Booking confirmed!',
    newState: { ...preState, stage: 'done' },
  };

  it('returns success when step completes within timeout', async () => {
    const fastStep = createDelayedStep(10, expectedResult);

    const result = await stepExecutionTimer(fastStep, preState, 'confirm_booking_msg', 5000);

    expect(result.success).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.result).toEqual(expectedResult);
    expect(result.reasonCode).toBeUndefined();
    expect(result.recoveryMessage).toBeUndefined();
    expect(result.rolledBackState).toBeUndefined();
    expect(result.elapsedMs).toBeLessThan(5000);
  });
});

// ─── Test: stepExecutionTimer — timeout triggers rollback ────────────

describe('US-264: stepExecutionTimer — timeout triggers rollback', () => {
  const preState: BookingState = {
    stage: 'confirm',
    checkIn: '2026-04-01',
    checkOut: '2026-04-03',
    guests: 2,
  };

  it('returns step_timeout reason code on timeout', async () => {
    const slowResult: BookingStepResult = {
      response: 'This should never be seen',
      newState: { ...preState, stage: 'done' },
    };
    // Step takes 200ms but timeout is 50ms
    const slowStep = createDelayedStep(200, slowResult);

    const result = await stepExecutionTimer(slowStep, preState, 'confirm_booking_msg', 50);

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.reasonCode).toBe(STEP_TIMEOUT_REASON_CODE);
    expect(result.reasonCode).toBe('step_timeout');
  });

  it('returns recovery message on timeout', async () => {
    const slowStep = createDelayedStep(200, {
      response: 'ignored',
      newState: { ...preState, stage: 'done' },
    });

    const result = await stepExecutionTimer(slowStep, preState, 'confirm_booking_msg', 50, 'en');

    expect(result.recoveryMessage).toBe(
      'Booking step took too long. Please try again or speak with staff.'
    );
  });

  it('returns localized recovery message for Malay', async () => {
    const slowStep = createDelayedStep(200, {
      response: 'ignored',
      newState: { ...preState, stage: 'done' },
    });

    const result = await stepExecutionTimer(slowStep, preState, 'confirm_booking_msg', 50, 'ms');

    expect(result.recoveryMessage).toBe(TIMEOUT_RECOVERY_MESSAGES.ms);
  });

  it('rolls back guest booking state to pre-execution snapshot', async () => {
    const slowStep = createDelayedStep(200, {
      response: 'ignored',
      newState: { ...preState, stage: 'done' },
    });

    const result = await stepExecutionTimer(slowStep, preState, 'confirm_booking_msg', 50);

    expect(result.rolledBackState).toBeDefined();
    expect(result.rolledBackState!.stage).toBe('confirm');
    expect(result.rolledBackState!.checkIn).toBe('2026-04-01');
    expect(result.rolledBackState!.checkOut).toBe('2026-04-03');
    expect(result.rolledBackState!.guests).toBe(2);
  });

  it('does NOT return the step result on timeout', async () => {
    const slowStep = createDelayedStep(200, {
      response: 'This would have been the booking confirmation',
      newState: { ...preState, stage: 'done' },
    });

    const result = await stepExecutionTimer(slowStep, preState, 'confirm_booking_msg', 50);

    expect(result.result).toBeUndefined();
  });
});

// ─── Test: Booking confirmation step timeout prevents partial confirmation ──

describe('US-264: booking confirmation step timeout prevents partial booking confirmation', () => {
  it('confirmation step timeout rolls back state from confirm to pre-execution', async () => {
    const preConfirmState: BookingState = {
      stage: 'confirm',
      checkIn: '2026-05-01',
      checkOut: '2026-05-03',
      guests: 3,
      guestName: 'Alice',
    };

    // Simulate a confirmation step that would normally advance to 'done'
    // but hangs (takes too long)
    const hangingConfirmStep = createDelayedStep(500, {
      response: 'Booking confirmed! Your reservation is all set.',
      newState: { ...preConfirmState, stage: 'done' },
    });

    const result = await stepExecutionTimer(
      hangingConfirmStep,
      preConfirmState,
      'confirm_booking_msg',
      50 // Very short timeout to trigger rollback
    );

    // Verify rollback happened
    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);

    // Guest state was rolled back — NOT advanced to 'done'
    expect(result.rolledBackState).toBeDefined();
    expect(result.rolledBackState!.stage).toBe('confirm');
    expect(result.rolledBackState!.stage).not.toBe('done');

    // Original guest data preserved in rollback
    expect(result.rolledBackState!.guestName).toBe('Alice');
    expect(result.rolledBackState!.guests).toBe(3);

    // No partial result leaked
    expect(result.result).toBeUndefined();

    // Correct reason code
    expect(result.reasonCode).toBe('step_timeout');

    // Recovery message present
    expect(result.recoveryMessage).toContain('try again');
  });

  it('pre-execution state is a snapshot (not a reference)', async () => {
    const preState: BookingState = {
      stage: 'confirm',
      checkIn: '2026-06-01',
      checkOut: '2026-06-03',
      guests: 1,
    };

    const slowStep = createDelayedStep(200, {
      response: 'done',
      newState: { ...preState, stage: 'done' },
    });

    const result = await stepExecutionTimer(slowStep, preState, 'step_x', 50);

    // Mutate the original pre-state after the call
    preState.stage = 'cancelled';

    // Rolled back state should still be 'confirm' (snapshot)
    expect(result.rolledBackState!.stage).toBe('confirm');
  });
});

// ─── Test: stepExecutionTimer — step error (non-timeout) ─────────────

describe('US-264: stepExecutionTimer — step error (non-timeout)', () => {
  const preState: BookingState = {
    stage: 'confirm',
    checkIn: '2026-04-01',
    checkOut: '2026-04-03',
    guests: 2,
  };

  it('rolls back state on step execution error', async () => {
    const failingStep = createFailingStep(10, 'Payment gateway unreachable');

    const result = await stepExecutionTimer(failingStep, preState, 'confirm_booking_msg', 5000);

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.reasonCode).toBe('step_error');
    expect(result.rolledBackState).toBeDefined();
    expect(result.rolledBackState!.stage).toBe('confirm');
  });
});

// ─── Test: executeBookingStepWithTimeout ─────────────────────────────

describe('US-264: executeBookingStepWithTimeout', () => {
  const preState: BookingState = {
    stage: 'dates',
    checkIn: '2026-04-01',
  };

  const stepResult: BookingStepResult = {
    response: 'How many guests?',
    newState: { ...preState, stage: 'guests' },
  };

  it('uses timeout from workflow nodes config', async () => {
    const nodes = [
      { id: 'wait_booking_dates', timeout: 3000 },
      { id: 'wait_guest_count', timeout: 8000 },
    ];

    const fastStep = createDelayedStep(10, stepResult);
    const result = await executeBookingStepWithTimeout(
      fastStep,
      preState,
      'wait_booking_dates',
      nodes
    );

    expect(result.success).toBe(true);
    expect(result.result).toEqual(stepResult);
  });

  it('falls back to default timeout when node has no timeout', async () => {
    const nodes = [{ id: 'wait_booking_dates' }];

    const fastStep = createDelayedStep(10, stepResult);
    const result = await executeBookingStepWithTimeout(
      fastStep,
      preState,
      'wait_booking_dates',
      nodes
    );

    expect(result.success).toBe(true);
  });
});

// ─── Test: BookingStepTimeoutError ───────────────────────────────────

describe('US-264: BookingStepTimeoutError', () => {
  it('creates error with correct properties', () => {
    const error = new BookingStepTimeoutError('confirm_booking_msg', 5000);

    expect(error.name).toBe('BookingStepTimeoutError');
    expect(error.stepId).toBe('confirm_booking_msg');
    expect(error.timeoutMs).toBe(5000);
    expect(error.reasonCode).toBe('step_timeout');
    expect(error.message).toContain('confirm_booking_msg');
    expect(error.message).toContain('5000ms');
  });
});

// ─── Test: Recovery message content ──────────────────────────────────

describe('US-264: recovery messages', () => {
  it('English recovery message matches AC', () => {
    expect(TIMEOUT_RECOVERY_MESSAGES.en).toBe(
      'Booking step took too long. Please try again or speak with staff.'
    );
  });

  it('all supported languages have recovery messages', () => {
    expect(TIMEOUT_RECOVERY_MESSAGES.en).toBeTruthy();
    expect(TIMEOUT_RECOVERY_MESSAGES.ms).toBeTruthy();
    expect(TIMEOUT_RECOVERY_MESSAGES.zh).toBeTruthy();
    expect(TIMEOUT_RECOVERY_MESSAGES.ta).toBeTruthy();
  });

  it('falls back to English for unknown language', async () => {
    const preState: BookingState = { stage: 'confirm' };
    const slowStep = createDelayedStep(200, {
      response: 'ignored',
      newState: { stage: 'done' },
    });

    const result = await stepExecutionTimer(slowStep, preState, 'step_x', 50, 'fr');

    // French not defined — should fall back to English
    expect(result.recoveryMessage).toBe(TIMEOUT_RECOVERY_MESSAGES.en);
  });
});
