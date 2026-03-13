/**
 * llm-cost-budget.ts — Per-provider daily LLM cost budget tracking (US-433)
 *
 * Tracks cumulative token spend per provider per day (UTC).
 * When daily spend reaches 80% of budget cap → logs alert.
 * When daily spend reaches 100% → blocks that provider (fallback chain skips it).
 */
import { db } from '../lib/db.js';
import { llmCostDaily } from '../../shared/schema-tables.js';
import { sql, eq, and } from 'drizzle-orm';
import { configStore } from './config-store.js';

// ─── In-memory accumulator (fast path, flushed to DB periodically) ───

interface DailyAccumulator {
  date: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  requestCount: number;
  alertedAt80: boolean;
  budgetBreached: boolean;
}

/** Key: `${date}::${providerId}::${profileId}` */
const accumulators = new Map<string, DailyAccumulator>();

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function accKey(providerId: string, profileId: string, date?: string): string {
  return `${date || todayUTC()}::${providerId}::${profileId}`;
}

function getOrCreateAccumulator(providerId: string, profileId: string): DailyAccumulator {
  const date = todayUTC();
  const key = accKey(providerId, profileId, date);
  let acc = accumulators.get(key);
  if (!acc || acc.date !== date) {
    acc = {
      date,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
      requestCount: 0,
      alertedAt80: false,
      budgetBreached: false,
    };
    accumulators.set(key, acc);
  }
  return acc;
}

// ─── Budget Config Helpers ──────────────────────────────────────────

interface CostBudgetConfig {
  enabled: boolean;
  alertThreshold: number;
  providerBudgets: Record<string, number | null>;
}

function getCostBudgetConfig(): CostBudgetConfig {
  const settings = configStore.getSettings() as any;
  const cfg = settings.costBudget;
  if (!cfg || typeof cfg !== 'object') {
    return { enabled: false, alertThreshold: 0.8, providerBudgets: {} };
  }
  return {
    enabled: cfg.enabled !== false,
    alertThreshold: typeof cfg.alertThreshold === 'number' ? cfg.alertThreshold : 0.8,
    providerBudgets: cfg.providerBudgets || {},
  };
}

function getProviderBudget(providerId: string): number | null {
  const cfg = getCostBudgetConfig();
  if (!cfg.enabled) return null;
  const budget = cfg.providerBudgets[providerId];
  if (typeof budget === 'number' && budget > 0) return budget;
  const defaultBudget = cfg.providerBudgets['default'];
  if (typeof defaultBudget === 'number' && defaultBudget > 0) return defaultBudget;
  return null; // unlimited
}

// ─── Token Pricing ──────────────────────────────────────────────────

function getTokenPrice(model: string): number {
  const settings = configStore.getSettings() as any;
  const prices: Record<string, number> = settings.token_prices || {};
  return prices[model] ?? prices.default ?? 0.0001;
}

