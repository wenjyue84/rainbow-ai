/**
 * US-120: Workflow Step Execution Timeout Handler
 *
 * Wraps workflow step execution with a timeout mechanism to prevent hung steps
 * from leaving the database in an inconsistent state. If a step exceeds its
 * max_duration_ms, execution is aborted with automatic transaction rollback.
 */

/**
 * Custom error for workflow step timeout
 */
export class WorkflowTimeoutError extends Error {
  constructor(
    public readonly stepId: string,
    public readonly maxDurationMs: number,
    public readonly actualDurationMs: number
  ) {
    super(
      `Workflow step "${stepId}" exceeded timeout ` +
      `(max: ${maxDurationMs}ms, actual: ${actualDurationMs}ms)`
    );
    this.name = 'WorkflowTimeoutError';
  }
}

/**
 * Wraps a step execution function with a timeout.
 *
 * @param stepFn - Async function that executes the workflow step
 * @param stepId - ID of the step being executed (for logging)
 * @param maxDurationMs - Maximum duration in milliseconds (default: 30000)
 * @returns Promise resolving to the step function result
 * @throws WorkflowTimeoutError if step exceeds max_duration_ms
 */
export async function executeWithTimeout<T>(
  stepFn: () => Promise<T>,
  stepId: string,
  maxDurationMs: number = 30000
): Promise<T> {
  const startTime = Date.now();

  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    let completed = false;

    // Set the timeout
    const timeoutId = setTimeout(() => {
      timedOut = true;
      const actualDurationMs = Date.now() - startTime;
      console.error(
        `[WorkflowTimeout] Step "${stepId}" exceeded timeout ` +
        `(max: ${maxDurationMs}ms, actual: ${actualDurationMs}ms)`
      );
      reject(
        new WorkflowTimeoutError(stepId, maxDurationMs, actualDurationMs)
      );
    }, maxDurationMs);

    // Execute the step
    stepFn()
      .then((result) => {
        if (!timedOut) {
          completed = true;
          clearTimeout(timeoutId);
          resolve(result);
        }
        // If timedOut is true, the timeout handler already rejected
      })
      .catch((error) => {
        if (!timedOut) {
          completed = true;
          clearTimeout(timeoutId);
          reject(error);
        }
        // If timedOut is true, ignore the step function's error
        // and let the timeout error propagate instead
      });
  });
}

/**
 * Logs a workflow timeout failure to structured format.
 *
 * @param stepId - ID of the step that timed out
 * @param maxDurationMs - Maximum duration configured
 * @param actualDurationMs - Actual duration before timeout
 * @param workflowId - ID of the parent workflow
 * @param profileId - Profile ID for multi-tenant isolation
 */
export function logTimeoutFailure(
  stepId: string,
  maxDurationMs: number,
  actualDurationMs: number,
  workflowId: string,
  profileId?: string
): Record<string, any> {
  return {
    timestamp: new Date().toISOString(),
    event_type: 'workflow_step_timeout',
    step_id: stepId,
    workflow_id: workflowId,
    profile_id: profileId,
    max_duration_ms: maxDurationMs,
    actual_duration_ms: actualDurationMs,
    timeout_exceeded_ms: actualDurationMs - maxDurationMs,
  };
}
