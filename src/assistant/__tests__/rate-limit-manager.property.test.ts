/**
 * Property-Based Tests for RateLimitManager
 *
 * Formal verification of exponential backoff invariants:
 * - Monotonic cooldown growth
 * - Bounded maximum delay
 * - Recovery after consecutive successes
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { RateLimitManager } from '../rate-limit-manager.js';

// Helper to create manager with controlled randomness for deterministic jitter
function createManager(config?: {
  baseDelayMs?: number;
  maxDelayMs?: number;
  resetSuccessCount?: number;
}) {
  return new RateLimitManager(config);
}

describe('RateLimitManager — Property-Based Tests', () => {

  // ─── P12: Monotonic Cooldown Growth ──────────────────────────────
  // Each consecutive recordRateLimit() call produces a cooldown that is
  // AT LEAST as long as the base exponential (ignoring jitter).
  // The exponential formula is: min(baseDelay * 2^(n-1), maxDelay)
  describe('P12: Cooldown grows exponentially (modulo jitter)', () => {
    it('should produce exponentially growing cooldowns', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 5000 }),    // baseDelayMs
          fc.integer({ min: 10000, max: 600000 }), // maxDelayMs
          fc.integer({ min: 2, max: 15 }),          // number of rate limits
          (baseDelayMs, maxDelayMs, numErrors) => {
            const manager = createManager({ baseDelayMs, maxDelayMs });
            const providerId = 'test-provider';

            const cooldowns: number[] = [];

            for (let i = 0; i < numErrors; i++) {
              manager.recordRateLimit(providerId);
              cooldowns.push(manager.getCooldownRemaining(providerId));
            }

            // The expected exponential value (without jitter) for error N is:
            // min(baseDelay * 2^(N-1), maxDelay)
            // With ±20% jitter, actual cooldown can be 80%-120% of exponential.
            // We verify: cooldown >= 80% of min(baseDelay * 2^(N-1), maxDelay)
            // Note: getCooldownRemaining returns remaining time from now,
            // but since we call it immediately after recordRateLimit, it equals the total delay.
            for (let i = 0; i < numErrors; i++) {
              const expectedBase = Math.min(baseDelayMs * Math.pow(2, i), maxDelayMs);
              const minExpected = expectedBase * 0.8; // 80% due to jitter

              // Cooldown must be at least 80% of expected (jitter can reduce by 20%)
              // Allow small floating point tolerance
              if (cooldowns[i] < minExpected - 1) return false;
            }

            return true;
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ─── P13: Recovery After Consecutive Successes ───────────────────
  // After `resetSuccessCount` consecutive successes, isInCooldown returns false
  // and error count is reset.
  describe('P13: Recovery after consecutive successes', () => {
    it('should exit cooldown after enough successes', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),  // resetSuccessCount
          fc.integer({ min: 1, max: 5 }),   // initial errors
          (resetSuccessCount, numErrors) => {
            const manager = createManager({
              baseDelayMs: 1,      // Tiny base so cooldown expires quickly
              maxDelayMs: 10,
              resetSuccessCount
            });
            const providerId = 'test-provider';

            // Record some rate limits
            for (let i = 0; i < numErrors; i++) {
              manager.recordRateLimit(providerId);
            }

            // Verify we have errors
            const stateAfterErrors = manager.getState(providerId);
            if (!stateAfterErrors || stateAfterErrors.errorCount !== numErrors) return false;

            // Record enough successes
            for (let i = 0; i < resetSuccessCount; i++) {
              manager.recordSuccess(providerId);
            }

            // Error count should be reset
            const stateAfterRecovery = manager.getState(providerId);
            if (!stateAfterRecovery) return false;

            return stateAfterRecovery.errorCount === 0 &&
                   stateAfterRecovery.cooldownUntil === 0;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should NOT reset before reaching success threshold', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 10 }),  // resetSuccessCount
          fc.integer({ min: 1, max: 5 }),   // initial errors
          (resetSuccessCount, numErrors) => {
            const manager = createManager({
              baseDelayMs: 1,
              maxDelayMs: 10,
              resetSuccessCount
            });
            const providerId = 'test-provider';

            // Record errors
            for (let i = 0; i < numErrors; i++) {
              manager.recordRateLimit(providerId);
            }

            // Record fewer successes than threshold
            for (let i = 0; i < resetSuccessCount - 1; i++) {
              manager.recordSuccess(providerId);
            }

            // Error count should still be present
            const state = manager.getState(providerId);
            if (!state) return false;

            return state.errorCount === numErrors;
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ─── P14: Bounded Maximum Delay ──────────────────────────────────
  // Cooldown never exceeds maxDelayMs * 1.2 (accounting for jitter)
  describe('P14: Cooldown never exceeds maxDelay (with jitter tolerance)', () => {
    it('should cap cooldown at maxDelay + 20% jitter', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 5000 }),     // baseDelayMs
          fc.integer({ min: 10000, max: 600000 }),  // maxDelayMs
          fc.integer({ min: 1, max: 50 }),           // number of errors
          (baseDelayMs, maxDelayMs, numErrors) => {
            const manager = createManager({ baseDelayMs, maxDelayMs });
            const providerId = 'test-provider';

            for (let i = 0; i < numErrors; i++) {
              manager.recordRateLimit(providerId);

              const remaining = manager.getCooldownRemaining(providerId);

              // With ±20% jitter, max possible is maxDelay * 1.2
              const absoluteMax = maxDelayMs * 1.2 + 1; // +1 for rounding

              if (remaining > absoluteMax) return false;
            }

            return true;
          }
        ),
        { numRuns: 300 }
      );
    });
  });

  // ─── P15: Success Without Prior Errors is No-Op ──────────────────
  // Calling recordSuccess on a provider with no prior errors should have
  // no effect (no state created).
  describe('P15: Success without prior errors is a no-op', () => {
    it('should not create state for unknown providers on success', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),  // number of successes
          (numSuccesses) => {
            const manager = createManager();
            const providerId = 'fresh-provider';

            for (let i = 0; i < numSuccesses; i++) {
              manager.recordSuccess(providerId);
            }

            // No state should exist
            return manager.getState(providerId) === null;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ─── P16: Interleaved Errors and Successes ───────────────────────
  // Success resets the success counter but not error counter (until threshold).
  // New errors after partial successes should reset the success streak.
  describe('P16: Error resets success streak', () => {
    it('should reset success streak on new error', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 10 }),  // resetSuccessCount
          fc.integer({ min: 1, max: 5 }),   // initial errors
          fc.integer({ min: 1, max: 9 }),   // partial successes (< threshold)
          (resetSuccessCount, numErrors, partialSuccesses) => {
            const actualPartial = Math.min(partialSuccesses, resetSuccessCount - 1);
            const manager = createManager({
              baseDelayMs: 1,
              maxDelayMs: 10,
              resetSuccessCount
            });
            const providerId = 'test-provider';

            // Record errors
            for (let i = 0; i < numErrors; i++) {
              manager.recordRateLimit(providerId);
            }

            // Record partial successes (not enough to reset)
            for (let i = 0; i < actualPartial; i++) {
              manager.recordSuccess(providerId);
            }

            // Record another error — should reset success streak
            manager.recordRateLimit(providerId);

            const state = manager.getState(providerId);
            if (!state) return false;

            // Error count should have incremented
            // Success count should be 0 (reset by the error)
            return state.successCount === 0 &&
                   state.errorCount === numErrors + 1;
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ─── P17: Lifetime Error Count is Monotonically Increasing ───────
  // totalErrors should only increase, never decrease, even after recovery.
  describe('P17: Lifetime error count is monotonic', () => {
    it('should never decrease totalErrors', () => {
      type Op = { type: 'error' } | { type: 'success' };
      const opArb: fc.Arbitrary<Op> = fc.oneof(
        fc.constant({ type: 'error' } as Op),
        fc.constant({ type: 'success' } as Op)
      );

      fc.assert(
        fc.property(
          fc.array(opArb, { minLength: 1, maxLength: 100 }),
          (ops) => {
            const manager = createManager({
              baseDelayMs: 1,
              maxDelayMs: 10,
              resetSuccessCount: 2
            });
            const providerId = 'test-provider';

            let prevTotalErrors = 0;

            for (const op of ops) {
              if (op.type === 'error') {
                manager.recordRateLimit(providerId);
              } else {
                manager.recordSuccess(providerId);
              }

              const state = manager.getState(providerId);
              if (state) {
                if (state.totalErrors < prevTotalErrors) return false;
                prevTotalErrors = state.totalErrors;
              }
            }

            return true;
          }
        ),
        { numRuns: 500 }
      );
    });
  });
});
