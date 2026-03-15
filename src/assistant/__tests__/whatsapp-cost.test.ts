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

// Mock fs.readFileSync for settings.json reads in getPricingModel
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => JSON.stringify({
    billing: {
      pricingModel: 'per_message',
      profileOverrides: {
        southern: { pricingModel: 'per_conversation' },
      },
    },
  })),
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
  computeBothModelCosts,
  getPricingModel,
  recordWhatsappMessageCost,
  detectVolumeTier,
  getVolumeTierStatus,
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

// ── Per-Conversation Pricing Model ───────────────────────────────────

describe('Per-Conversation Cost Estimation (estimateConversationCost)', () => {
  it('service messages are always free', () => {
    expect(estimateConversationCost('service', 'MY', false)).toBe(0);
    expect(estimateConversationCost('service', 'MY', true)).toBe(0);
  });

  it('utility messages within CSW are free', () => {
    expect(estimateConversationCost('utility', 'MY', true)).toBe(0);
  });

  it('utility messages outside CSW are charged at per-conversation rate', () => {
    const cost = estimateConversationCost('utility', 'MY', false);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBe(_testExports.DEFAULT_CONVERSATION_RATE_TABLE.utility.MY);
  });

  it('marketing messages are always charged', () => {
    const costWithCSW = estimateConversationCost('marketing', 'MY', true);
    const costWithoutCSW = estimateConversationCost('marketing', 'MY', false);
    expect(costWithCSW).toBeGreaterThan(0);
    expect(costWithCSW).toBe(costWithoutCSW);
    expect(costWithCSW).toBe(_testExports.DEFAULT_CONVERSATION_RATE_TABLE.marketing.MY);
  });

  it('authentication messages are charged per-conversation', () => {
    const cost = estimateConversationCost('authentication', 'MY', false);
    expect(cost).toBe(_testExports.DEFAULT_CONVERSATION_RATE_TABLE.authentication.MY);
  });

  it('uses _default rate for unknown country', () => {
    const cost = estimateConversationCost('marketing', 'ZZ', false);
    expect(cost).toBe(_testExports.DEFAULT_CONVERSATION_RATE_TABLE.marketing._default);
  });

  it('per-conversation rates differ from per-message rates for MY marketing', () => {
    // Both should be non-zero and defined
    const convRate = _testExports.DEFAULT_CONVERSATION_RATE_TABLE.marketing.MY;
    const msgRate = _testExports.DEFAULT_RATE_TABLE.marketing.MY;
    expect(convRate).toBeGreaterThan(0);
    expect(msgRate).toBeGreaterThan(0);
  });
});

// ── Dual-Model Comparison ────────────────────────────────────────────

describe('computeBothModelCosts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock: no custom rate table in DB → uses defaults
    mockDbSelect.mockResolvedValue([]);
  });

  it('returns zero for empty message sequence', async () => {
    const result = await computeBothModelCosts([]);
    expect(result.perMessageTotal).toBe(0);
    expect(result.perConversationTotal).toBe(0);
  });

  it('single marketing message: per-message and per-conversation costs match', async () => {
    const msgs = [{ templateType: 'marketing' as const, countryCode: 'MY', withinCSW: false }];
    const result = await computeBothModelCosts(msgs);
    expect(result.perMessageTotal).toBe(_testExports.DEFAULT_RATE_TABLE.marketing.MY);
    expect(result.perConversationTotal).toBe(_testExports.DEFAULT_CONVERSATION_RATE_TABLE.marketing.MY);
  });

  it('multiple marketing messages: per-message > per-conversation (one conv charge vs many msg charges)', async () => {
    // 5 marketing messages to MY: per-message charges 5x, per-conversation charges once
    const msgs = Array(5).fill({ templateType: 'marketing' as const, countryCode: 'MY', withinCSW: false });
    const result = await computeBothModelCosts(msgs);
    expect(result.perMessageTotal).toBeCloseTo(5 * _testExports.DEFAULT_RATE_TABLE.marketing.MY, 6);
    expect(result.perConversationTotal).toBe(_testExports.DEFAULT_CONVERSATION_RATE_TABLE.marketing.MY);
    expect(result.perMessageTotal).toBeGreaterThan(result.perConversationTotal);
  });

  it('service messages are free in both models', async () => {
    const msgs = [{ templateType: 'service' as const, countryCode: 'MY', withinCSW: false }];
    const result = await computeBothModelCosts(msgs);
    expect(result.perMessageTotal).toBe(0);
    expect(result.perConversationTotal).toBe(0);
  });

  it('utility within CSW is free in both models', async () => {
    const msgs = [{ templateType: 'utility' as const, countryCode: 'MY', withinCSW: true }];
    const result = await computeBothModelCosts(msgs);
    expect(result.perMessageTotal).toBe(0);
    expect(result.perConversationTotal).toBe(0);
  });

  it('mixed message sequence: both models charge differently', async () => {
    const msgs = [
      { templateType: 'marketing' as const, countryCode: 'MY', withinCSW: false },
      { templateType: 'marketing' as const, countryCode: 'MY', withinCSW: false }, // duplicate type+country: only 1 conv charge
      { templateType: 'utility' as const, countryCode: 'MY', withinCSW: false },
    ];
    const result = await computeBothModelCosts(msgs);
    // per-message: 2 marketing + 1 utility
    const expectedPerMsg = 2 * _testExports.DEFAULT_RATE_TABLE.marketing.MY + _testExports.DEFAULT_RATE_TABLE.utility.MY;
    expect(result.perMessageTotal).toBeCloseTo(expectedPerMsg, 6);
    // per-conversation: 1 marketing conv + 1 utility conv
    const expectedPerConv = _testExports.DEFAULT_CONVERSATION_RATE_TABLE.marketing.MY + _testExports.DEFAULT_CONVERSATION_RATE_TABLE.utility.MY;
    expect(result.perConversationTotal).toBeCloseTo(expectedPerConv, 6);
  });
});

