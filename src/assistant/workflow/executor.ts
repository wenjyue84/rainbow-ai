/**
 * Booking Workflow Step Execution Trace Logger (US-309)
 *
 * Transparent wrapper that times each workflow step, captures input/output/error,
 * and fire-and-forgets a trace record to the database for post-mortem analysis.
 */

import { db, dbReady } from '../../lib/db.js';
import { bookingWorkflowTraces } from '../../../shared/schema-tables.js';

export interface WorkflowStepContext {
  bookingId?: string;
  [key: string]: unknown;
}

/**
 * Execute a workflow step function while recording a trace.
 * The trace is written asynchronously (fire-and-forget) so it never
 * blocks or fails the actual step execution.
 */
export async function executeWorkflowStepWithTrace<T>(
  stepName: string,
  context: WorkflowStepContext,
  fn: () => Promise<T>,
): Promise<T> {
  const bookingId = context.bookingId || 'unknown';
  const inputSnapshot = safeJsonClone(context);
  const start = Date.now();
  let output: T;
  let errorMsg: string | undefined;

  try {
    output = await fn();
  } catch (err: any) {
    errorMsg = err?.message || String(err);
    const durationMs = Date.now() - start;
    saveTrace(bookingId, stepName, inputSnapshot, null, errorMsg, durationMs);
    throw err; // re-throw so the caller still sees the error
  }

  const durationMs = Date.now() - start;
  saveTrace(bookingId, stepName, inputSnapshot, safeJsonClone(output), undefined, durationMs);
  return output;
}

/** Fire-and-forget trace insert — never throws. */
function saveTrace(
  bookingId: string,
  stepName: string,
  inputJson: unknown,
  outputJson: unknown,
  errorMsg: string | undefined,
  durationMs: number,
): void {
  dbReady.then((ok) => {
    if (!ok) return;
    db.insert(bookingWorkflowTraces)
      .values({ bookingId, stepName, inputJson, outputJson, errorMsg, durationMs })
      .execute()
      .catch((e) => console.error('[workflow-trace] DB write failed:', e.message));
  });
}

/** Safely clone a value to a JSON-safe object; returns null on failure. */
function safeJsonClone(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
}
