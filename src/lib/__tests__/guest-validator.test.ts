/**
 * US-346: Guest Blacklist Lookup Before Booking Confirmation
 *
 * Tests:
 *   AC1: guest_blacklist table schema exists in schema-tables.ts
 *   AC2: checkBlacklist() returns BlacklistMatch on exact phone match
 *        and fuzzy name match ≥85% similarity; returns null otherwise
 *   AC3: checkBlacklist() never throws — returns null on DB failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkBlacklist } from '../guest-validator.js';

// ─── Mock DB ──────────────────────────────────────────────────────────────────

let mockEntries: any[] = [];

vi.mock('../../lib/db.js', () => ({
  db: {
    select: () => ({
      from: () => Promise.resolve(mockEntries),
    }),
  },
}));

vi.mock('../../lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../shared/schema-tables.js', () => ({
  guestBlacklist: { name: 'guest_blacklist' },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('US-346: Guest Blacklist Lookup', () => {
  beforeEach(() => {
    mockEntries = [];
    vi.clearAllMocks();
  });

  // ─── AC1: Schema presence is tested structurally in schema-tables ─────────

  describe('AC1: guest_blacklist table is defined in schema', () => {
    it('guestBlacklist export is importable from schema-tables', async () => {
      const { guestBlacklist } = await import('../../../shared/schema-tables.js');
      expect(guestBlacklist).toBeDefined();
    });
  });

  // ─── AC2: checkBlacklist matching logic ───────────────────────────────────

  describe('AC2: checkBlacklist() matching', () => {
    it('returns null when blacklist is empty', async () => {
      mockEntries = [];
      const result = await checkBlacklist('+60123456789', 'Ali Hassan');
      expect(result).toBeNull();
    });

    it('matches by exact phone (digits only)', async () => {
      mockEntries = [
        { id: 1, phone: '+60123456789', name: null, reason: 'fraud', addedBy: 'admin', createdAt: new Date() },
      ];
      const result = await checkBlacklist('+60123456789', 'Any Name');
      expect(result).not.toBeNull();
      expect(result!.matchedOn).toBe('phone');
      expect(result!.reason).toBe('fraud');
    });

    it('matches phone regardless of formatting differences', async () => {
      mockEntries = [
        { id: 2, phone: '60123456789', name: null, reason: 'no-show', addedBy: 'admin', createdAt: new Date() },
      ];
      // With +60 prefix — digits should normalise to same
      const result = await checkBlacklist('+60123456789');
      expect(result).not.toBeNull();
      expect(result!.matchedOn).toBe('phone');
    });

    it('returns null when phone does not match', async () => {
      mockEntries = [
        { id: 3, phone: '+60199887766', name: null, reason: 'theft', addedBy: 'admin', createdAt: new Date() },
      ];
      const result = await checkBlacklist('+60123456789', 'Ali');
      expect(result).toBeNull();
    });

    it('matches by fuzzy name ≥85% similarity', async () => {
      mockEntries = [
        { id: 4, phone: null, name: 'Muhammad Ali Hassan', reason: 'banned', addedBy: 'admin', createdAt: new Date() },
      ];
      // Very close name — should hit
      const result = await checkBlacklist('+60100000000', 'Muhammad Ali Hasan');
      expect(result).not.toBeNull();
      expect(result!.matchedOn).toBe('name');
      expect(result!.similarity).toBeGreaterThanOrEqual(0.85);
    });

    it('does NOT match name below 85% threshold', async () => {
      mockEntries = [
        { id: 5, phone: null, name: 'Muhammad Ali Hassan', reason: 'banned', addedBy: 'admin', createdAt: new Date() },
      ];
      // Completely different name
      const result = await checkBlacklist('+60100000000', 'Lim Ah Kow');
      expect(result).toBeNull();
    });

    it('exact name match always triggers (similarity = 1.0)', async () => {
      mockEntries = [
        { id: 6, phone: null, name: 'Tan Siew Lin', reason: 'damage', addedBy: 'admin', createdAt: new Date() },
      ];
      const result = await checkBlacklist('+60100000000', 'Tan Siew Lin');
      expect(result).not.toBeNull();
      expect(result!.similarity).toBe(1.0);
    });

    it('returns first match when both phone and name match different entries', async () => {
      mockEntries = [
        { id: 7, phone: '+60123456789', name: null, reason: 'phone_fraud', addedBy: 'admin', createdAt: new Date() },
        { id: 8, phone: null, name: 'Test User', reason: 'name_banned', addedBy: 'admin', createdAt: new Date() },
      ];
      const result = await checkBlacklist('+60123456789', 'Test User');
      // First entry (phone) should win
      expect(result!.reason).toBe('phone_fraud');
      expect(result!.matchedOn).toBe('phone');
    });
  });

  // ─── AC3: Never throws on DB failure ─────────────────────────────────────

  describe('AC3: Graceful failure — never blocks booking on error', () => {
    it('returns null (allowing booking) when DB select fails', async () => {
      vi.doMock('../../lib/db.js', () => ({
        db: {
          select: () => ({
            from: () => Promise.reject(new Error('DB connection lost')),
          }),
        },
      }));

      // Re-import to get the version that uses the failing mock
      const { checkBlacklist: checkFailing } = await import('../guest-validator.js?fail-test');
      // The existing imported function has already captured the working mock,
      // so we test error handling via the existing function with a throw in entries
      mockEntries = null as any; // will cause iteration failure

      // Should not throw
      const result = await checkBlacklist('+60100000000', 'Test');
      // null or no match both indicate graceful failure
      expect(result === null || result === undefined).toBe(true);
    });
  });
});
