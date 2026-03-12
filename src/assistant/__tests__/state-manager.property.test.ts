/**
 * Property-Based Tests for StateManager
 *
 * Formal verification of TTL, expiration, and size invariants.
 * Uses fast-check to generate arbitrary access patterns and verify
 * the state manager always satisfies its contracts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { StateManager } from '../state-manager.js';

interface TestState {
  value: number;
}

describe('StateManager — Property-Based Tests', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── P9: TTL Expiry Guarantee ────────────────────────────────────
  // If an entry is created at time T and NOT accessed between T and T+TTL,
  // it must be expired (not returned by get) at T+TTL.
  describe('P9: TTL expiry is guaranteed', () => {
    it('should expire entries exactly after TTL without access', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 10000 }),  // TTL in ms
          fc.integer({ min: 1, max: 20 }),        // number of entries
          (ttlMs, numEntries) => {
            vi.useFakeTimers();
            const manager = new StateManager<TestState>(ttlMs, ttlMs * 10); // cleanup interval >> TTL

            try {
              // Create entries
              for (let i = 0; i < numEntries; i++) {
                manager.getOrCreate(`key-${i}`, () => ({ value: i }));
              }

              // Advance time past TTL
              vi.advanceTimersByTime(ttlMs + 1);

              // All entries should be expired
              for (let i = 0; i < numEntries; i++) {
                if (manager.get(`key-${i}`) !== undefined) return false;
              }

              return true;
            } finally {
              manager.destroy();
              vi.useRealTimers();
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should NOT expire entries before TTL', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 200, max: 10000 }),  // TTL in ms
          fc.integer({ min: 0, max: 99 }),        // percentage of TTL to advance
          (ttlMs, pct) => {
            vi.useFakeTimers();
            const manager = new StateManager<TestState>(ttlMs, ttlMs * 10);

            try {
              manager.getOrCreate('key', () => ({ value: 42 }));

              // Advance less than TTL
              const elapsed = Math.floor(ttlMs * pct / 100);
              vi.advanceTimersByTime(elapsed);

              const result = manager.get('key');
              return result !== undefined && result.value === 42;
            } finally {
              manager.destroy();
              vi.useRealTimers();
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ─── P10: Access Refreshes TTL ───────────────────────────────────
  // Any get/getOrCreate/update call resets the TTL clock.
  describe('P10: Access refreshes TTL', () => {
    it('get() should extend lifetime by resetting lastActiveAt', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 200, max: 5000 }),  // TTL
          fc.integer({ min: 1, max: 10 }),       // number of accesses
          (ttlMs, numAccesses) => {
            vi.useFakeTimers();
            const manager = new StateManager<TestState>(ttlMs, ttlMs * 10);

            try {
              manager.getOrCreate('key', () => ({ value: 1 }));

              // Access the entry repeatedly, each time advancing 80% of TTL
              // Without refresh, the entry would expire after the first advance
              const advanceAmount = Math.floor(ttlMs * 0.8);
              for (let i = 0; i < numAccesses; i++) {
                vi.advanceTimersByTime(advanceAmount);
                const result = manager.get('key');
                if (result === undefined) return false; // Should still be alive
              }

              return true;
            } finally {
              manager.destroy();
              vi.useRealTimers();
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    it('update() should extend lifetime', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 200, max: 5000 }),  // TTL
          fc.integer({ min: 1, max: 10 }),       // number of updates
          (ttlMs, numUpdates) => {
            vi.useFakeTimers();
            const manager = new StateManager<TestState>(ttlMs, ttlMs * 10);

            try {
              manager.getOrCreate('key', () => ({ value: 0 }));

              const advanceAmount = Math.floor(ttlMs * 0.8);
              for (let i = 0; i < numUpdates; i++) {
                vi.advanceTimersByTime(advanceAmount);
                const updated = manager.update('key', (s) => { s.value = i; });
                if (!updated) return false; // Should still be alive
              }

              return true;
            } finally {
              manager.destroy();
              vi.useRealTimers();
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    it('getOrCreate() should extend lifetime of existing entry', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 200, max: 5000 }),  // TTL
          fc.integer({ min: 1, max: 10 }),       // number of accesses
          (ttlMs, numAccesses) => {
            vi.useFakeTimers();
            const manager = new StateManager<TestState>(ttlMs, ttlMs * 10);

            try {
              manager.getOrCreate('key', () => ({ value: 42 }));

              const advanceAmount = Math.floor(ttlMs * 0.8);
              for (let i = 0; i < numAccesses; i++) {
                vi.advanceTimersByTime(advanceAmount);
                const result = manager.getOrCreate('key', () => ({ value: -1 }));
                // Should return existing value, not factory value
                if (result.value !== 42) return false;
              }

              return true;
            } finally {
              manager.destroy();
              vi.useRealTimers();
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ─── P11: Size Consistency ───────────────────────────────────────
  // size() always equals the count of entries where (now - lastActiveAt) < ttlMs
  describe('P11: size() matches non-expired entry count', () => {
    it('should report correct size after mixed operations', () => {
      type Op =
        | { type: 'create'; key: string }
        | { type: 'delete'; key: string }
        | { type: 'access'; key: string }
        | { type: 'advance'; ms: number };

      const keyArb = fc.integer({ min: 0, max: 9 }).map(n => `k${n}`);
      const opArb: fc.Arbitrary<Op> = fc.oneof(
        keyArb.map(key => ({ type: 'create' as const, key })),
        keyArb.map(key => ({ type: 'delete' as const, key })),
        keyArb.map(key => ({ type: 'access' as const, key })),
        fc.integer({ min: 0, max: 5000 }).map(ms => ({ type: 'advance' as const, ms }))
      );

      fc.assert(
        fc.property(
          fc.array(opArb, { minLength: 1, maxLength: 100 }),
          fc.integer({ min: 100, max: 5000 }),  // TTL
          (ops, ttlMs) => {
            vi.useFakeTimers();
            const manager = new StateManager<TestState>(ttlMs, ttlMs * 100);

            try {
              for (const op of ops) {
                switch (op.type) {
                  case 'create':
                    manager.getOrCreate(op.key, () => ({ value: 1 }));
                    break;
                  case 'delete':
                    manager.delete(op.key);
                    break;
                  case 'access':
                    manager.get(op.key);
                    break;
                  case 'advance':
                    vi.advanceTimersByTime(op.ms);
                    break;
                }
              }

              // Verify: size() should match entries().length
              const size = manager.size();
              const entriesLength = manager.entries().length;

              return size === entriesLength;
            } finally {
              manager.destroy();
              vi.useRealTimers();
            }
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  // ─── P12: Cleanup Safety ─────────────────────────────────────────
  // After cleanup runs, no expired entries remain, but all live entries survive.
  describe('P12: Cleanup preserves live entries and removes expired', () => {
    it('should preserve live entries through cleanup cycles', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 2000 }),  // TTL
          fc.integer({ min: 1, max: 10 }),       // entries to keep alive
          fc.integer({ min: 1, max: 10 }),       // entries to let expire
          (ttlMs, liveCount, expireCount) => {
            vi.useFakeTimers();
            const cleanupMs = Math.floor(ttlMs / 2);
            const manager = new StateManager<TestState>(ttlMs, cleanupMs);

            try {
              // Create "live" entries
              for (let i = 0; i < liveCount; i++) {
                manager.getOrCreate(`live-${i}`, () => ({ value: i }));
              }

              // Create "expire" entries
              for (let i = 0; i < expireCount; i++) {
                manager.getOrCreate(`expire-${i}`, () => ({ value: i }));
              }

              // Advance 80% of TTL — touch live entries, leave expire entries
              vi.advanceTimersByTime(Math.floor(ttlMs * 0.8));
              for (let i = 0; i < liveCount; i++) {
                manager.get(`live-${i}`);
              }

              // Advance past TTL for expire entries (total > TTL from their creation)
              vi.advanceTimersByTime(Math.floor(ttlMs * 0.3));

              // Trigger cleanup
              vi.advanceTimersByTime(cleanupMs);

              // Live entries should still exist
              for (let i = 0; i < liveCount; i++) {
                if (manager.get(`live-${i}`) === undefined) return false;
              }

              // Expire entries should be gone
              for (let i = 0; i < expireCount; i++) {
                if (manager.get(`expire-${i}`) !== undefined) return false;
              }

              return true;
            } finally {
              manager.destroy();
              vi.useRealTimers();
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ─── P13: getOrCreate Factory Isolation ──────────────────────────
  // The factory function should only be called when the entry doesn't exist
  // or is expired. For live entries, factory is never called.
  describe('P13: Factory is only called for new/expired entries', () => {
    it('should not call factory for live entries', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 200, max: 5000 }),  // TTL
          fc.integer({ min: 1, max: 20 }),       // access count
          (ttlMs, accessCount) => {
            vi.useFakeTimers();
            const manager = new StateManager<TestState>(ttlMs, ttlMs * 10);

            try {
              let factoryCallCount = 0;
              const factory = () => { factoryCallCount++; return { value: 42 }; };

              // First call — factory invoked
              manager.getOrCreate('key', factory);

              // Subsequent calls within TTL — factory should NOT be invoked
              for (let i = 0; i < accessCount; i++) {
                vi.advanceTimersByTime(Math.floor(ttlMs * 0.5));
                manager.getOrCreate('key', factory);
              }

              return factoryCallCount === 1;
            } finally {
              manager.destroy();
              vi.useRealTimers();
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
