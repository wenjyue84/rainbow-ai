/**
 * Unit tests for US-903: LLM provider cost budget alert.
 *
 * Tests:
 * - Warning fires exactly once at 81% of budget
 * - Critical fires at 100% with rate-limiting active
 * - Per-JID rate limiting blocks rapid calls when budget is breached
 * - Budget resets on new UTC day
 * - getGlobalBudgetStatus returns correct fields
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────

const { mockNotifyBudget } = vi.hoisted(() => ({
  mockNotifyBudget: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/admin-notifier.js', () => ({
  notifyAdminLLMBudgetAlert: mockNotifyBudget,
}));

vi.mock('../../lib/db.js', () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: () => ({
      from: () => ({
        where: vi.fn().mockResolvedValue([]),
        orderBy: () => vi.fn().mockResolvedValue([]),
      }),
    }),
  },
  dbReady: Promise.resolve(true),
}));

vi.mock('../../../shared/schema-tables.js', () => ({
  llmCostDaily: {
    date: 'date',
    provider: 'provider',
    profileId: 'profile_id',
    promptTokens: 'prompt_tokens',
    completionTokens: 'completion_tokens',
    estimatedCostUsd: 'estimated_cost_usd',
    requestCount: 'request_count',
    budgetCapUsd: 'budget_cap_usd',
    budgetBreached: 'budget_breached',
  },
}));

// Mock configStore to return our test budget settings
const mockSettings = {
  costBudget: {
    enabled: true,
    alertThreshold: 0.8,
    llmDailyBudgetUsd: 10.0,
    providerBudgets: { default: null },
  },
  token_prices: { default: 0.001 }, // $0.001 per 1K tokens = easy math
};

vi.mock('../config-store.js', () => ({
  configStore: {
    getSettings: () => mockSettings,
  },
}));

import {
  recordLLMUsage,
  getTotalDailyCostUsd,
  getGlobalBudgetStatus,
  checkGlobalBudgetThresholds,
  isJidRateLimited,
  _testExports,
} from '../llm-cost-budget.js';

// ── Tests ─────────────────────────────────────────────────────────────

describe('US-903: LLM Daily Budget Alert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear accumulators
    _testExports.accumulators.clear();
    _testExports.jidLastLLMCall.clear();
    // Reset global alert state
    _testExports.globalBudgetAlertState.date = '';
    _testExports.globalBudgetAlertState.warningSent = false;
    _testExports.globalBudgetAlertState.criticalSent = false;
  });

  describe('checkGlobalBudgetThresholds', () => {
    it('fires warning notification exactly once at 81% of budget', async () => {
      // Budget is $10.00, price is $0.001/1K tokens
      // To hit $8.10 (81%) we need 8,100,000 tokens total
      // recordLLMUsage does (prompt + completion) / 1000 * pricePerK
      // With 4,050,000 prompt + 4,050,000 completion = 8,100,000 total
      // Cost = (8,100,000 / 1000) * 0.001 = $8.10

      recordLLMUsage('provider-a', 'test-model', {
        prompt_tokens: 4_050_000,
        completion_tokens: 4_050_000,
      });

      const totalCost = getTotalDailyCostUsd();
      expect(totalCost).toBeCloseTo(8.1, 1);

      // First check should fire warning
      await checkGlobalBudgetThresholds();
      expect(mockNotifyBudget).toHaveBeenCalledTimes(1);
      expect(mockNotifyBudget).toHaveBeenCalledWith('warning', expect.any(Number), 10.0);

      // Second check should NOT fire again (deduplication)
      await checkGlobalBudgetThresholds();
      expect(mockNotifyBudget).toHaveBeenCalledTimes(1);
    });

    it('fires critical alert at 100% of budget', async () => {
      // $10.00 = 10,000,000 tokens
      recordLLMUsage('provider-a', 'test-model', {
        prompt_tokens: 5_000_000,
        completion_tokens: 5_000_000,
      });

      const totalCost = getTotalDailyCostUsd();
      expect(totalCost).toBeCloseTo(10.0, 1);

      await checkGlobalBudgetThresholds();
      expect(mockNotifyBudget).toHaveBeenCalledTimes(1);
      expect(mockNotifyBudget).toHaveBeenCalledWith('critical', expect.any(Number), 10.0);
    });

    it('does not fire alert below threshold', async () => {
      // $7.00 = 70% — below 80% threshold
      recordLLMUsage('provider-a', 'test-model', {
        prompt_tokens: 3_500_000,
        completion_tokens: 3_500_000,
      });

      await checkGlobalBudgetThresholds();
      expect(mockNotifyBudget).not.toHaveBeenCalled();
    });
  });

  describe('getGlobalBudgetStatus', () => {
    it('returns currentDayUsd, budgetUsd, and budgetPctUsed', () => {
      recordLLMUsage('provider-a', 'test-model', {
        prompt_tokens: 2_500_000,
        completion_tokens: 2_500_000,
      });

      const status = getGlobalBudgetStatus();
      expect(status.budgetUsd).toBe(10.0);
      expect(status.currentDayUsd).toBeCloseTo(5.0, 1);
      expect(status.budgetPctUsed).toBeCloseTo(50.0, 1);
    });

    it('caps budgetPctUsed at 100', () => {
      recordLLMUsage('provider-a', 'test-model', {
        prompt_tokens: 10_000_000,
        completion_tokens: 10_000_000,
      });

      const status = getGlobalBudgetStatus();
      expect(status.budgetPctUsed).toBe(100);
    });
  });

  describe('isJidRateLimited', () => {
    it('does not rate-limit when under budget', () => {
      recordLLMUsage('provider-a', 'test-model', {
        prompt_tokens: 1_000_000,
        completion_tokens: 1_000_000,
      });
      // $2.00 < $10.00 budget
      expect(isJidRateLimited('user@s.whatsapp.net')).toBe(false);
    });

    it('rate-limits when budget breached and JID called recently', () => {
      // Exceed $10 budget
      recordLLMUsage('provider-a', 'test-model', {
        prompt_tokens: 5_500_000,
        completion_tokens: 5_500_000,
      });

      const jid = 'user@s.whatsapp.net';
      // First call is allowed (consumes token)
      expect(isJidRateLimited(jid)).toBe(false);
      // Immediate second call is blocked
      expect(isJidRateLimited(jid)).toBe(true);
    });

    it('allows different JIDs independently when budget breached', () => {
      recordLLMUsage('provider-a', 'test-model', {
        prompt_tokens: 5_500_000,
        completion_tokens: 5_500_000,
      });

      expect(isJidRateLimited('user-a@s.whatsapp.net')).toBe(false);
      expect(isJidRateLimited('user-b@s.whatsapp.net')).toBe(false);
      // But same JID immediately is blocked
      expect(isJidRateLimited('user-a@s.whatsapp.net')).toBe(true);
    });
  });

  describe('budget reset on new day', () => {
    it('resets global alert state when date changes', () => {
      _testExports.globalBudgetAlertState.date = '2026-03-14';
      _testExports.globalBudgetAlertState.warningSent = true;
      _testExports.globalBudgetAlertState.criticalSent = true;

      _testExports.resetGlobalAlertStateIfNewDay();

      // todayUTC() will be different from '2026-03-14'
      const today = _testExports.todayUTC();
      expect(_testExports.globalBudgetAlertState.date).toBe(today);
      expect(_testExports.globalBudgetAlertState.warningSent).toBe(false);
      expect(_testExports.globalBudgetAlertState.criticalSent).toBe(false);
    });
  });

  describe('multi-provider aggregation', () => {
    it('sums costs across multiple providers', () => {
      recordLLMUsage('provider-a', 'test-model', {
        prompt_tokens: 1_500_000,
        completion_tokens: 1_500_000,
      }); // $3.00

      recordLLMUsage('provider-b', 'test-model', {
        prompt_tokens: 2_000_000,
        completion_tokens: 2_000_000,
      }); // $4.00

      expect(getTotalDailyCostUsd()).toBeCloseTo(7.0, 1);
    });
  });
});
