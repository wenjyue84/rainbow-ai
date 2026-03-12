/**
 * Runtime Invariant Monitoring
 *
 * Lightweight assertion system for production invariants.
 * - In development: throws an error (fail fast)
 * - In production: logs warning + notifies admin (graceful degradation)
 *
 * Usage:
 *   invariant(count >= 0, 'count must be non-negative', { count });
 */

const isDev = process.env.NODE_ENV !== 'production';

export interface InvariantViolation {
  message: string;
  context?: Record<string, unknown>;
  timestamp: number;
  stack?: string;
}

// In-memory ring buffer of recent violations (for admin dashboard)
const recentViolations: InvariantViolation[] = [];
const MAX_VIOLATIONS = 50;

/**
 * Assert a runtime invariant.
 *
 * @param condition - The condition that must be true
 * @param message - Description of the invariant being checked
 * @param context - Optional context data for debugging
 */
export function invariant(
  condition: boolean,
  message: string,
  context?: Record<string, unknown>
): asserts condition {
  if (condition) return;

  const violation: InvariantViolation = {
    message: `Invariant violation: ${message}`,
    context,
    timestamp: Date.now(),
    stack: new Error().stack,
  };

  // Store in ring buffer
  recentViolations.push(violation);
  if (recentViolations.length > MAX_VIOLATIONS) {
    recentViolations.shift();
  }

  if (isDev) {
    // Fail fast in development
    const err = new Error(violation.message);
    console.error('[INVARIANT]', violation.message, context);
    throw err;
  } else {
    // Log warning in production — don't crash
    console.warn('[INVARIANT]', violation.message, context);
    // Try to notify admin asynchronously (fire-and-forget)
    notifyAdminAsync(violation).catch(() => {});
  }
}

/**
 * Soft invariant — logs but never throws, even in dev.
 * Use for invariants that indicate data inconsistency but shouldn't halt processing.
 */
export function softInvariant(
  condition: boolean,
  message: string,
  context?: Record<string, unknown>
): boolean {
  if (condition) return true;

  const violation: InvariantViolation = {
    message: `Soft invariant violation: ${message}`,
    context,
    timestamp: Date.now(),
  };

  recentViolations.push(violation);
  if (recentViolations.length > MAX_VIOLATIONS) {
    recentViolations.shift();
  }

  console.warn('[INVARIANT:soft]', violation.message, context);
  return false;
}

/**
 * Get recent violations for admin dashboard.
 */
export function getRecentViolations(): readonly InvariantViolation[] {
  return recentViolations;
}

/**
 * Clear violations (for testing or after admin review).
 */
export function clearViolations(): void {
  recentViolations.length = 0;
}

async function notifyAdminAsync(violation: InvariantViolation): Promise<void> {
  try {
    const { notifyAdminConfigError } = await import('../lib/admin-notifier.js');
    const contextStr = violation.context ? `\nContext: ${JSON.stringify(violation.context)}` : '';
    notifyAdminConfigError(`${violation.message}${contextStr}`);
  } catch {
    // Admin notifier not available — silently ignore
  }
}
