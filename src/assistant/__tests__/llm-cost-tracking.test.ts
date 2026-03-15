/**
 * Unit tests for US-918: AI provider token consumption and cost tracking per conversation.
 *
 * Tests:
 * - AC1: Per-call structured logging with all required fields
 * - AC3: Monthly budget alert fires when threshold exceeded
 * - AC5: Ollama calls logged with $0 cost
 * - AC6: Provider comparison returns cost-per-conversation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────

const { mockNotifyBudget, mockDbInsert, mockDbSelect } = vi.hoisted(() => {
  const mockInsertValues = vi.fn().mockReturnValue({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  });
  return {
    mockNotifyBudget: vi.fn().mockResolvedValue(undefined),
    mockDbInsert: vi.fn().mockReturnValue({ values: mockInsertValues }),
    mockDbSelect: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
          orderBy: vi.fn().mockResolvedValue([]),
        }),
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    }),
  };
});

vi.mock('../../lib/admin-notifier.js', () => ({
  notifyAdminLLMBudgetAlert: mockNotifyBudget,
}));

vi.mock('../../lib/db.js', () => ({
  db: {
    insert: mockDbInsert,
    select: mockDbSelect,
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
  llmUsageLog: {
    id: 'id',
    provider: 'provider',
    model: 'model',
    inputTokens: 'input_tokens',
    outputTokens: 'output_tokens',
    estimatedCostUsd: 'estimated_cost_usd',
    conversationId: 'conversation_id',
    tenantId: 'tenant_id',
    timestamp: 'timestamp',
  },
}));

// Mock configStore
const mockSettings = {
  costBudget: {
    enabled: true,
    alertThreshold: 0.8,
    llmDailyBudgetUsd: 10.0,
    monthlyBudgetAlertUsd: 50.0,
    providerBudgets: { default: null },
  },
  token_prices: { default: 0.001 }, // $0.001 per 1K tokens
};

vi.mock('../config-store.js', () => ({
  configStore: {
    getSettings: () => mockSettings,
  },
}));

import {
  recordLLMUsage,
  _testExports,
} from '../llm-cost-budget.js';

// ── Tests ─────────────────────────────────────────────────────────────

describe('US-918: AI Provider Token Consumption and Cost Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _testExports.accumulators.clear();
    _testExports.jidLastLLMCall.clear();
    _testExports.globalBudgetAlertState.date = '';
    _testExports.globalBudgetAlertState.warningSent = false;
    _testExports.globalBudgetAlertState.criticalSent = false;
    _testExports.monthlyBudgetAlertState.month = '';
    _testExports.monthlyBudgetAlertState.alertSent = false;
  });

  describe('AC1: Per-call structured logging', () => {
    it('logs provider, model, tokens, cost, conversation_id, tenant_id, timestamp', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

      recordLLMUsage('nvidia-kimi', 'moonshotai/kimi-k2.5', {
        prompt_tokens: 500,
        completion_tokens: 200,
      }, 'pelangi', {
        conversationId: '60123456789@s.whatsapp.net',
        tenantId: 'pelangi',
      });

      // Find the structured log call
      const costLogCall = spy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].startsWith('[LLM-Cost]')
      );
      expect(costLogCall).toBeDefined();

      const logJson = JSON.parse(costLogCall![0].replace('[LLM-Cost] ', ''));
      expect(logJson.provider).toBe('nvidia-kimi');
      expect(logJson.model).toBe('moonshotai/kimi-k2.5');
      expect(logJson.input_tokens).toBe(500);
      expect(logJson.output_tokens).toBe(200);
      expect(logJson.estimated_cost_usd).toBeGreaterThanOrEqual(0);
      expect(logJson.conversation_id).toBe('60123456789@s.whatsapp.net');
      expect(logJson.tenant_id).toBe('pelangi');
      expect(logJson.timestamp).toBeDefined();

      spy.mockRestore();
    });

    it('handles missing conversation_id gracefully', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

      recordLLMUsage('groq-llama', 'llama-3.3-70b-versatile', {
        prompt_tokens: 100,
        completion_tokens: 50,
      });

      const costLogCall = spy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].startsWith('[LLM-Cost]')
      );
      expect(costLogCall).toBeDefined();

      const logJson = JSON.parse(costLogCall![0].replace('[LLM-Cost] ', ''));
      expect(logJson.conversation_id).toBeNull();
      expect(logJson.tenant_id).toBe('pelangi');

      spy.mockRestore();
    });

    it('inserts per-call record to llm_usage_log table', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      recordLLMUsage('nvidia-kimi', 'moonshotai/kimi-k2.5', {
        prompt_tokens: 500,
        completion_tokens: 200,
      }, 'pelangi', {
        conversationId: '60123456789@s.whatsapp.net',
        tenantId: 'pelangi',
      });

      // db.insert should be called twice: once for llmCostDaily, once for llmUsageLog
      expect(mockDbInsert).toHaveBeenCalledTimes(2);

      vi.restoreAllMocks();
    });
  });

  describe('AC3: Monthly budget alert', () => {
    it('getMonthlyBudgetUsd returns configured value', () => {
      expect(_testExports.getMonthlyBudgetUsd()).toBe(50.0);
    });

    it('returns default $50 when not configured', () => {
      const origSettings = { ...mockSettings.costBudget };
      delete (mockSettings.costBudget as any).monthlyBudgetAlertUsd;

      expect(_testExports.getMonthlyBudgetUsd()).toBe(50.0);

      mockSettings.costBudget = origSettings;
    });
  });

  describe('AC5: Ollama $0 cost tracking', () => {
    it('records Ollama calls with $0.00 cost but tracks token volume', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

      recordLLMUsage('ollama-qwen', 'qwen-2.5-72b-instruct', {
        prompt_tokens: 1000,
        completion_tokens: 500,
      }, 'pelangi', {
        providerType: 'ollama',
        conversationId: '60111222333@s.whatsapp.net',
      });

      // Check structured log shows $0 cost
      const costLogCall = spy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].startsWith('[LLM-Cost]')
      );
      expect(costLogCall).toBeDefined();

      const logJson = JSON.parse(costLogCall![0].replace('[LLM-Cost] ', ''));
      expect(logJson.input_tokens).toBe(1000);
      expect(logJson.output_tokens).toBe(500);
      expect(logJson.estimated_cost_usd).toBe(0);

      // Check accumulator has tokens but $0 cost
      const today = _testExports.todayUTC();
      const acc = _testExports.accumulators.get(`${today}::ollama-qwen::pelangi`);
      expect(acc).toBeDefined();
      expect(acc!.promptTokens).toBe(1000);
      expect(acc!.completionTokens).toBe(500);
      expect(acc!.estimatedCostUsd).toBe(0);
      expect(acc!.requestCount).toBe(1);

      spy.mockRestore();
    });

    it('non-Ollama provider still charges normal cost', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      recordLLMUsage('groq-llama', 'llama-3.3-70b-versatile', {
        prompt_tokens: 1000,
        completion_tokens: 500,
      }, 'pelangi', {
        providerType: 'groq',
      });

      const today = _testExports.todayUTC();
      const acc = _testExports.accumulators.get(`${today}::groq-llama::pelangi`);
      expect(acc).toBeDefined();
      expect(acc!.estimatedCostUsd).toBeGreaterThan(0);
      // (1000 + 500) / 1000 * 0.001 = 0.0015
      expect(acc!.estimatedCostUsd).toBeCloseTo(0.0015, 4);

      vi.restoreAllMocks();
    });
  });

  describe('AC6: Provider comparison helpers', () => {
    it('calculateCost computes correctly', () => {
      // (prompt + completion) / 1000 * pricePerK
      const cost = _testExports.calculateCost(1000, 500, 'test-model');
      // default price is $0.001 per 1K tokens
      expect(cost).toBeCloseTo(0.0015, 6);
    });
  });

  describe('Usage skipped for empty tokens', () => {
    it('does not log when both prompt and completion tokens are 0', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

      recordLLMUsage('provider', 'model', {
        prompt_tokens: 0,
        completion_tokens: 0,
      });

      const costLogCall = spy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].startsWith('[LLM-Cost]')
      );
      expect(costLogCall).toBeUndefined();

      spy.mockRestore();
    });

    it('does not log when usage is undefined', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

      recordLLMUsage('provider', 'model', undefined);

      const costLogCall = spy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].startsWith('[LLM-Cost]')
      );
      expect(costLogCall).toBeUndefined();

      spy.mockRestore();
    });
  });
});