function calculateCost(promptTokens: number, completionTokens: number, model: string): number {
  const pricePerK = getTokenPrice(model);
  return ((promptTokens + completionTokens) / 1000) * pricePerK;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Check if a provider is over its daily budget.
 * Called BEFORE making an LLM request in the fallback chain.
 */
export function isProviderOverBudget(providerId: string, profileId: string = 'pelangi'): boolean {
  const budget = getProviderBudget(providerId);
  if (budget === null) return false; // unlimited

  const acc = getOrCreateAccumulator(providerId, profileId);
  return acc.estimatedCostUsd >= budget;
}

/**
 * Record token usage after a successful LLM call.
 * Updates in-memory accumulator and fires async DB upsert.
 */
export function recordLLMUsage(
  providerId: string,
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined,
  profileId: string = 'pelangi'
): void {
  if (!usage) return;

  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  if (promptTokens === 0 && completionTokens === 0) return;

  const cost = calculateCost(promptTokens, completionTokens, model);
  const acc = getOrCreateAccumulator(providerId, profileId);

  acc.promptTokens += promptTokens;
  acc.completionTokens += completionTokens;
  acc.estimatedCostUsd += cost;
  acc.requestCount += 1;

  // Check budget thresholds
  const budget = getProviderBudget(providerId);
  if (budget !== null && budget > 0) {
    const ratio = acc.estimatedCostUsd / budget;
    const cfg = getCostBudgetConfig();

    if (ratio >= 1.0 && !acc.budgetBreached) {
      acc.budgetBreached = true;
      console.warn(`[CostBudget] 🚫 Provider ${providerId} OVER BUDGET: $${acc.estimatedCostUsd.toFixed(4)} / $${budget.toFixed(4)} — blocking for today`);
    } else if (ratio >= cfg.alertThreshold && !acc.alertedAt80) {
      acc.alertedAt80 = true;
      console.warn(`[CostBudget] ⚠️  Provider ${providerId} at ${(ratio * 100).toFixed(0)}% of daily budget: $${acc.estimatedCostUsd.toFixed(4)} / $${budget.toFixed(4)}`);
    }
  }

  // Fire-and-forget DB upsert
  flushToDb(providerId, profileId, acc, budget).catch(err => {
    console.error(`[CostBudget] DB flush failed for ${providerId}:`, err.message);
  });
}

/**
 * Get daily cost summary for a provider (from in-memory accumulator).
 */
export function getProviderDailyCost(providerId: string, profileId: string = 'pelangi'): {
  date: string;
  estimatedCostUsd: number;
  budgetUsd: number | null;
  budgetUsedPercent: number | null;
  isOverBudget: boolean;
} {
  const acc = getOrCreateAccumulator(providerId, profileId);
  const budget = getProviderBudget(providerId);
  return {
    date: acc.date,
    estimatedCostUsd: acc.estimatedCostUsd,
    budgetUsd: budget,
    budgetUsedPercent: budget !== null ? Math.min((acc.estimatedCostUsd / budget) * 100, 100) : null,
    isOverBudget: acc.budgetBreached,
  };
}

// ─── DB Persistence ─────────────────────────────────────────────────

async function flushToDb(
  providerId: string,
  profileId: string,
  acc: DailyAccumulator,
  budgetCap: number | null
): Promise<void> {
  await db.insert(llmCostDaily).values({
    date: acc.date,
    provider: providerId,
    profileId,
    promptTokens: acc.promptTokens,
    completionTokens: acc.completionTokens,
    estimatedCostUsd: acc.estimatedCostUsd,
    requestCount: acc.requestCount,
    budgetCapUsd: budgetCap,
    budgetBreached: acc.budgetBreached,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [llmCostDaily.date, llmCostDaily.provider, llmCostDaily.profileId],
    set: {
      promptTokens: sql`${llmCostDaily.promptTokens} + excluded.prompt_tokens`,
      completionTokens: sql`${llmCostDaily.completionTokens} + excluded.completion_tokens`,
      estimatedCostUsd: sql`${llmCostDaily.estimatedCostUsd} + excluded.estimated_cost_usd`,
      requestCount: sql`${llmCostDaily.requestCount} + excluded.request_count`,
      budgetCapUsd: budgetCap !== null ? sql`${budgetCap}` : sql`NULL`,
      budgetBreached: sql`${acc.budgetBreached}`,
      updatedAt: sql`NOW()`,
    },
  });
}

/**
 * Load today's accumulated costs from DB into memory (call at startup).
 */
export async function loadTodayCosts(): Promise<void> {
  try {
    const today = todayUTC();
    const rows = await db.select().from(llmCostDaily).where(eq(llmCostDaily.date, today));
    for (const row of rows) {
      const key = accKey(row.provider, row.profileId, today);
      accumulators.set(key, {
        date: today,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        estimatedCostUsd: row.estimatedCostUsd,
        requestCount: row.requestCount,
        alertedAt80: false,
        budgetBreached: row.budgetBreached,
      });
    }
    if (rows.length > 0) {
      console.log(`[CostBudget] Loaded ${rows.length} provider cost records for ${today}`);
    }
  } catch (err: any) {
    console.warn(`[CostBudget] Failed to load today's costs:`, err.message);
  }
}

/**
 * Query historical daily costs from DB (for admin API).
 */
export async function queryDailyCosts(options: {
  date?: string;
  profileId?: string;
  days?: number;
}): Promise<any[]> {
  const conditions: any[] = [];

  if (options.date) {
    conditions.push(eq(llmCostDaily.date, options.date));
  } else if (options.days) {
    const since = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    conditions.push(sql`${llmCostDaily.date} >= ${since}`);
  }

  if (options.profileId) {
    conditions.push(eq(llmCostDaily.profileId, options.profileId));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select().from(llmCostDaily).where(where).orderBy(sql`${llmCostDaily.date} DESC, ${llmCostDaily.estimatedCostUsd} DESC`);

  return rows.map(r => ({
    date: r.date,
    provider: r.provider,
    profileId: r.profileId,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    estimatedCostUsd: r.estimatedCostUsd,
    requestCount: r.requestCount,
    budgetCapUsd: r.budgetCapUsd,
    budgetBreached: r.budgetBreached,
  }));
}
