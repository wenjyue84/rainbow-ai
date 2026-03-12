/**
 * Property-Based Tests for CircuitBreaker
 *
 * Formal verification of state transition invariants using fast-check.
 * These tests generate thousands of random command sequences and verify
 * that the circuit breaker always satisfies its safety/liveness properties.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { CircuitBreaker, CircuitState } from '../circuit-breaker.js';

// ─── Command Model ──────────────────────────────────────────────────
// We model interactions as a sequence of commands that can be applied
// to the circuit breaker. This is the "model-based testing" pattern.

type Command =
  | { type: 'success' }
  | { type: 'failure' }
  | { type: 'advance'; ms: number }
  | { type: 'checkOpen' };

const commandArb: fc.Arbitrary<Command> = fc.oneof(
  fc.constant({ type: 'success' } as Command),
  fc.constant({ type: 'failure' } as Command),
  fc.nat({ max: 200_000 }).map(ms => ({ type: 'advance', ms }) as Command),
  fc.constant({ type: 'checkOpen' } as Command)
);

// Helper: simulate time advancement by mocking Date.now
function createTimedCircuitBreaker(
  config?: { failureThreshold?: number; cooldownMs?: number; successThreshold?: number }
) {
  let currentTime = 1000000; // Start at a non-zero time
  const originalDateNow = Date.now;

  // Override Date.now for this test
  Date.now = () => currentTime;

  const cb = new CircuitBreaker('test-provider', config);

  return {
    cb,
    advanceTime: (ms: number) => { currentTime += ms; },
    getTime: () => currentTime,
    restore: () => { Date.now = originalDateNow; }
  };
}

describe('CircuitBreaker — Property-Based Tests', () => {

  // ─── P1: State Transition Safety ─────────────────────────────────
  // The circuit never skips states. CLOSED → HALF_OPEN is illegal.
  // Valid transitions: CLOSED→OPEN, OPEN→HALF_OPEN, HALF_OPEN→CLOSED, HALF_OPEN→OPEN
  describe('P1: No illegal state transitions', () => {
    it('should never transition from CLOSED directly to HALF_OPEN', () => {
      fc.assert(
        fc.property(
          fc.array(commandArb, { minLength: 1, maxLength: 200 }),
          (commands) => {
            const { cb, advanceTime, restore } = createTimedCircuitBreaker({
              failureThreshold: 3,
              cooldownMs: 60000,
              successThreshold: 1
            });

            try {
              let prevState = cb.getStatus().state;

              for (const cmd of commands) {
                switch (cmd.type) {
                  case 'success': cb.recordSuccess(); break;
                  case 'failure': cb.recordFailure(); break;
                  case 'advance': advanceTime(cmd.ms); break;
                  case 'checkOpen': cb.isOpen(); break;
                }

                const currentState = cb.getStatus().state;

                // CLOSED → HALF_OPEN is an illegal transition
                if (prevState === CircuitState.CLOSED && currentState === CircuitState.HALF_OPEN) {
                  return false; // Property violated
                }

                prevState = currentState;
              }

              return true;
            } finally {
              restore();
            }
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  // ─── P2: Threshold Exactness ─────────────────────────────────────
  // Exactly `failureThreshold` consecutive failures open the circuit.
  // Fewer failures should keep it CLOSED.
  describe('P2: Exact failure threshold', () => {
    it('should remain CLOSED with fewer than threshold failures', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),  // failureThreshold
          (threshold) => {
            const { cb, restore } = createTimedCircuitBreaker({
              failureThreshold: threshold,
              cooldownMs: 60000
            });

            try {
              // Record threshold-1 failures
              for (let i = 0; i < threshold - 1; i++) {
                cb.recordFailure();
              }

              return cb.getStatus().state === CircuitState.CLOSED;
            } finally {
              restore();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should open at exactly threshold failures', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),  // failureThreshold
          (threshold) => {
            const { cb, restore } = createTimedCircuitBreaker({
              failureThreshold: threshold,
              cooldownMs: 60000
            });

            try {
              for (let i = 0; i < threshold; i++) {
                cb.recordFailure();
              }

              return cb.getStatus().state === CircuitState.OPEN;
            } finally {
              restore();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ─── P3: Liveness — Cooldown Recovery ────────────────────────────
  // After enough time passes, the circuit must eventually allow a test request.
  describe('P3: Liveness — cooldown always recovers', () => {
    it('should enter HALF_OPEN after cooldown elapses', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 300000 }),  // cooldownMs
          (cooldownMs) => {
            const { cb, advanceTime, restore } = createTimedCircuitBreaker({
              failureThreshold: 3,
              cooldownMs
            });

            try {
              // Open the circuit
              cb.recordFailure();
              cb.recordFailure();
              cb.recordFailure();
              expect(cb.getStatus().state).toBe(CircuitState.OPEN);

              // Advance past cooldown
              advanceTime(cooldownMs + 1);

              // isOpen() should trigger transition to HALF_OPEN
              const isStillOpen = cb.isOpen();

              return !isStillOpen && cb.getStatus().state === CircuitState.HALF_OPEN;
            } finally {
              restore();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should remain OPEN before cooldown elapses', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2000, max: 300000 }),  // cooldownMs (min 2s to leave room)
          fc.integer({ min: 0, max: 99 }),          // percentage of cooldown elapsed
          (cooldownMs, pct) => {
            const { cb, advanceTime, restore } = createTimedCircuitBreaker({
              failureThreshold: 3,
              cooldownMs
            });

            try {
              // Open the circuit
              cb.recordFailure();
              cb.recordFailure();
              cb.recordFailure();

              // Advance less than cooldown
              const elapsed = Math.floor(cooldownMs * pct / 100);
              advanceTime(elapsed);

              return cb.isOpen() === true;
            } finally {
              restore();
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ─── P4: Success Idempotency ─────────────────────────────────────
  // recordSuccess() when CLOSED should be a no-op (state stays CLOSED,
  // failure count stays 0)
  describe('P4: Success in CLOSED is idempotent', () => {
    it('should not change state when calling recordSuccess in CLOSED', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),  // number of successes
          (numSuccesses) => {
            const { cb, restore } = createTimedCircuitBreaker();

            try {
              for (let i = 0; i < numSuccesses; i++) {
                cb.recordSuccess();
              }

              const status = cb.getStatus();
              return status.state === CircuitState.CLOSED && status.failureCount === 0;
            } finally {
              restore();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ─── P5: Success Resets Failure Count ────────────────────────────
  // A success while CLOSED should reset the failure count to 0,
  // preventing partial failure accumulation across separate incidents.
  describe('P5: Success resets failure count in CLOSED', () => {
    it('should reset failure count when success occurs before threshold', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 10 }),  // threshold
          fc.integer({ min: 1, max: 9 }),   // failures before success (< threshold)
          (threshold, failuresBefore) => {
            // Ensure failures < threshold
            const actualFailures = Math.min(failuresBefore, threshold - 1);
            const { cb, restore } = createTimedCircuitBreaker({
              failureThreshold: threshold,
              cooldownMs: 60000
            });

            try {
              // Record some failures (not enough to open)
              for (let i = 0; i < actualFailures; i++) {
                cb.recordFailure();
              }

              // Record a success — should reset failure count
              cb.recordSuccess();

              // Now record threshold-1 more failures — should still be CLOSED
              // because the count was reset
              for (let i = 0; i < threshold - 1; i++) {
                cb.recordFailure();
              }

              return cb.getStatus().state === CircuitState.CLOSED;
            } finally {
              restore();
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ─── P6: HALF_OPEN Recovery ──────────────────────────────────────
  // In HALF_OPEN: success → CLOSED, failure → OPEN
  describe('P6: HALF_OPEN transitions are deterministic', () => {
    it('should close on success in HALF_OPEN', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 300000 }),  // cooldownMs
          (cooldownMs) => {
            const { cb, advanceTime, restore } = createTimedCircuitBreaker({
              failureThreshold: 3,
              cooldownMs,
              successThreshold: 1
            });

            try {
              // Open circuit
              cb.recordFailure();
              cb.recordFailure();
              cb.recordFailure();

              // Wait for cooldown → HALF_OPEN
              advanceTime(cooldownMs + 1);
              cb.isOpen(); // triggers transition

              expect(cb.getStatus().state).toBe(CircuitState.HALF_OPEN);

              // Record success → should close
              cb.recordSuccess();

              return cb.getStatus().state === CircuitState.CLOSED &&
                     cb.getStatus().failureCount === 0;
            } finally {
              restore();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reopen on failure in HALF_OPEN', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 300000 }),  // cooldownMs
          (cooldownMs) => {
            const { cb, advanceTime, restore } = createTimedCircuitBreaker({
              failureThreshold: 3,
              cooldownMs,
              successThreshold: 1
            });

            try {
              // Open circuit
              cb.recordFailure();
              cb.recordFailure();
              cb.recordFailure();

              // Wait for cooldown → HALF_OPEN
              advanceTime(cooldownMs + 1);
              cb.isOpen();

              expect(cb.getStatus().state).toBe(CircuitState.HALF_OPEN);

              // Record failure → should reopen
              cb.recordFailure();

              return cb.getStatus().state === CircuitState.OPEN;
            } finally {
              restore();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ─── P7: Full Lifecycle Invariant ────────────────────────────────
  // Under any sequence of operations, the state is always one of
  // {CLOSED, OPEN, HALF_OPEN} and failureCount is non-negative.
  describe('P7: State space invariant under arbitrary commands', () => {
    it('should always be in a valid state with non-negative counters', () => {
      fc.assert(
        fc.property(
          fc.array(commandArb, { minLength: 1, maxLength: 500 }),
          fc.integer({ min: 1, max: 10 }),  // failureThreshold
          fc.integer({ min: 1000, max: 300000 }),  // cooldownMs
          (commands, threshold, cooldownMs) => {
            const { cb, advanceTime, restore } = createTimedCircuitBreaker({
              failureThreshold: threshold,
              cooldownMs,
              successThreshold: 1
            });

            try {
              for (const cmd of commands) {
                switch (cmd.type) {
                  case 'success': cb.recordSuccess(); break;
                  case 'failure': cb.recordFailure(); break;
                  case 'advance': advanceTime(cmd.ms); break;
                  case 'checkOpen': cb.isOpen(); break;
                }

                const status = cb.getStatus();

                // Invariant 1: State is always valid
                const validStates = [CircuitState.CLOSED, CircuitState.OPEN, CircuitState.HALF_OPEN];
                if (!validStates.includes(status.state)) return false;

                // Invariant 2: Failure count is non-negative
                if (status.failureCount < 0) return false;

                // Invariant 3: Success count is non-negative
                if (status.successCount < 0) return false;

                // Invariant 4: Cooldown remaining is non-negative
                if (status.cooldownRemaining < 0) return false;

                // Invariant 5: Cooldown only > 0 when OPEN
                if (status.state !== CircuitState.OPEN && status.cooldownRemaining > 0) return false;
              }

              return true;
            } finally {
              restore();
            }
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  // ─── P8: OPEN → OPEN on additional failures ─────────────────────
  // Once OPEN, additional failures should keep it OPEN (not change state)
  describe('P8: Additional failures while OPEN stay OPEN', () => {
    it('should remain OPEN when recording failures in OPEN state', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),  // additional failures
          (extraFailures) => {
            const { cb, restore } = createTimedCircuitBreaker({
              failureThreshold: 3,
              cooldownMs: 60000
            });

            try {
              // Open the circuit
              cb.recordFailure();
              cb.recordFailure();
              cb.recordFailure();

              // Record more failures — should stay OPEN
              for (let i = 0; i < extraFailures; i++) {
                cb.recordFailure();
              }

              return cb.getStatus().state === CircuitState.OPEN;
            } finally {
              restore();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
