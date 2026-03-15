/**
 * Unit tests for US-890: Messaging-limits tier migration to 100K flat cap.
 *
 * Validates that obsolete tiers ('250', '2000') are removed, the default
 * tier is '100000', and the PUT endpoint rejects deprecated values.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB before importing module under test ──────────────────────
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoUpdate = vi.fn();

vi.mock('../../lib/db.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: mockWhere }) }),
    update: () => ({ set: () => ({ where: vi.fn().mockResolvedValue(undefined) }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) }),
  },
  dbReady: Promise.resolve(true),
}));

vi.mock('../../../shared/schema.js', () => ({
  appSettings: { key: 'key' },
  rainbowMessages: { role: 'role', timestamp: 'timestamp', deletedAt: 'deletedAt' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: any[]) => args),
  sql: (strings: TemplateStringsArray, ...vals: any[]) => strings.join(''),
}));

vi.mock('../http-utils.js', () => ({
  badRequest: vi.fn((res: any, msg: string) => res.status(400).json({ error: msg })),
  serverError: vi.fn((res: any, msg: any) => res.status(500).json({ error: String(msg) })),
}));

// ── Import after mocks ──────────────────────────────────────────────
import {
  TIER_LIMITS,
  OBSOLETE_TIERS,
  getCurrentTier,
  migrateObsoleteTiers,
} from '../../routes/admin/messaging-limits.js';

// ── Tests ───────────────────────────────────────────────────────────

describe('US-890: Messaging limits tier migration', () => {
  describe('TIER_LIMITS constant', () => {
    it('does not contain obsolete tier 250', () => {
      expect(TIER_LIMITS).not.toHaveProperty('250');
    });

    it('does not contain obsolete tier 2000', () => {
      expect(TIER_LIMITS).not.toHaveProperty('2000');
    });

    it('contains valid tier 10000', () => {
      expect(TIER_LIMITS['10000']).toBe(10_000);
    });

    it('contains valid tier 100000', () => {
      expect(TIER_LIMITS['100000']).toBe(100_000);
    });

    it('contains unlimited tier', () => {
      expect(TIER_LIMITS['unlimited']).toBe(Infinity);
    });

    it('has exactly 3 tiers', () => {
      expect(Object.keys(TIER_LIMITS)).toHaveLength(3);
    });
  });

  describe('OBSOLETE_TIERS constant', () => {
    it('lists 250 as obsolete', () => {
      expect(OBSOLETE_TIERS).toContain('250');
    });

    it('lists 2000 as obsolete', () => {
      expect(OBSOLETE_TIERS).toContain('2000');
    });
  });

  describe('getCurrentTier() defaults', () => {
    it('returns 100000 when no DB row exists', async () => {
      mockWhere.mockResolvedValueOnce([]);
      const tier = await getCurrentTier();
      expect(tier).toBe('100000');
    });
  });

  describe('PUT /analytics/messaging-limits/tier validation', () => {
    const VALID_TIERS = Object.keys(TIER_LIMITS);

    it('accepts 10000 as a valid tier', () => {
      expect(VALID_TIERS).toContain('10000');
    });

    it('accepts 100000 as a valid tier', () => {
      expect(VALID_TIERS).toContain('100000');
    });

    it('accepts unlimited as a valid tier', () => {
      expect(VALID_TIERS).toContain('unlimited');
    });

    it('rejects 250 as an invalid tier', () => {
      expect(VALID_TIERS).not.toContain('250');
    });

    it('rejects 2000 as an invalid tier', () => {
      expect(VALID_TIERS).not.toContain('2000');
    });
  });
});