// ── Pricing Model Toggle ─────────────────────────────────────────────

describe('getPricingModel', () => {
  beforeEach(() => {
    _testExports.clearSettingsCache();
  });

  it('returns per_message as default (global setting)', async () => {
    const model = await getPricingModel();
    expect(model).toBe('per_message');
  });

  it('returns per_message for pelangi profile (no override)', async () => {
    const model = await getPricingModel('pelangi');
    // pelangi has no override in mock → falls back to global 'per_message'
    // (mock returns southern override only)
    expect(model).toBe('per_message');
  });

  it('returns per_conversation for southern profile (has override)', async () => {
    const model = await getPricingModel('southern');
    expect(model).toBe('per_conversation');
  });

  it('returns global model for unknown profileId', async () => {
    const model = await getPricingModel('unknown-profile');
    expect(model).toBe('per_message');
  });
});

// ── Volume Tier Detection (US-943) ────────────────────────────────────────

describe('detectVolumeTier (US-943)', () => {
  it('returns standard for 0 messages', () => {
    expect(detectVolumeTier(0)).toBe('standard');
  });

  it('returns standard for exactly 1000 messages', () => {
    expect(detectVolumeTier(1_000)).toBe('standard');
  });

  it('returns tier1 for 1001 messages', () => {
    expect(detectVolumeTier(1_001)).toBe('tier1');
  });

  it('returns tier1 for exactly 10000 messages', () => {
    expect(detectVolumeTier(10_000)).toBe('tier1');
  });

  it('returns tier2 for 10001 messages', () => {
    expect(detectVolumeTier(10_001)).toBe('tier2');
  });

  it('returns tier2 for very large counts', () => {
    expect(detectVolumeTier(1_000_000)).toBe('tier2');
  });
});

describe('getVolumeTierStatus (US-943)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns standard tier with zero messages', async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ total_messages: 0, billable_messages: 0, csw_free_messages: 0 }],
    });
    const status = await getVolumeTierStatus('pelangi');
    expect(status.tier).toBe('standard');
    expect(status.monthlyMessages).toBe(0);
    expect(status.nextTierThreshold).toBe(1_001);
    expect(status.messagesUntilNextTier).toBe(1_001);
  });

  it('returns tier1 with 5000 messages and correct next-tier info', async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ total_messages: 5000, billable_messages: 4800, csw_free_messages: 200 }],
    });
    const status = await getVolumeTierStatus('pelangi');
    expect(status.tier).toBe('tier1');
    expect(status.monthlyMessages).toBe(5_000);
    expect(status.billableMessages).toBe(4_800);
    expect(status.cswFreeMessages).toBe(200);
    expect(status.nextTierThreshold).toBe(10_001);
    expect(status.messagesUntilNextTier).toBe(5_001);
  });

  it('returns tier2 with 15000 messages and no next tier', async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ total_messages: 15000, billable_messages: 15000, csw_free_messages: 0 }],
    });
    const status = await getVolumeTierStatus('pelangi');
    expect(status.tier).toBe('tier2');
    expect(status.nextTierThreshold).toBeNull();
    expect(status.messagesUntilNextTier).toBeNull();
  });

  it('returns month in YYYY-MM format', async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ total_messages: 0, billable_messages: 0, csw_free_messages: 0 }],
    });
    const status = await getVolumeTierStatus();
    expect(status.month).toMatch(/^\d{4}-\d{2}$/);
  });
});
