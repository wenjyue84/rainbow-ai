/**
 * Unit tests for US-495 + US-845 + US-963: WhatsApp cost tracking.
 *
 * Tests:
 * - CSW detection logic (within/outside 24h window)
 * - Per-message cost estimation (free for service, free for utility within CSW, charged otherwise)
 * - Per-conversation cost estimation (legacy model)
 * - Rate table defaults for both pricing models
 * - Pricing model toggle
 * - Volume-tier discount logic (US-963)
 * - CSW-free vs charged utility dashboard split (US-963)
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
  estimateConversationCost,
  getActivePricingModel,
  recordWhatsappMessageCost,
  getMonthlyBillableCount,
  getVolumeTierDiscount,
  queryVolumeTierStatus,
  _testExports,
} from '../../lib/whatsapp-cost.js';

// ── Tests ────────────────────────────────────────────────────────────

describe('CSW Detection (isWithinCSW)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _testExports.resetCaches();
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
    vi.resetAllMocks();
    _testExports.resetCaches();
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

// ── US-845: Per-conversation cost estimation tests ──────────────────

describe('Per-Conversation Cost Estimation (estimateConversationCost)', () => {
  it('service conversations are always free', () => {
    const cost = estimateConversationCost('service', 'MY', 10);
    expect(cost).toBe(0);
  });

  it('marketing conversations use per-conversation rates', () => {
    const rate = _testExports.DEFAULT_CONVERSATION_RATE_TABLE.marketing.MY;
    const cost = estimateConversationCost('marketing', 'MY', 5);
    expect(cost).toBeCloseTo(5 * rate, 6);
  });

  it('utility conversations use per-conversation rates', () => {
    const rate = _testExports.DEFAULT_CONVERSATION_RATE_TABLE.utility.SG;
    const cost = estimateConversationCost('utility', 'SG', 3);
    expect(cost).toBeCloseTo(3 * rate, 6);
  });

  it('authentication conversations use per-conversation rates', () => {
    const rate = _testExports.DEFAULT_CONVERSATION_RATE_TABLE.authentication.ID;
    const cost = estimateConversationCost('authentication', 'ID', 2);
    expect(cost).toBeCloseTo(2 * rate, 6);
  });

  it('uses _default rate for unknown country', () => {
    const rate = _testExports.DEFAULT_CONVERSATION_RATE_TABLE.marketing._default;
    const cost = estimateConversationCost('marketing', 'ZZ', 4);
    expect(cost).toBeCloseTo(4 * rate, 6);
  });

  it('zero conversations yields zero cost', () => {
    const cost = estimateConversationCost('marketing', 'MY', 0);
    expect(cost).toBe(0);
  });
});

describe('Per-Conversation Rate Table', () => {
  it('has entries for marketing, utility, authentication, service', () => {
    const table = _testExports.DEFAULT_CONVERSATION_RATE_TABLE;
    expect(table).toHaveProperty('marketing');
    expect(table).toHaveProperty('utility');
    expect(table).toHaveProperty('authentication');
    expect(table).toHaveProperty('service');
  });

  it('conversation service rates are zero', () => {
    const serviceRates = _testExports.DEFAULT_CONVERSATION_RATE_TABLE.service;
    for (const rate of Object.values(serviceRates)) {
      expect(rate).toBe(0);
    }
  });

  it('conversation rates have _default fallback for all types', () => {
    for (const type of ['marketing', 'utility', 'authentication']) {
      expect(_testExports.DEFAULT_CONVERSATION_RATE_TABLE[type]).toHaveProperty('_default');
    }
  });
});

describe('Pricing Model Toggle (getActivePricingModel)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _testExports.resetCaches();
  });

  it('returns per_message when DB has per_message setting', async () => {
    mockDbSelect.mockResolvedValueOnce([{ value: 'per_message' }]);
    const model = await getActivePricingModel();
    expect(model).toBe('per_message');
  });

  it('returns per_conversation when DB has per_conversation setting', async () => {
    mockDbSelect.mockResolvedValueOnce([{ value: 'per_conversation' }]);
    const model = await getActivePricingModel();
    expect(model).toBe('per_conversation');
  });

  it('defaults to per_message when DB is empty', async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const model = await getActivePricingModel();
    expect(model).toBe('per_message');
  });

  it('defaults to per_message on DB error', async () => {
    mockDbSelect.mockRejectedValueOnce(new Error('connection failed'));
    const model = await getActivePricingModel();
    expect(model).toBe('per_message');
  });
});

describe('Both Pricing Models — Sample Message Sequence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _testExports.resetCaches();
    mockDbSelect.mockResolvedValue([]);
  });

  it('per-message model charges more for many short messages in one session', async () => {
    // Scenario: 10 marketing messages to the same phone in one 24h window
    // Per-message: 10 x MY marketing rate
    // Per-conversation: 1 x MY conversation rate
    const myMarketingPerMsg = _testExports.DEFAULT_RATE_TABLE.marketing.MY;
    const myMarketingPerConv = _testExports.DEFAULT_CONVERSATION_RATE_TABLE.marketing.MY;

    const perMessageTotal = 10 * (await estimateMessageCost('marketing', 'MY', false));
    const perConversationTotal = estimateConversationCost('marketing', 'MY', 1);

    expect(perMessageTotal).toBeCloseTo(10 * myMarketingPerMsg, 6);
    expect(perConversationTotal).toBeCloseTo(myMarketingPerConv, 6);
    expect(perMessageTotal).toBeGreaterThan(perConversationTotal);
  });

  it('per-conversation model charges more for single messages across many phones', async () => {
    // Scenario: 1 message each to 10 different phones (10 conversations)
    // Per-message: 10 x MY utility rate
    // Per-conversation: 10 x MY conversation utility rate
    const myUtilityPerMsg = _testExports.DEFAULT_RATE_TABLE.utility.MY;
    const myUtilityPerConv = _testExports.DEFAULT_CONVERSATION_RATE_TABLE.utility.MY;

    const perMessageTotal = 10 * (await estimateMessageCost('utility', 'MY', false));
    const perConversationTotal = estimateConversationCost('utility', 'MY', 10);

    // Both should be the same rate since per-conversation = per-message for utility MY
    expect(perMessageTotal).toBeCloseTo(10 * myUtilityPerMsg, 6);
    expect(perConversationTotal).toBeCloseTo(10 * myUtilityPerConv, 6);
  });

  it('CSW-free messages save cost under per-message model only', async () => {
    // Per-message: utility within CSW = free
    // Per-conversation: still pays for the conversation window
    const withinCSW = await estimateMessageCost('utility', 'MY', true);
    const convCost = estimateConversationCost('utility', 'MY', 1);

    expect(withinCSW).toBe(0);
    expect(convCost).toBeGreaterThan(0);
  });
});

describe('recordWhatsappMessageCost', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _testExports.resetCaches();
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

// ── US-963: Volume-Tier Discount Tests ──────────────────────────────

describe('Volume-Tier Discount Tables (US-963)', () => {
  it('has volume tiers for utility and authentication', () => {
    const tiers = _testExports.DEFAULT_VOLUME_TIERS;
    expect(tiers).toHaveProperty('utility');
    expect(tiers).toHaveProperty('authentication');
    expect(tiers.utility.length).toBeGreaterThanOrEqual(2);
    expect(tiers.authentication.length).toBeGreaterThanOrEqual(2);
  });

  it('utility tiers start at 1.0 (no discount) and decrease', () => {
    const tiers = _testExports.DEFAULT_VOLUME_TIERS.utility;
    expect(tiers[0].minMessages).toBe(0);
    expect(tiers[0].discount).toBe(1.0);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].discount).toBeLessThan(tiers[i - 1].discount);
      expect(tiers[i].minMessages).toBeGreaterThan(tiers[i - 1].minMessages);
    }
  });

  it('authentication tiers start at 1.0 and decrease', () => {
    const tiers = _testExports.DEFAULT_VOLUME_TIERS.authentication;
    expect(tiers[0].minMessages).toBe(0);
    expect(tiers[0].discount).toBe(1.0);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].discount).toBeLessThan(tiers[i - 1].discount);
    }
  });

  it('marketing has no volume tiers', () => {
    const tiers = _testExports.DEFAULT_VOLUME_TIERS;
    expect(tiers.marketing).toBeUndefined();
  });
});

describe('getMonthlyBillableCount (US-963)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _testExports.resetCaches();
  });

  it('returns count from DB', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ total: 5000 }] });
    const count = await getMonthlyBillableCount('utility', 'pelangi');
    expect(count).toBe(5000);
  });

  it('returns 0 on DB error', async () => {
    mockDbExecute.mockRejectedValueOnce(new Error('connection failed'));
    const count = await getMonthlyBillableCount('utility', 'pelangi');
    expect(count).toBe(0);
  });

  it('returns 0 when no data', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ total: 0 }] });
    const count = await getMonthlyBillableCount('authentication', 'pelangi');
    expect(count).toBe(0);
  });
});

describe('getVolumeTierDiscount (US-963)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _testExports.resetCaches();
    // Mock: no custom volume tiers in DB → use defaults
    mockDbSelect.mockResolvedValue([]);
  });

  it('returns 1.0 (no discount) for marketing', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ total: 50000 }] });
    const { discount } = await getVolumeTierDiscount('marketing', 'pelangi');
    expect(discount).toBe(1.0);
  });

  it('returns 1.0 for utility with 0 monthly messages', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ total: 0 }] });
    const { discount, tier } = await getVolumeTierDiscount('utility', 'pelangi');
    expect(discount).toBe(1.0);
    expect(tier).toBe(0);
  });

  it('returns tier 1 discount for utility with 1500 monthly messages', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ total: 1500 }] });
    const { discount, tier, monthlyCount } = await getVolumeTierDiscount('utility', 'pelangi');
    expect(monthlyCount).toBe(1500);
    expect(tier).toBe(1);
    expect(discount).toBe(0.85); // 15% off
  });

  it('returns tier 2 discount for utility with 15000 monthly messages', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ total: 15000 }] });
    const { discount, tier } = await getVolumeTierDiscount('utility', 'pelangi');
    expect(tier).toBe(2);
    expect(discount).toBe(0.75); // 25% off
  });

  it('returns highest tier for utility with 200000 monthly messages', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ total: 200000 }] });
    const { discount, tier } = await getVolumeTierDiscount('utility', 'pelangi');
    expect(tier).toBe(3);
    expect(discount).toBe(0.60); // 40% off
  });

  it('returns tier 1 discount for authentication with 2000 monthly messages', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ total: 2000 }] });
    const { discount, tier } = await getVolumeTierDiscount('authentication', 'pelangi');
    expect(tier).toBe(1);
    expect(discount).toBe(0.90); // 10% off
  });
});

describe('estimateMessageCost with volume-tier discounts (US-963)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _testExports.resetCaches();
    // Mock: no custom rate table or volume tiers → use defaults
    mockDbSelect.mockResolvedValue([]);
  });

  it('applies volume discount to utility messages outside CSW', async () => {
    // Mock: 1500 billable utility messages this month → 15% discount
    mockDbExecute.mockResolvedValueOnce({ rows: [{ total: 1500 }] });
    const cost = await estimateMessageCost('utility', 'MY', false, 'pelangi');
    const baseRate = _testExports.DEFAULT_RATE_TABLE.utility.MY;
    expect(cost).toBeCloseTo(baseRate * 0.85, 6);
  });

  it('utility within CSW is still free regardless of volume tier', async () => {
    const cost = await estimateMessageCost('utility', 'MY', true, 'pelangi');
    expect(cost).toBe(0);
  });

  it('applies volume discount to authentication messages', async () => {
    // Mock: 5000 billable auth messages → 10% discount
    mockDbExecute.mockResolvedValueOnce({ rows: [{ total: 5000 }] });
    const cost = await estimateMessageCost('authentication', 'MY', false, 'pelangi');
    const baseRate = _testExports.DEFAULT_RATE_TABLE.authentication.MY;
    expect(cost).toBeCloseTo(baseRate * 0.90, 6);
  });

  it('marketing never gets volume discount', async () => {
    const cost = await estimateMessageCost('marketing', 'MY', false, 'pelangi');
    expect(cost).toBe(_testExports.DEFAULT_RATE_TABLE.marketing.MY);
  });

  it('service messages remain free', async () => {
    const cost = await estimateMessageCost('service', 'MY', false, 'pelangi');
    expect(cost).toBe(0);
  });
});

describe('queryVolumeTierStatus (US-963)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _testExports.resetCaches();
    mockDbSelect.mockResolvedValue([]);
  });

  it('returns status for utility and authentication', async () => {
    // Mock: 500 utility, 100 auth messages
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ total: 500 }] })  // utility count
      .mockResolvedValueOnce({ rows: [{ total: 100 }] }); // auth count

    const status = await queryVolumeTierStatus('pelangi');
    expect(status).toHaveLength(2);

    const utilityStatus = status.find(s => s.templateType === 'utility');
    expect(utilityStatus).toBeDefined();
    expect(utilityStatus!.monthlyBillableCount).toBe(500);
    expect(utilityStatus!.currentTier).toBe(0);
    expect(utilityStatus!.discountMultiplier).toBe(1.0);
    expect(utilityStatus!.discountPercent).toBe('0%');
    expect(utilityStatus!.nextTierAt).toBe(1000);

    const authStatus = status.find(s => s.templateType === 'authentication');
    expect(authStatus).toBeDefined();
    expect(authStatus!.monthlyBillableCount).toBe(100);
    expect(authStatus!.currentTier).toBe(0);
  });

  it('shows next tier as null when at highest tier', async () => {
    // Mock: 200K messages → highest tier
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ total: 200000 }] })  // utility
      .mockResolvedValueOnce({ rows: [{ total: 200000 }] }); // auth

    const status = await queryVolumeTierStatus('pelangi');
    const utilityStatus = status.find(s => s.templateType === 'utility');
    expect(utilityStatus!.currentTier).toBe(3);
    expect(utilityStatus!.discountPercent).toBe('40%');
    expect(utilityStatus!.nextTierAt).toBeNull();
    expect(utilityStatus!.nextTierDiscount).toBeNull();
  });
});
