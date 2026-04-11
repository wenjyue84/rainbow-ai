/**
 * step-failure-tracker.ts — US-489
 *
 * Tracks consecutive failures per workflow step in a conversation.
 * Triggers handoff generation when 3 consecutive failures are detected
 * for the same step.
 */

export interface StepFailureRecord {
  conversationId: string;
  stepName: string;
  consecutiveCount: number;
  lastFailureTime: number;
  errors: string[];
}

/**
 * In-memory failure tracker. In production, this would use a database
 * or distributed cache (Redis) for persistence across server instances.
 */
const failureRecords = new Map<string, StepFailureRecord>();

/**
 * Get the key for tracking a step's failures in a conversation.
 */
function getFailureKey(conversationId: string, stepName: string): string {
  return `${conversationId}:${stepName}`;
}

/**
 * Record a step failure and return the count.
 * Resets counter if the step changes or too much time passes.
 */
export function recordStepFailure(
  conversationId: string,
  stepName: string,
  error: string
): number {
  const key = getFailureKey(conversationId, stepName);
  const now = Date.now();
  const RESET_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  let record = failureRecords.get(key);

  if (!record) {
    // First failure for this step
    record = {
      conversationId,
      stepName,
      consecutiveCount: 1,
      lastFailureTime: now,
      errors: [error],
    };
  } else if (now - record.lastFailureTime > RESET_TIMEOUT_MS) {
    // Reset if too much time passed between failures
    record = {
      conversationId,
      stepName,
      consecutiveCount: 1,
      lastFailureTime: now,
      errors: [error],
    };
  } else {
    // Increment consecutive count
    record.consecutiveCount += 1;
    record.lastFailureTime = now;
    record.errors.push(error);
    // Keep only last 5 errors for handoff context
    if (record.errors.length > 5) {
      record.errors = record.errors.slice(-5);
    }
  }

  failureRecords.set(key, record);
  return record.consecutiveCount;
}

/**
 * Check if a step has reached 3 consecutive failures.
 */
export function hasReachedFailureThreshold(
  conversationId: string,
  stepName: string
): boolean {
  const key = getFailureKey(conversationId, stepName);
  const record = failureRecords.get(key);
  return record ? record.consecutiveCount >= 3 : false;
}

/**
 * Get the failure record for a step (includes all error messages).
 */
export function getFailureRecord(
  conversationId: string,
  stepName: string
): StepFailureRecord | null {
  const key = getFailureKey(conversationId, stepName);
  return failureRecords.get(key) || null;
}

/**
 * Reset the failure counter for a step (call after successful retry).
 */
export function resetStepFailures(
  conversationId: string,
  stepName: string
): void {
  const key = getFailureKey(conversationId, stepName);
  failureRecords.delete(key);
}

/**
 * Clear all failure records for a conversation (call when conversation ends).
 */
export function clearConversationFailures(conversationId: string): void {
  for (const key of failureRecords.keys()) {
    if (key.startsWith(`${conversationId}:`)) {
      failureRecords.delete(key);
    }
  }
}

/**
 * Get all failure records for a conversation (for debugging).
 */
export function getConversationFailures(
  conversationId: string
): StepFailureRecord[] {
  const results: StepFailureRecord[] = [];
  for (const record of failureRecords.values()) {
    if (record.conversationId === conversationId) {
      results.push(record);
    }
  }
  return results;
}

/**
 * Get combined error stack as a string for handoff documents.
 */
export function getErrorStack(
  conversationId: string,
  stepName: string
): string {
  const record = getFailureRecord(conversationId, stepName);
  if (!record) return '';

  return record.errors.join('\n---\n');
}

/**
 * Clear all records (for testing or reset).
 */
export function clearAllRecords(): void {
  failureRecords.clear();
}
