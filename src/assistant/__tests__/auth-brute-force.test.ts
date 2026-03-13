/**
 * Unit tests for US-460: Admin auth brute-force protection.
 *
 * Verifies:
 * - IP is locked out after AUTH_MAX_ATTEMPTS consecutive failures
 * - The 6th attempt (index 5) returns isLockedOut === true
 * - Lockout clears on window expiry
 * - Successful auth clears the failure record
 * - Allowlist IPs are handled by the store (store has no allowlist — that
 *   lives in the router middleware; here we just test the store logic)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AuthBruteForceStore } from '../../lib/auth-brute-force.js';

const WINDOW_MS = 900_000; // 15 min
const MAX = 5;

function makeStore(): AuthBruteForceStore {
  return new AuthBruteForceStore(WINDOW_MS, MAX);
}

const IP = '203.0.113.1';

describe('AuthBruteForceStore — basic lockout', () => {
  let store: AuthBruteForceStore;

  beforeEach(() => {
    store = makeStore();
  });

  it('is not locked out before any failures', () => {
    expect(store.isLockedOut(IP)).toBe(false);
  });

  it('is not locked out after fewer than max failures', () => {
    for (let i = 0; i < MAX - 1; i++) store.recordFailure(IP);
    expect(store.isLockedOut(IP)).toBe(false);
  });

  it('is locked out after exactly max failures', () => {
    for (let i = 0; i < MAX; i++) store.recordFailure(IP);
    expect(store.isLockedOut(IP)).toBe(true);
  });

  it('6th attempt (index 5) sees lockout — integration criterion', () => {
    // Simulate 5 failures (max), then check on what would be the 6th attempt
    for (let i = 0; i < MAX; i++) store.recordFailure(IP);
    // The 6th check should return locked out (returning 429)
    expect(store.isLockedOut(IP)).toBe(true);
  });

  it('records failure count correctly', () => {
    const c1 = store.recordFailure(IP);
    const c2 = store.recordFailure(IP);
    expect(c1).toBe(1);
    expect(c2).toBe(2);
  });
});

describe('AuthBruteForceStore — window expiry', () => {
  it('lockout clears when window expires (time-mocked)', () => {
    const store = makeStore();
    const now = Date.now();

    // Record 5 failures at t=0
    for (let i = 0; i < MAX; i++) store.recordFailure(IP, now);
    expect(store.isLockedOut(IP, now)).toBe(true);

    // After the window, should be unlocked
    const afterWindow = now + WINDOW_MS;
    expect(store.isLockedOut(IP, afterWindow)).toBe(false);
  });

  it('resets window counter after expiry', () => {
    const store = makeStore();
    const now = Date.now();

    for (let i = 0; i < MAX; i++) store.recordFailure(IP, now);

    // After window expires, a new failure starts a fresh count
    const afterWindow = now + WINDOW_MS;
    const count = store.recordFailure(IP, afterWindow);
    expect(count).toBe(1);
    expect(store.isLockedOut(IP, afterWindow)).toBe(false);
  });
});

describe('AuthBruteForceStore — clearRecord', () => {
  it('clears failure record on successful auth', () => {
    const store = makeStore();
    for (let i = 0; i < MAX; i++) store.recordFailure(IP);
    expect(store.isLockedOut(IP)).toBe(true);

    store.clearRecord(IP);
    expect(store.isLockedOut(IP)).toBe(false);
    expect(store.size()).toBe(0);
  });
});

describe('AuthBruteForceStore — multiple IPs', () => {
  it('tracks different IPs independently', () => {
    const store = makeStore();
    const IP_A = '203.0.113.1';
    const IP_B = '203.0.113.2';

    for (let i = 0; i < MAX; i++) store.recordFailure(IP_A);
    store.recordFailure(IP_B); // only 1 failure for B

    expect(store.isLockedOut(IP_A)).toBe(true);
    expect(store.isLockedOut(IP_B)).toBe(false);
  });
});

describe('AuthBruteForceStore — purge', () => {
  it('purge removes expired entries', () => {
    const store = makeStore();
    const past = Date.now() - WINDOW_MS - 1;
    store.recordFailure(IP, past); // simulate old record
    expect(store.size()).toBe(1);

    store.purge();
    expect(store.size()).toBe(0);
  });
});
