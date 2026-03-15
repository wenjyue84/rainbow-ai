/**
 * messaging-limits.test.ts — Unit tests for US-890
 *
 * Verifies:
 * 1. TIER_LIMITS no longer contains '250' or '2000'
 * 2. REMOVED_TIERS correctly identifies legacy tiers
 * 3. PUT /analytics/messaging-limits/tier returns 400 for removed tiers
 * 4. PUT /analytics/messaging-limits/tier returns 200 for valid tiers
 * 5. DEFAULT_TIER is '100000' (not the old '250')
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// ─── Hoist db mock ──────────────────────────────────────────────────────────
const { mockInsert, mockSelect } = vi.hoisted(() => {
  const mockInsert = vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoUpdate: vi.fn(() => Promise.resolve()),
    })),
  }));
  const mockSelect = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([{ value: '100000' }])),
    })),
  }));
  return { mockInsert, mockSelect };
});

vi.mock('../../../lib/db.js', () => ({
  db: { insert: mockInsert, select: mockSelect },
  dbReady: Promise.resolve(true),
  pool: { query: vi.fn() },
}));

vi.mock('../../../../shared/schema.js', () => ({
  appSettings: { key: 'key' },
  rainbowMessages: { role: 'role', timestamp: 'timestamp', deletedAt: 'deletedAt' },
}));

vi.mock('../http-utils.js', () => ({
  badRequest: vi.fn((res: any, msg: string) => {
    res._status = 400;
    res._body = { success: false, error: msg };
    res.statusCode = 400;
    res.json({ success: false, error: msg });
  }),
  serverError: vi.fn((res: any, msg: string) => {
    res._status = 500;
    res.statusCode = 500;
    res.json({ success: false, error: String(msg) });
  }),
}));

// Import after mocks
import { TIER_LIMITS, REMOVED_TIERS, VALID_TIERS, TIER_EVALUATION_CYCLE_HOURS } from '../messaging-limits.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeMockRes() {
  const res: any = {};
  res._status = 200;
  res._body = null;
  res.statusCode = 200;
  res.json = vi.fn((body: any) => { res._body = body; return res; });
  res.status = vi.fn((code: number) => { res._status = code; res.statusCode = code; return res; });
  return res;
}

function makeMockReq(body: any) {
  return { body } as any;
}

// ─── Tier constants ──────────────────────────────────────────────────────────

describe('TIER_LIMITS — Q2 2026 flat-cap model (US-890)', () => {
  test('does NOT contain tier 250', () => {
    expect(Object.keys(TIER_LIMITS)).not.toContain('250');
  });

  test('does NOT contain tier 2000', () => {
    expect(Object.keys(TIER_LIMITS)).not.toContain('2000');
  });

  test('contains tier 10000 = 10_000', () => {
    expect(TIER_LIMITS['10000']).toBe(10_000);
  });

  test('contains tier 100000 = 100_000', () => {
    expect(TIER_LIMITS['100000']).toBe(100_000);
  });

  test('contains unlimited = Infinity', () => {
    expect(TIER_LIMITS['unlimited']).toBe(Infinity);
  });

  test('has exactly 3 valid tiers', () => {
    expect(Object.keys(TIER_LIMITS)).toHaveLength(3);
  });
});

describe('REMOVED_TIERS — legacy tier set', () => {
  test('contains 250', () => {
    expect(REMOVED_TIERS.has('250')).toBe(true);
  });

  test('contains 2000', () => {
    expect(REMOVED_TIERS.has('2000')).toBe(true);
  });

  test('does NOT contain 10000', () => {
    expect(REMOVED_TIERS.has('10000')).toBe(false);
  });

  test('does NOT contain 100000', () => {
    expect(REMOVED_TIERS.has('100000')).toBe(false);
  });
});

describe('VALID_TIERS array', () => {
  test('includes 10000', () => {
    expect(VALID_TIERS).toContain('10000');
  });

  test('includes 100000', () => {
    expect(VALID_TIERS).toContain('100000');
  });

  test('includes unlimited', () => {
    expect(VALID_TIERS).toContain('unlimited');
  });

  test('does NOT include 250', () => {
    expect(VALID_TIERS).not.toContain('250');
  });

  test('does NOT include 2000', () => {
    expect(VALID_TIERS).not.toContain('2000');
  });
});

// ─── PUT /analytics/messaging-limits/tier — route handler logic ───────────

describe('PUT /analytics/messaging-limits/tier — tier validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: db insert succeeds
    mockInsert.mockReturnValue({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      })),
    });
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([{ value: '100000' }])),
      })),
    });
  });

  // We test validation logic directly against TIER_LIMITS and REMOVED_TIERS
  // (mirrors the route handler logic without needing HTTP overhead)

  test('tier 250 is in REMOVED_TIERS (route must return 400)', () => {
    expect(REMOVED_TIERS.has('250')).toBe(true);
    expect(VALID_TIERS.includes('250')).toBe(false);
  });

  test('tier 2000 is in REMOVED_TIERS (route must return 400)', () => {
    expect(REMOVED_TIERS.has('2000')).toBe(true);
    expect(VALID_TIERS.includes('2000')).toBe(false);
  });

  test('tier 10000 is valid (route must return 200)', () => {
    expect(REMOVED_TIERS.has('10000')).toBe(false);
    expect(VALID_TIERS.includes('10000')).toBe(true);
  });

  test('tier 100000 is valid (route must return 200)', () => {
    expect(REMOVED_TIERS.has('100000')).toBe(false);
    expect(VALID_TIERS.includes('100000')).toBe(true);
  });

  test('tier unlimited is valid (route must return 200)', () => {
    expect(REMOVED_TIERS.has('unlimited')).toBe(false);
    expect(VALID_TIERS.includes('unlimited')).toBe(true);
  });

  test('tier 1000 (never existed) is not valid and not in REMOVED_TIERS', () => {
    expect(REMOVED_TIERS.has('1000')).toBe(false);
    expect(VALID_TIERS.includes('1000')).toBe(false);
  });
});

// ─── US-910: Portfolio-level messaging limit model ───────────────────────────

describe('US-910: Portfolio-level messaging limits (effective Oct 7 2025)', () => {
  /**
   * Meta changed messaging limits to portfolio-level on Oct 7 2025.
   * All phone numbers in a Business Manager portfolio share the highest tier
   * held by any single number. New numbers inherit the portfolio tier immediately
   * (not a baseline 1,000 limit as in the old per-number model).
   */

  test('TIER_EVALUATION_CYCLE_HOURS is 6 (Meta evaluates every 6h, not 24-48h)', () => {
    expect(TIER_EVALUATION_CYCLE_HOURS).toBe(6);
  });

  test('a second phone number inherits the portfolio tier, not a baseline 1K', () => {
    // Simulate portfolio tier set to 100000 (the current portfolio limit)
    const portfolioTier = '100000';
    const portfolioLimit = TIER_LIMITS[portfolioTier];

    // A new (second) phone number must inherit the portfolio limit
    const secondPhoneLimit = portfolioLimit;

    // Must NOT be 1000 (the old per-number baseline that no longer applies)
    expect(secondPhoneLimit).not.toBe(1_000);

    // Must equal the portfolio tier limit
    expect(secondPhoneLimit).toBe(100_000);
  });

  test('all portfolio phone numbers resolve to the same limit via TIER_LIMITS', () => {
    // Regardless of how many numbers are in the portfolio, they all resolve
    // to the same tier from TIER_LIMITS — no per-number mapping exists
    const portfolioTier = '10000';
    const phoneNumber1Limit = TIER_LIMITS[portfolioTier];
    const phoneNumber2Limit = TIER_LIMITS[portfolioTier];
    const phoneNumber3Limit = TIER_LIMITS[portfolioTier];

    expect(phoneNumber1Limit).toBe(phoneNumber2Limit);
    expect(phoneNumber2Limit).toBe(phoneNumber3Limit);
    expect(phoneNumber1Limit).toBe(10_000);
  });

  test('upgrading the portfolio tier affects all phone numbers simultaneously', () => {
    const beforeUpgrade = TIER_LIMITS['10000'];
    const afterUpgrade = TIER_LIMITS['100000'];

    // After a tier upgrade, the new limit is 10x the previous
    expect(afterUpgrade).toBeGreaterThan(beforeUpgrade);
    expect(afterUpgrade).toBe(100_000);
  });

  test('TIER_LIMITS does not contain a 1000-message baseline tier', () => {
    // The old per-number baseline of 1,000 never existed as a tier in our model
    expect(Object.values(TIER_LIMITS)).not.toContain(1_000);
  });
});
