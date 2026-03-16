/**
 * Property-Based Tests for LatencySLOTracker (US-996)
 *
 * Verifies that:
 * 1. A slow provider is always demoted after threshold is crossed
 * 2. A demoted provider is ranked below a fast provider
 * 3. Recovery restores the provider after consecutive fast calls
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { LatencySLOTracker } from '../latency-slo-tracker.js';

describe('LatencySLOTracker', () => {
  const THRESHOLD_MS = 3000;
  const WINDOW_SIZE = 20;
  const RECOVERY_WINDOW = 5;

  let tracker: LatencySLOTracker;

  beforeEach(() => {
    tracker = new LatencySLOTracker({
      windowSize: WINDOW_SIZE,
      slowThresholdMs: THRESHOLD_MS,
      recoveryWindow: RECOVERY_WINDOW,
    });
  });

  describe('demotion', () => {
    it('demotes a provider when P95 exceeds threshold', () => {
      // Feed 20 latencies all above threshold
      for (let i = 0; i < 20; i++) {
        tracker.recordLatency('slow-provider', THRESHOLD_MS + 500);
      }

      expect(tracker.isDemoted('slow-provider')).toBe(true);
      const status = tracker.getStatus('slow-provider');
      expect(status.p95Ms).toBeGreaterThan(THRESHOLD_MS);
    });

    it('does NOT demote a provider when latencies are within SLO', () => {
      for (let i = 0; i < 20; i++) {
        tracker.recordLatency('fast-provider', THRESHOLD_MS - 500);
      }

      expect(tracker.isDemoted('fast-provider')).toBe(false);
    });

    it('does NOT demote with fewer than 3 samples', () => {
      tracker.recordLatency('new-provider', THRESHOLD_MS + 5000);
      tracker.recordLatency('new-provider', THRESHOLD_MS + 5000);
      expect(tracker.isDemoted('new-provider')).toBe(false);
    });
  });

  describe('recovery', () => {
    it('restores a demoted provider after consecutive fast calls', () => {
      // First, demote the provider
      for (let i = 0; i < 20; i++) {
        tracker.recordLatency('recovering-provider', THRESHOLD_MS + 500);
      }
      expect(tracker.isDemoted('recovering-provider')).toBe(true);

      // Now send recovery_window consecutive fast calls
      for (let i = 0; i < RECOVERY_WINDOW; i++) {
        tracker.recordLatency('recovering-provider', 500);
      }

      expect(tracker.isDemoted('recovering-provider')).toBe(false);
    });

    it('resets recovery counter on a slow call during recovery', () => {
      // Demote
      for (let i = 0; i < 20; i++) {
        tracker.recordLatency('flaky-provider', THRESHOLD_MS + 500);
      }
      expect(tracker.isDemoted('flaky-provider')).toBe(true);

      // Start recovery but interrupt with a slow call
      for (let i = 0; i < RECOVERY_WINDOW - 1; i++) {
        tracker.recordLatency('flaky-provider', 500);
      }
      // Interrupt with a slow call
      tracker.recordLatency('flaky-provider', THRESHOLD_MS + 1000);

      // Should still be demoted
      expect(tracker.isDemoted('flaky-provider')).toBe(true);

      // Need full recovery window again
      for (let i = 0; i < RECOVERY_WINDOW; i++) {
        tracker.recordLatency('flaky-provider', 500);
      }
      expect(tracker.isDemoted('flaky-provider')).toBe(false);
    });
  });

  describe('property: slow provider always ranked below fast provider', () => {
    it('a demoted slow provider is always below a non-demoted fast provider in ordering', () => {
      fc.assert(
        fc.property(
          // Generate random fast latencies (100-2500ms) and slow latencies (3001-6000ms)
          fc.array(fc.integer({ min: 100, max: 2500 }), { minLength: 20, maxLength: 40 }),
          fc.array(fc.integer({ min: THRESHOLD_MS + 1, max: 6000 }), { minLength: 20, maxLength: 40 }),
          (fastLatencies, slowLatencies) => {
            const t = new LatencySLOTracker({
              windowSize: WINDOW_SIZE,
              slowThresholdMs: THRESHOLD_MS,
              recoveryWindow: RECOVERY_WINDOW,
            });

            // Record fast latencies for provider A
            for (const lat of fastLatencies) {
              t.recordLatency('provider-A', lat);
            }

            // Record slow latencies for provider B
            for (const lat of slowLatencies) {
              t.recordLatency('provider-B', lat);
            }

            // Provider B must be demoted (all latencies > threshold, enough samples)
            expect(t.isDemoted('provider-B')).toBe(true);
            // Provider A must NOT be demoted (all latencies < threshold)
            expect(t.isDemoted('provider-A')).toBe(false);

            // Simulate getProviders ordering logic:
            // healthy providers first, then demoted
            const providers = [
              { id: 'provider-A', priority: 1 },
              { id: 'provider-B', priority: 0 }, // B has higher configured priority (lower number)
            ];

            const healthy = providers.filter(p => !t.isDemoted(p.id));
            const demoted = providers.filter(p => t.isDemoted(p.id));
            const ordered = [...healthy, ...demoted];

            // Despite B having a higher configured priority (0 < 1),
            // A should come first because B is demoted
            expect(ordered[0].id).toBe('provider-A');
            expect(ordered[1].id).toBe('provider-B');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('P95 calculation', () => {
    it('calculates P95 correctly for a known distribution', () => {
      // Record 20 values: 1-20
      for (let i = 1; i <= 20; i++) {
        tracker.recordLatency('calc-provider', i * 100);
      }

      const p95 = tracker.getP95('calc-provider');
      // P95 of [100, 200, ..., 2000]: ceil(20 * 0.95) - 1 = 19 - 1 = 18th index → 1900
      expect(p95).toBe(1900);
    });
  });

  describe('rolling window', () => {
    it('evicts old entries beyond window size', () => {
      // Fill window with slow values
      for (let i = 0; i < WINDOW_SIZE; i++) {
        tracker.recordLatency('window-test', THRESHOLD_MS + 500);
      }
      expect(tracker.isDemoted('window-test')).toBe(true);

      // Now overwrite with fast values (more than window size)
      for (let i = 0; i < WINDOW_SIZE + RECOVERY_WINDOW; i++) {
        tracker.recordLatency('window-test', 200);
      }

      // Should have recovered
      expect(tracker.isDemoted('window-test')).toBe(false);

      const status = tracker.getStatus('window-test');
      expect(status.sampleCount).toBe(WINDOW_SIZE);
    });
  });

  describe('getAllStatuses', () => {
    it('returns all tracked providers', () => {
      tracker.recordLatency('p1', 100);
      tracker.recordLatency('p2', 200);
      tracker.recordLatency('p3', 300);

      const all = tracker.getAllStatuses();
      expect(Object.keys(all)).toHaveLength(3);
      expect(all['p1']).toBeDefined();
      expect(all['p2']).toBeDefined();
      expect(all['p3']).toBeDefined();
    });
  });

  describe('reset', () => {
    it('clears tracking state for a single provider', () => {
      tracker.recordLatency('reset-test', 5000);
      tracker.recordLatency('reset-test', 5000);
      tracker.recordLatency('reset-test', 5000);
      expect(tracker.isDemoted('reset-test')).toBe(true);

      tracker.reset('reset-test');
      expect(tracker.isDemoted('reset-test')).toBe(false);
      expect(tracker.getP95('reset-test')).toBeNull();
    });

    it('resetAll clears all providers', () => {
      tracker.recordLatency('p1', 5000);
      tracker.recordLatency('p1', 5000);
      tracker.recordLatency('p1', 5000);
      tracker.recordLatency('p2', 5000);
      tracker.recordLatency('p2', 5000);
      tracker.recordLatency('p2', 5000);

      tracker.resetAll();
      expect(Object.keys(tracker.getAllStatuses())).toHaveLength(0);
    });
  });
});
