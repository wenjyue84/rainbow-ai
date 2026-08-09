/**
 * US-351: Profile Isolation Enforcement — Integration Tests
 *
 * Verifies profile boundaries are respected across multiple profiles in
 * realistic routing scenarios, mimicking what happens during workflow execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkProfileIsolation,
  enforceProfileIsolation,
  invalidateWhitelistCache,
} from './profile-isolation-enforcer.js';

// Mock the db pool (no real DB in integration tests)
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock('../../lib/db.js', () => ({
  pool: { query: mockQuery },
}));

beforeEach(() => {
  mockQuery.mockClear();
  invalidateWhitelistCache();
  process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
});

// ─── Multi-profile routing scenario ─────────────────────────────────────────

describe('multi-profile routing isolation', () => {
  const makanIntents = ['menu_query', 'order_placement', 'allergen_query', 'specials_query', 'operating_hours'];
  const hostelIntents = ['booking', 'availability', 'checkin_info', 'checkout_info', 'payment_info'];
  const sharedIntents = ['greeting', 'thanks', 'contact_staff', 'pricing', 'directions', 'complaint'];

  it('allows all makan-specific intents on makan profile', async () => {
    for (const intent of makanIntents) {
      const result = await enforceProfileIsolation('makan', intent, `test message for ${intent}`);
      expect(result, `intent "${intent}" should be allowed on makan`).toBeNull();
    }
  });

  it('blocks all hostel intents on makan profile', async () => {
    for (const intent of hostelIntents) {
      const result = await enforceProfileIsolation('makan', intent, `test message for ${intent}`);
      expect(result, `intent "${intent}" should be BLOCKED on makan`).not.toBeNull();
      expect(result!.continue).toBe(false);
    }
  });

  it('allows hostel intents on southern profile', async () => {
    for (const intent of hostelIntents) {
      const result = await enforceProfileIsolation('southern', intent, `test message for ${intent}`);
      expect(result, `intent "${intent}" should be allowed on southern`).toBeNull();
    }
  });

  it('blocks makan-specific intents on southern profile', async () => {
    const makanOnly = ['menu_query', 'order_placement', 'allergen_query', 'vegetarian_query', 'food_recommendation'];
    for (const intent of makanOnly) {
      const result = await enforceProfileIsolation('southern', intent, `test message for ${intent}`);
      expect(result, `intent "${intent}" should be BLOCKED on southern`).not.toBeNull();
    }
  });

  it('shared intents pass on both makan and southern', async () => {
    for (const intent of sharedIntents) {
      const makanResult = await enforceProfileIsolation('makan', intent, 'shared intent test');
      const southernResult = await enforceProfileIsolation('southern', intent, 'shared intent test');
      expect(makanResult, `"${intent}" blocked on makan`).toBeNull();
      expect(southernResult, `"${intent}" blocked on southern`).toBeNull();
    }
  });

  it('each violation produces exactly one audit log entry', async () => {
    mockQuery.mockClear();
    await enforceProfileIsolation('makan', 'booking', 'I want to book');
    await new Promise(r => setImmediate(r));
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('no audit log entry for allowed routing', async () => {
    mockQuery.mockClear();
    await enforceProfileIsolation('makan', 'menu_query', 'What is on the menu?');
    await new Promise(r => setImmediate(r));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('pms_capsule profile allows booking intent', async () => {
    const result = await enforceProfileIsolation('pms_capsule', 'booking', 'I want to book a capsule');
    expect(result).toBeNull();
  });

  it('pms_capsule profile blocks makan-only menu_query intent', async () => {
    const result = await enforceProfileIsolation('pms_capsule', 'menu_query', 'What food is on the menu?');
    expect(result).not.toBeNull();
    expect(result!.continue).toBe(false);
  });
});

// ─── Consistency: checkProfileIsolation vs enforceProfileIsolation ──────────

describe('consistency between check and enforce', () => {
  it('enforce returns null iff check returns null', async () => {
    const pairs: Array<[string, string]> = [
      ['makan', 'menu_query'],
      ['makan', 'booking'],
      ['southern', 'checkin_info'],
      ['southern', 'order_placement'],
      ['pms_capsule', 'availability'],
    ];

    for (const [profile, intent] of pairs) {
      const syncResult = checkProfileIsolation(profile, intent, 'test');
      const asyncResult = await enforceProfileIsolation(profile, intent, 'test');

      if (syncResult === null) {
        expect(asyncResult, `${profile}/${intent}: enforce should allow when check allows`).toBeNull();
      } else {
        expect(asyncResult, `${profile}/${intent}: enforce should block when check blocks`).not.toBeNull();
      }
    }
  });
});
