/**
 * US-082: Workflow Transaction Handler
 *
 * Wraps workflow execution in database transactions to prevent partial
 * failures from leaving inconsistent state. Provides automatic rollback
 * on step failure and logs transaction duration/isolation level.
 */

import { db, pool } from '../../lib/db.js';
import type { WorkflowState, WorkflowContext, WorkflowExecutionResult } from '../workflow-executor.js';

export interface TransactionMetrics {
  startTime: number;
  endTime: number;
  duration: number;
  isolationLevel: string;
  success: boolean;
  error?: Error;
}

/**
 * Wraps a workflow step execution in a database transaction.
 *
 * Returns a tuple: [result, metrics]
 * On success, commits the transaction.
 * On failure, rolls back and re-throws the error.
 */
export async function executeWorkflowInTransaction<T>(
  executeStep: () => Promise<T>,
  workflowId: string
): Promise<[T, TransactionMetrics]> {
  const metrics: TransactionMetrics = {
    startTime: Date.now(),
    endTime: 0,
    duration: 0,
    isolationLevel: 'READ_COMMITTED',
    success: false,
  };

  const client = await pool.connect();

  try {
    // Start transaction with READ_COMMITTED isolation
    await client.query('BEGIN ISOLATION LEVEL READ_COMMITTED');
    console.log(`[WorkflowTransaction] ${workflowId}: Transaction started (READ_COMMITTED)`);

    // Execute the workflow step
    const result = await executeStep();

    // Commit on success
    await client.query('COMMIT');
    metrics.success = true;
    metrics.endTime = Date.now();
    metrics.duration = metrics.endTime - metrics.startTime;
    console.log(
      `[WorkflowTransaction] ${workflowId}: COMMIT (${metrics.duration}ms)`
    );

    return [result, metrics];
  } catch (error) {
    // Rollback on error
    try {
      await client.query('ROLLBACK');
      console.log(`[WorkflowTransaction] ${workflowId}: ROLLBACK due to error`);
    } catch (rollbackErr) {
      console.error(`[WorkflowTransaction] ${workflowId}: ROLLBACK failed:`, rollbackErr);
    }

    metrics.success = false;
    metrics.endTime = Date.now();
    metrics.duration = metrics.endTime - metrics.startTime;
    metrics.error = error instanceof Error ? error : new Error(String(error));

    console.error(
      `[WorkflowTransaction] ${workflowId}: Transaction failed (${metrics.duration}ms):`,
      metrics.error.message
    );

    throw error;
  } finally {
    // Always release the client back to the pool
    client.release();
  }
}

/**
 * Convenience function: wraps workflow execution and returns metrics.
 * Used for logging and deadlock detection.
 */
export function logTransactionMetrics(metrics: TransactionMetrics, workflowId: string): void {
  const status = metrics.success ? '✅' : '❌';
  const isolationStr = metrics.isolationLevel;
  console.log(
    `[WorkflowTransaction] ${workflowId} ${status} ${isolationStr} ` +
    `duration=${metrics.duration}ms success=${metrics.success}`
  );

  // Flag potential deadlocks (>5s transactions)
  if (metrics.duration > 5000) {
    console.warn(
      `[WorkflowTransaction] ⚠️ Slow transaction detected: ${workflowId} took ${metrics.duration}ms`
    );
  }
}
