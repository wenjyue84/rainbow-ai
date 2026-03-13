/**
 * Unit tests for US-495: WhatsApp per-message cost tracking.
 *
 * Tests:
 * - CSW detection logic (within/outside 24h window)
 * - Cost estimation (free for service, free for utility within CSW, charged otherwise)
 * - Rate table defaults
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (vi.mock factories are hoisted above imports) ──────

const { mockDbSelect, mockDbInsert, mockDbExecute } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbExecute: vi.fn(),
}));

vi.mock('../../lib/db.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockDbSelect,
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: mockDbInsert,
      }),
    }),
    execute: mockDbExecute,
  },
}));

vi.mock('../../../shared/schema-tables.js', () => ({
  rainbowMessages: {
    phone: 'phone',
    role: 'role',
    timestamp: 'timestamp',
    deletedAt: 'deleted_at',
  },
  whatsappCostDaily: {
    date: 'date',
    profileId: 'profile_id',
    templateType: 'template_type',
    countryCode: 'country_code',
    totalMessages: 'total_messages',
    billableMessages: 'billable_messages',
    cswFreeMessages: 'csw_free_messages',
    estimatedCostUsd: 'estimated_cost_usd',
  },
  appSettings: {
    key: 'key',
  },
}));

import {
  isWithinCSW,
  estimateMessageCost,
  recordWhatsappMessageCost,
  _testExports,
} from '../../lib/whatsapp-cost.js';

// ── Tests ────────────────────────────────────────────────────────────

describe('CSW Detection (isWithinCSW)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when customer sent a message within 24h', async () => {
    mockDbSelect.mockResolvedValueOnce([{ count: 3 }]);
    const result = await isWithinCSW('60123456789');
    expect(result).toBe(true);
  });

  it('returns false when no customer message within 24h', async () => {
    mockDbSelect.mockResolvedValueOnce([{ count: 0 }]);
    const result = await isWithinCSW('60123456789');
    expect(result).toBe(false);
  });

  it('returns false on DB error (safe default)', async () => {
    mockDbSelect.mockRejectedValueOnce(new Error('connection failed'));
    const result = await isWithinCSW('60123456789');
    expect(result).toBe(false);
  });
});

describe('Cost Estimation (estimateMessageCost)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock: no custom rate table in DB → uses defaults
    mockDbSelect.mockResolvedValue([]);
  });

  it('service messages are always free', async () => {
    const cost = await estimateMessageCost('service', 'MY', false);
    expect(cost).toBe(0);
  });

  it('service messages are free even within CSW', async () => {
    const cost = await estimateMessageCost('service', 'MY', true);
    expect(cost).toBe(0);
  });

  it('utility messages within CSW are free', async () => {
    const cost = await estimateMessageCost('utility', 'MY', true);
    expect(cost).toBe(0);
  });

  it('utility messages outside CSW are charged', async () => {
    const cost = await estimateMessageCost('utility', 'MY', false);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBe(_testExports.DEFAULT_RATE_TABLE.utility.MY);
  });

  it('marketing messages are always charged', async () => {
    const costWithCSW = await estimateMessageCost('marketing', 'MY', true);
    const costWithoutCSW = await estimateMessageCost('marketing', 'MY', false);
    expect(costWithCSW).toBeGreaterThan(0);
    expect(costWithoutCSW).toBeGreaterThan(0);
    expect(costWithCSW).toBe(costWithoutCSW);
  });

  it('authentication messages are charged', async () => {
    const cost = await estimateMessageCost('authentication', 'MY', false);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBe(_testExports.DEFAULT_RATE_TABLE.authentication.MY);
  });

  it('uses _default rate for unknown country', async () => {
    const cost = await estimateMessageCost('marketing', 'ZZ', false);
    expect(cost).toBe(_testExports.DEFAULT_RATE_TABLE.marketing._default);
  });

  it('uses country-specific rate for known country', async () => {
    const cost = await estimateMessageCost('marketing', 'SG', false);
    expect(cost).toBe(_testExports.DEFAULT_RATE_TABLE.marketing.SG);
  });
});

describe('Default Rate Table', () => {
  it('has entries for marketing, utility, authentication, service', () => {
    const table = _testExports.DEFAULT_RATE_TABLE;
    expect(table).toHaveProperty('marketing');
    expect(table).toHaveProperty('utility');
    expect(table).toHaveProperty('authentication');
    expect(table).toHaveProperty('service');
  });

  it('service rates are all zero', () => {
    const serviceRates = _testExports.DEFAULT_RATE_TABLE.service;
    for (const rate of Object.values(serviceRates)) {
      expect(rate).toBe(0);
    }
  });

  it('all non-service rates have _default fallback', () => {
    for (const type of ['marketing', 'utility', 'authentication']) {
      expect(_testExports.DEFAULT_RATE_TABLE[type]).toHaveProperty('_default');
    }
  });

  it('Malaysia (MY) rates are defined for all types', () => {
    expect(_testExports.DEFAULT_RATE_TABLE.marketing.MY).toBeDefined();
    expect(_testExports.DEFAULT_RATE_TABLE.utility.MY).toBeDefined();
    expect(_testExports.DEFAULT_RATE_TABLE.authentication.MY).toBeDefined();
  });
});

describe('recordWhatsappMessageCost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _testExports.accumulators.clear();
    // Mock CSW check: no messages → outside CSW
    mockDbSelect.mockResolvedValue([{ count: 0 }]);
    // Mock DB insert
    mockDbInsert.mockResolvedValue(undefined);
  });

  it('records a service message cost as zero', async () => {
    await recordWhatsappMessageCost({
      phone: '60123456789',
      templateType: 'service',
      profileId: 'pelangi',
    });

    // The accumulator should have 1 message but 0 cost
    const today = _testExports.todayUTC();
    const key = `${today}::pelangi::service::MY`;
    const acc = _testExports.accumulators.get(key);
    expect(acc).toBeDefined();
    expect(acc!.totalMessages).toBe(1);
    expect(acc!.estimatedCostUsd).toBe(0);
  });

  it('records utility message as billable when outside CSW', async () => {
    // Mock: no recent customer messages → outside CSW
    mockDbSelect.mockResolvedValueOnce([{ count: 0 }]).mockResolvedValue([]);

    await recordWhatsappMessageCost({
      phone: '60123456789',
      templateType: 'utility',
      countryCode: 'MY',
      profileId: 'pelangi',
    });

    const today = _testExports.todayUTC();
    const key = `${today}::pelangi::utility::MY`;
    const acc = _testExports.accumulators.get(key);
    expect(acc).toBeDefined();
    expect(acc!.totalMessages).toBe(1);
    expect(acc!.billableMessages).toBe(1);
    expect(acc!.cswFreeMessages).toBe(0);
    expect(acc!.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('records utility message as CSW-free when within CSW', async () => {
    // Mock: customer sent message recently → within CSW
    mockDbSelect.mockResolvedValueOnce([{ count: 1 }]).mockResolvedValue([]);

    await recordWhatsappMessageCost({
      phone: '60123456789',
      templateType: 'utility',
      countryCode: 'MY',
      profileId: 'pelangi',
    });

    const today = _testExports.todayUTC();
    const key = `${today}::pelangi::utility::MY`;
    const acc = _testExports.accumulators.get(key);
    expect(acc).toBeDefined();
    expect(acc!.totalMessages).toBe(1);
    expect(acc!.billableMessages).toBe(0);
    expect(acc!.cswFreeMessages).toBe(1);
    expect(acc!.estimatedCostUsd).toBe(0);
  });
});
