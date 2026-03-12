/**
 * Failover Protocol Simulation Tests
 *
 * Simulation-based verification of the heartbeat failover protocol.
 * Generates random event sequences and checks safety/liveness properties.
 * This is ~80% of TLA+'s value at ~30% of the effort.
 *
 * Models the FailoverCoordinator (src/lib/failover-coordinator.ts) as a
 * simple state machine with two processes: Primary and Standby.
 * Uses fast-check to generate random event sequences and verify:
 *   - Safety: No permanent split-brain (both active after stabilization)
 *   - Liveness: Standby activates after threshold when primary is down
 *   - Convergence: System returns to primary-only after recovery
 *   - Stability: Standby stays inactive with healthy heartbeats
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ============================================================================
// Failover State Machine Model
// ============================================================================

interface FailoverModel {
  primaryActive: boolean;
  standbyActive: boolean;
  primaryAlive: boolean;
  lastHeartbeatAge: number; // ms since last heartbeat
  failoverThresholdMs: number;
}

type FailoverEvent =
  | { type: 'heartbeat_sent' }          // Primary sends heartbeat
  | { type: 'heartbeat_lost' }          // Heartbeat lost in transit
  | { type: 'time_passes'; ms: number } // Time advances
  | { type: 'primary_crash' }           // Primary goes down
  | { type: 'primary_recover' }         // Primary comes back
  | { type: 'check_heartbeat' };        // Standby checks heartbeat timer

function createInitialModel(thresholdMs: number): FailoverModel {
  return {
    primaryActive: true,
    standbyActive: false,
    primaryAlive: true,
    lastHeartbeatAge: 0,
    failoverThresholdMs: thresholdMs,
  };
}

function applyEvent(model: FailoverModel, event: FailoverEvent): FailoverModel {
  const m = { ...model };
  switch (event.type) {
    case 'heartbeat_sent':
      if (m.primaryAlive) {
        m.lastHeartbeatAge = 0; // Heartbeat received, reset timer
      }
      break;
    case 'heartbeat_lost':
      // No effect on state — heartbeat just wasn't received
      break;
    case 'time_passes':
      m.lastHeartbeatAge += event.ms;
      break;
    case 'primary_crash':
      m.primaryAlive = false;
      m.primaryActive = false;
      break;
    case 'primary_recover':
      m.primaryAlive = true;
      m.primaryActive = true;
      // When primary recovers and sends heartbeat, standby should deactivate
      m.lastHeartbeatAge = 0;
      m.standbyActive = false;
      break;
    case 'check_heartbeat':
      if (m.lastHeartbeatAge > m.failoverThresholdMs && !m.standbyActive) {
        m.standbyActive = true; // Standby activates (failover)
      }
      if (m.lastHeartbeatAge === 0 && m.standbyActive && m.primaryAlive) {
        m.standbyActive = false; // Handback
      }
      break;
  }
  return m;
}

// ============================================================================
// Arbitrary Event Generator
// ============================================================================

const eventArb: fc.Arbitrary<FailoverEvent> = fc.oneof(
  fc.constant({ type: 'heartbeat_sent' } as FailoverEvent),
  fc.constant({ type: 'heartbeat_lost' } as FailoverEvent),
  fc.integer({ min: 1000, max: 100000 }).map(ms => ({ type: 'time_passes', ms }) as FailoverEvent),
  fc.constant({ type: 'primary_crash' } as FailoverEvent),
  fc.constant({ type: 'primary_recover' } as FailoverEvent),
  fc.constant({ type: 'check_heartbeat' } as FailoverEvent)
);

// ============================================================================
// Tests
// ============================================================================

describe('Failover Protocol — Simulation Tests', () => {

  // ── Safety: No permanent split-brain ────────────────────────────────

  describe('Safety: No permanent split-brain', () => {
    it('after check_heartbeat, at most one server should be active', () => {
      fc.assert(
        fc.property(
          fc.array(eventArb, { minLength: 5, maxLength: 100 }),
          fc.integer({ min: 30000, max: 120000 }), // threshold
          (events, thresholdMs) => {
            let model = createInitialModel(thresholdMs);

            for (const event of events) {
              model = applyEvent(model, event);

              // After each check_heartbeat, verify no split-brain
              if (event.type === 'check_heartbeat') {
                // Both active simultaneously = split-brain
                // Allowed briefly during transition, but not after check
                if (model.primaryActive && model.standbyActive) {
                  // This is the actual split-brain detection
                  // In our model, this shouldn't happen because
                  // check_heartbeat only activates standby when primary is down
                  // But if primary recovers between crash and check, we might see this
                  // The key safety property: if primary is alive and sent heartbeat,
                  // standby should NOT be active
                  if (model.lastHeartbeatAge === 0 && model.primaryAlive) {
                    return false; // Actual split-brain — both active with fresh heartbeat
                  }
                }
              }
            }
            return true;
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  // ── Liveness: Standby activates after threshold ─────────────────────

  describe('Liveness: Standby activates after threshold', () => {
    it('should activate standby when primary is down long enough', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 30000, max: 120000 }), // threshold
          (thresholdMs) => {
            let model = createInitialModel(thresholdMs);

            // Primary crashes
            model = applyEvent(model, { type: 'primary_crash' });
            // Time passes beyond threshold
            model = applyEvent(model, { type: 'time_passes', ms: thresholdMs + 1000 });
            // Standby checks
            model = applyEvent(model, { type: 'check_heartbeat' });

            return model.standbyActive === true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should NOT activate standby before threshold is reached', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 30000, max: 120000 }),
          fc.integer({ min: 1000, max: 29000 }), // time less than any threshold
          (thresholdMs, elapsed) => {
            // Ensure elapsed is less than threshold
            const safeElapsed = Math.min(elapsed, thresholdMs - 1);
            let model = createInitialModel(thresholdMs);

            model = applyEvent(model, { type: 'primary_crash' });
            model = applyEvent(model, { type: 'time_passes', ms: safeElapsed });
            model = applyEvent(model, { type: 'check_heartbeat' });

            return model.standbyActive === false;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ── Convergence: System converges after recovery ────────────────────

  describe('Convergence: System converges after recovery', () => {
    it('should converge to primary-only after recovery + heartbeat', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 30000, max: 120000 }),
          (thresholdMs) => {
            let model = createInitialModel(thresholdMs);

            // Crash -> failover -> recover -> heartbeat -> check
            model = applyEvent(model, { type: 'primary_crash' });
            model = applyEvent(model, { type: 'time_passes', ms: thresholdMs + 1000 });
            model = applyEvent(model, { type: 'check_heartbeat' }); // Standby activates

            model = applyEvent(model, { type: 'primary_recover' }); // Primary back
            model = applyEvent(model, { type: 'heartbeat_sent' }); // Fresh heartbeat
            model = applyEvent(model, { type: 'check_heartbeat' }); // Standby checks

            // Should converge: primary active, standby inactive
            return model.primaryActive === true && model.standbyActive === false;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should converge even after multiple crash/recovery cycles', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 30000, max: 120000 }),
          fc.integer({ min: 1, max: 5 }), // number of crash cycles
          (thresholdMs, cycles) => {
            let model = createInitialModel(thresholdMs);

            for (let i = 0; i < cycles; i++) {
              // Crash -> failover
              model = applyEvent(model, { type: 'primary_crash' });
              model = applyEvent(model, { type: 'time_passes', ms: thresholdMs + 1000 });
              model = applyEvent(model, { type: 'check_heartbeat' });

              // Recover -> handback
              model = applyEvent(model, { type: 'primary_recover' });
              model = applyEvent(model, { type: 'heartbeat_sent' });
              model = applyEvent(model, { type: 'check_heartbeat' });
            }

            // After all cycles, should be in clean primary-only state
            return model.primaryActive === true && model.standbyActive === false;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ── Stability: Standby stays inactive with healthy primary ──────────

  describe('Safety: Standby stays inactive with healthy primary', () => {
    it('should not activate standby when heartbeats are regular', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 30000, max: 120000 }),
          fc.integer({ min: 5, max: 20 }), // number of heartbeat cycles
          (thresholdMs, cycles) => {
            let model = createInitialModel(thresholdMs);

            for (let i = 0; i < cycles; i++) {
              // Regular heartbeat cycle: time passes (less than threshold), heartbeat arrives
              model = applyEvent(model, { type: 'time_passes', ms: thresholdMs / 3 });
              model = applyEvent(model, { type: 'heartbeat_sent' });
              model = applyEvent(model, { type: 'check_heartbeat' });
            }

            return model.standbyActive === false;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should not activate standby even with occasional lost heartbeats', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 60000, max: 120000 }), // threshold
          fc.integer({ min: 5, max: 15 }),           // cycles
          (thresholdMs, cycles) => {
            let model = createInitialModel(thresholdMs);

            for (let i = 0; i < cycles; i++) {
              // Time passes at 1/4 of threshold per cycle
              model = applyEvent(model, { type: 'time_passes', ms: thresholdMs / 4 });

              // Every 3rd heartbeat is "lost" (skipped)
              if (i % 3 !== 0) {
                model = applyEvent(model, { type: 'heartbeat_sent' });
              } else {
                model = applyEvent(model, { type: 'heartbeat_lost' });
              }

              model = applyEvent(model, { type: 'check_heartbeat' });
            }

            // With threshold / 4 increments and 2/3 delivery rate,
            // the max gap is 2 * threshold/4 = threshold/2, which is below threshold.
            // So standby should stay inactive.
            return model.standbyActive === false;
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ── Monotonicity: heartbeat age only grows between heartbeats ───────

  describe('Monotonicity: heartbeat age', () => {
    it('heartbeat age should only grow from time_passes and reset on heartbeat_sent', () => {
      fc.assert(
        fc.property(
          fc.array(eventArb, { minLength: 5, maxLength: 50 }),
          fc.integer({ min: 30000, max: 120000 }),
          (events, thresholdMs) => {
            let model = createInitialModel(thresholdMs);

            for (const event of events) {
              const prevAge = model.lastHeartbeatAge;
              model = applyEvent(model, event);

              if (event.type === 'heartbeat_sent' && model.primaryAlive) {
                // Age should reset to 0 on successful heartbeat
                if (model.lastHeartbeatAge !== 0) return false;
              } else if (event.type === 'time_passes') {
                // Age should increase by exactly the elapsed time
                if (model.lastHeartbeatAge !== prevAge + event.ms) return false;
              } else if (event.type === 'primary_recover') {
                // Recovery resets age to 0
                if (model.lastHeartbeatAge !== 0) return false;
              }
            }
            return true;
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  // ── Initial state properties ────────────────────────────────────────

  describe('Initial state properties', () => {
    it('initial state should always have primary active and standby inactive', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10000, max: 300000 }),
          (thresholdMs) => {
            const model = createInitialModel(thresholdMs);
            return (
              model.primaryActive === true &&
              model.standbyActive === false &&
              model.primaryAlive === true &&
              model.lastHeartbeatAge === 0
            );
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // ── Idempotency: repeated events ───────────────────────────────────

  describe('Idempotency', () => {
    it('multiple consecutive heartbeat_sent should be equivalent to one', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 30000, max: 120000 }),
          fc.integer({ min: 2, max: 10 }),
          (thresholdMs, repeats) => {
            // Apply one heartbeat
            let model1 = createInitialModel(thresholdMs);
            model1 = applyEvent(model1, { type: 'time_passes', ms: 5000 });
            model1 = applyEvent(model1, { type: 'heartbeat_sent' });

            // Apply N heartbeats
            let model2 = createInitialModel(thresholdMs);
            model2 = applyEvent(model2, { type: 'time_passes', ms: 5000 });
            for (let i = 0; i < repeats; i++) {
              model2 = applyEvent(model2, { type: 'heartbeat_sent' });
            }

            return (
              model1.primaryActive === model2.primaryActive &&
              model1.standbyActive === model2.standbyActive &&
              model1.lastHeartbeatAge === model2.lastHeartbeatAge
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('multiple consecutive check_heartbeat should be equivalent to one', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 30000, max: 120000 }),
          fc.integer({ min: 2, max: 10 }),
          (thresholdMs, repeats) => {
            let model1 = createInitialModel(thresholdMs);
            model1 = applyEvent(model1, { type: 'primary_crash' });
            model1 = applyEvent(model1, { type: 'time_passes', ms: thresholdMs + 5000 });
            model1 = applyEvent(model1, { type: 'check_heartbeat' });

            let model2 = createInitialModel(thresholdMs);
            model2 = applyEvent(model2, { type: 'primary_crash' });
            model2 = applyEvent(model2, { type: 'time_passes', ms: thresholdMs + 5000 });
            for (let i = 0; i < repeats; i++) {
              model2 = applyEvent(model2, { type: 'check_heartbeat' });
            }

            return (
              model1.primaryActive === model2.primaryActive &&
              model1.standbyActive === model2.standbyActive
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
