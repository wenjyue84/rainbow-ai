/**
 * US-351: Profile Isolation Enforcement Runtime Middleware — Unit Tests
 *
 * Tests checkProfileIsolation() and enforceProfileIsolation() with scenarios:
 * - Makan profile message with pelangi/hostel intent → rejection + audit log
 * - Makan profile message with valid makan intent → allowed
 * - Profile not in whitelist → fail open (allowed)
 * - Universal intents (unknown, cancel_workflow) → always allowed
 * - Audit log entry is written with correct fields on violation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkProfileIsolation,
  enforceProfileIsolation,
  logProfileIsolationViolation,
  invalidateWhitelistCache,
  type ProfileIsolationViolation,
} from './profile-isolation-enforcer.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Use vi.hoisted so mockQuery is available when vi.mock factory runs
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock('../../lib/db.js', () => ({
  pool: {
    query: mockQuery,
  },
}));

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockClear();
  invalidateWhitelistCache();
  // Ensure DATABASE_URL is set so audit logging path is exercised
  process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── checkProfileIsolation (synchronous) ────────────────────────────────────

describe('checkProfileIsolation', () => {
  it('returns null for a valid makan intent on makan profile', () => {
    const result = checkProfileIsolation('makan', 'menu_query', 'What is on the menu?');
    expect(result).toBeNull();
  });

  it('returns violation when makan profile receives pelangi/hostel intent', () => {
    const result = checkProfileIsolation('makan', 'booking', 'I want to book a capsule');
    expect(result).not.toBeNull();
    expect(result!.profileId).toBe('makan');
    expect(result!.intent).toBe('booking');
    expect(result!.messagePreview).toBe('I want to book a capsule');
  });

  it('returns violation for pricing intent on makan profile (not in makan whitelist)', () => {
    // 'pricing' is in pelangi/southern but NOT makan whitelist
    const result = checkProfileIsolation('makan', 'availability', 'Are there any rooms?');
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('availability');
  });

  it('returns null for greeting intent — present in all profiles', () => {
    expect(checkProfileIsolation('makan', 'greeting', 'Hello')).toBeNull();
    expect(checkProfileIsolation('southern', 'greeting', 'Hello')).toBeNull();
  });

  it('always allows universal intent "unknown"', () => {
    expect(checkProfileIsolation('makan', 'unknown', 'some random text')).toBeNull();
    expect(checkProfileIsolation('southern', 'unknown', 'some random text')).toBeNull();
  });

  it('always allows universal intent "cancel_workflow"', () => {
    expect(checkProfileIsolation('makan', 'cancel_workflow', 'cancel')).toBeNull();
  });

  it('fails open for unknown profile (no whitelist defined)', () => {
    const result = checkProfileIsolation('unknown_profile', 'booking', 'book me a room');
    expect(result).toBeNull();
  });

  it('truncates message preview to 120 chars', () => {
    const longMessage = 'x'.repeat(200);
    const result = checkProfileIsolation('makan', 'booking', longMessage);
    expect(result!.messagePreview).toHaveLength(120);
  });

  it('includes timestamp in violation', () => {
    const before = Date.now();
    const result = checkProfileIsolation('makan', 'booking', 'book a room');
    const after = Date.now();
    expect(result!.timestamp).toBeGreaterThanOrEqual(before);
    expect(result!.timestamp).toBeLessThanOrEqual(after);
  });
});

// ─── logProfileIsolationViolation ───────────────────────────────────────────

describe('logProfileIsolationViolation', () => {
  it('inserts violation record into rainbow_config_audit', async () => {
    const violation: ProfileIsolationViolation = {
      profileId: 'makan',
      intent: 'booking',
      messagePreview: 'I want to book a capsule',
      timestamp: 1700000000000,
    };

    await logProfileIsolationViolation(violation);

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO rainbow_config_audit');
    expect(params[0]).toBe('profile_isolation_violation');
    expect(params[1]).toBe('makan');

    const auditJson = JSON.parse(params[2]);
    expect(auditJson.profile_id).toBe('makan');
    expect(auditJson.blocked_intent).toBe('booking');
    expect(auditJson.message_preview).toBe('I want to book a capsule');
  });

  it('skips audit log when DATABASE_URL is absent', async () => {
    delete process.env.DATABASE_URL;
    const violation: ProfileIsolationViolation = {
      profileId: 'makan',
      intent: 'booking',
      messagePreview: 'test',
      timestamp: Date.now(),
    };
    await logProfileIsolationViolation(violation);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('does not throw if db.query rejects', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'));
    const violation: ProfileIsolationViolation = {
      profileId: 'makan',
      intent: 'booking',
      messagePreview: 'test',
      timestamp: Date.now(),
    };
    await expect(logProfileIsolationViolation(violation)).resolves.toBeUndefined();
  });
});

// ─── enforceProfileIsolation (async middleware) ──────────────────────────────

describe('enforceProfileIsolation', () => {
  it('returns null (allow) for valid intent on correct profile', async () => {
    const result = await enforceProfileIsolation('makan', 'menu_query', 'What food do you have?');
    expect(result).toBeNull();
  });

  it('returns rejection for cross-profile intent', async () => {
    const result = await enforceProfileIsolation('makan', 'booking', 'I want to book a capsule');
    expect(result).not.toBeNull();
    expect(result!.continue).toBe(false);
    expect(result!.reason).toContain('profile_isolation_violation');
    expect(result!.reason).toContain('booking');
    expect(result!.reason).toContain('makan');
  });

  it('fires audit log on rejection (fire-and-forget — does not await)', async () => {
    await enforceProfileIsolation('makan', 'booking', 'book a room');
    // Give the fire-and-forget a tick to resolve
    await new Promise(r => setImmediate(r));
    expect(mockQuery).toHaveBeenCalled();
  });

  it('returns null for southern profile with valid intent', async () => {
    const result = await enforceProfileIsolation('southern', 'checkin_info', 'What time is check in?');
    expect(result).toBeNull();
  });

  it('blocks makan intent on southern profile', async () => {
    const result = await enforceProfileIsolation('southern', 'menu_query', 'What food is on the menu?');
    expect(result).not.toBeNull();
    expect(result!.continue).toBe(false);
  });
});
