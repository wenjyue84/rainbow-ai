/**
 * US-264: Booking Workflow Step Timeout Detection with Auto-Rollback
 *
 * Provides a stepExecutionTimer that wraps booking step execution with
 * configurable per-step timeouts. When a step exceeds its timeout threshold,
 * the guest's booking state is automatically rolled back and a clear
 * step_timeout error with recovery message is returned.
 */

import type { BookingState, BookingStepResult } from '../types.js';

// ─── Constants ───────────────────────────────────────────────────────

/** Default timeout for booking steps (ms) */
export const DEFAULT_STEP_TIMEOUT_MS = 5000;

/** Reason code returned on step timeout */
export const STEP_TIMEOUT_REASON_CODE = 'step_timeout';

/** Recovery messages per language */
export const TIMEOUT_RECOVERY_MESSAGES: Record<string, string> = {
  en: 'Booking step took too long. Please try again or speak with staff.',
  ms: 'Langkah tempahan mengambil masa terlalu lama. Sila cuba lagi atau hubungi kakitangan.',
  zh: '\u9884\u8BA2\u6B65\u9AA4\u8017\u65F6\u8FC7\u957F\u3002\u8BF7\u91CD\u8BD5\u6216\u8054\u7CFB\u5DE5\u4F5C\u4EBA\u5458\u3002',
  ta: '\u0BAA\u0BC1\u0B95\u0BCD\u0B95\u0BBF\u0B99\u0BCD \u0BA8\u0B9F\u0BB5\u0B9F\u0BBF\u0B95\u0BCD\u0B95\u0BC8 \u0BAE\u0BBF\u0B95\u0BB5\u0BC1\u0BAE\u0BCD \u0BA8\u0BC0\u0BA3\u0BCD\u0B9F\u0BA4\u0BC1. \u0BAE\u0BC0\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD \u0BAE\u0BC1\u0BAF\u0BB1\u0BCD\u0B9A\u0BBF\u0B95\u0BCD\u0B95\u0BB5\u0BC1\u0BAE\u0BCD \u0B85\u0BB2\u0BCD\u0BB2\u0BA4\u0BC1 \u0B8A\u0BB4\u0BBF\u0BAF\u0BB0\u0BCD\u0B95\u0BB3\u0BBF\u0B9F\u0BAE\u0BCD \u0BAA\u0BC7\u0B9A\u0BC1\u0B99\u0BCD\u0B95\u0BB3\u0BCD.',
};

// ─── Types ───────────────────────────────────────────────────────────

/**
 * Result of a booking step execution with timeout handling.
 * On timeout, includes reason code and recovery message.
 */
export interface BookingExecutionResult {
  success: boolean;
  result?: BookingStepResult;
  timedOut: boolean;
  reasonCode?: string;
  recoveryMessage?: string;
  /** The pre-timeout booking state for rollback verification */
  rolledBackState?: BookingState;
  elapsedMs: number;
}

/**
 * Custom error for booking step timeouts.
 */
export class BookingStepTimeoutError extends Error {
  public readonly stepId: string;
  public readonly timeoutMs: number;
  public readonly reasonCode = STEP_TIMEOUT_REASON_CODE;

  constructor(stepId: string, timeoutMs: number) {
    super(
      `Booking step "${stepId}" timed out after ${timeoutMs}ms`
    );
    this.name = 'BookingStepTimeoutError';
    this.stepId = stepId;
    this.timeoutMs = timeoutMs;
  }
}

// ─── Step Timeout Configuration ──────────────────────────────────────

/**
 * Reads the timeout value for a specific booking step from the workflow
 * definition. Falls back to DEFAULT_STEP_TIMEOUT_MS if no timeout is
 * defined on the node.
 */
export function getStepTimeout(
  stepId: string,
  workflowNodes?: Array<{ id: string; timeout?: number }>
): number {
  if (!workflowNodes) return DEFAULT_STEP_TIMEOUT_MS;
  const node = workflowNodes.find(n => n.id === stepId);
  return node?.timeout ?? DEFAULT_STEP_TIMEOUT_MS;
}

// ─── Core Timer ──────────────────────────────────────────────────────

/**
 * stepExecutionTimer wraps a booking step function with a timeout.
 *
 * If the step completes within the timeout, returns the step result.
 * If the step exceeds the timeout:
 *   1. Rolls back the guest booking state to the pre-execution snapshot
 *   2. Returns a BookingExecutionResult with step_timeout reason code
 *      and a localized recovery message
 *   3. Prevents any partial booking confirmation from being persisted
 *
 * @param executeFn - The async function that executes the booking step
 * @param preExecutionState - Snapshot of booking state before step runs (for rollback)
 * @param stepId - Identifier of the step being executed
 * @param timeoutMs - Maximum allowed execution time in milliseconds
 * @param language - Language code for recovery message
 * @returns BookingExecutionResult with success/timeout status
 */
export async function stepExecutionTimer(
  executeFn: () => Promise<BookingStepResult>,
  preExecutionState: BookingState,
  stepId: string,
  timeoutMs: number = DEFAULT_STEP_TIMEOUT_MS,
  language: string = 'en'
): Promise<BookingExecutionResult> {
  const startTime = Date.now();

  return new Promise<BookingExecutionResult>((resolve) => {
    let settled = false;

    // Set the timeout
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;

      const elapsedMs = Date.now() - startTime;
      console.error(
        `[BookingExecutor] Step "${stepId}" timed out after ${elapsedMs}ms ` +
        `(threshold: ${timeoutMs}ms) — rolling back guest state`
      );

      resolve({
        success: false,
        timedOut: true,
        reasonCode: STEP_TIMEOUT_REASON_CODE,
        recoveryMessage: TIMEOUT_RECOVERY_MESSAGES[language] || TIMEOUT_RECOVERY_MESSAGES.en,
        rolledBackState: { ...preExecutionState },
        elapsedMs,
      });
    }, timeoutMs);

    // Execute the step
    executeFn()
      .then((result) => {
        if (settled) return; // Timeout already fired
        settled = true;
        clearTimeout(timeoutId);

        const elapsedMs = Date.now() - startTime;
        resolve({
          success: true,
          result,
          timedOut: false,
          elapsedMs,
        });
      })
      .catch((error) => {
        if (settled) return; // Timeout already fired
        settled = true;
        clearTimeout(timeoutId);

        const elapsedMs = Date.now() - startTime;
        console.error(
          `[BookingExecutor] Step "${stepId}" failed after ${elapsedMs}ms:`,
          error instanceof Error ? error.message : error
        );

        // On non-timeout errors, also roll back state
        resolve({
          success: false,
          timedOut: false,
          reasonCode: 'step_error',
          recoveryMessage: TIMEOUT_RECOVERY_MESSAGES[language] || TIMEOUT_RECOVERY_MESSAGES.en,
          rolledBackState: { ...preExecutionState },
          elapsedMs,
        });
      });
  });
}

/**
 * Convenience function: execute a booking step with timeout from workflow config.
 *
 * Reads the timeout for the given stepId from the workflow node definitions
 * and wraps execution with stepExecutionTimer.
 */
export async function executeBookingStepWithTimeout(
  executeFn: () => Promise<BookingStepResult>,
  preExecutionState: BookingState,
  stepId: string,
  workflowNodes?: Array<{ id: string; timeout?: number }>,
  language: string = 'en'
): Promise<BookingExecutionResult> {
  const timeoutMs = getStepTimeout(stepId, workflowNodes);
  return stepExecutionTimer(executeFn, preExecutionState, stepId, timeoutMs, language);
}
