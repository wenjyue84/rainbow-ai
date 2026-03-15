/**
 * llm-cost-budget.ts — Per-provider daily LLM cost budget tracking (US-433)
 * + Global daily budget alert with per-JID rate limiting (US-903)
 * + Per-call usage logging & monthly budget alert (US-918)
 *
 * Tracks cumulative token spend per provider per day (UTC).
 * When daily spend reaches 80% of budget cap → logs alert.
 * When daily spend reaches 100% → blocks that provider (fallback chain skips it).
 *
 * US-903: Global daily budget across all providers:
 * - 80% → admin warning notification
 * - 100% → admin critical alert + rate-limit LLM calls to 1/30s per JID
 *
 * US-918: Per-call granular logging + monthly budget alert ($50 default):
 * - Every AI call → insert into llm_usage_log with provider, model, tokens, cost, conversation_id, tenant_id
 * - Monthly spend threshold → admin notification when exceeded
 */
import { db } from '../lib/db.js';
import { llmCostDaily, llmUsageLog } from '../../shared/schema-tables.js';
import { sql, eq, and, gte } from 'drizzle-orm';
import { configStore } from './config-store.js';
import { notifyAdminLLMBudgetAlert } from '../lib/admin-notifier.js';

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
  llmDailyBudgetUsd: number;
  providerBudgets: Record<string, number | null>;
}

function getCostBudgetConfig(): CostBudgetConfig {
  const settings = configStore.getSettings() as any;
  const cfg = settings.costBudget;
  if (!cfg || typeof cfg !== 'object') {
    return { enabled: false, alertThreshold: 0.8, llmDailyBudgetUsd: 10.0, providerBudgets: {} };
  }
  return {
    enabled: cfg.enabled !== false,
    alertThreshold: typeof cfg.alertThreshold === 'number' ? cfg.alertThreshold : 0.8,
    llmDailyBudgetUsd: typeof cfg.llmDailyBudgetUsd === 'number' ? cfg.llmDailyBudgetUsd : 10.0,
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

/** Optional context for per-call logging (US-918) */
export interface LLMCallContext {
  conversationId?: string; // phone/JID
  tenantId?: string;       // profile_id
  providerType?: string;   // 'ollama' | 'groq' | 'openai-compatible' | 'google-gemini'
}

/**
 * Record token usage after a successful LLM call.
 * Updates in-memory accumulator, fires async DB upsert to daily table,
 * and logs per-call record to llm_usage_log (US-918 AC1).
 */
export function recordLLMUsage(
  providerId: string,
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined,
  profileId: string = 'pelangi',
  callContext?: LLMCallContext
): void {
  if (!usage) return;

  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  if (promptTokens === 0 && completionTokens === 0) return;

  // US-918 AC5: Ollama (local) calls logged with $0.00 cost
  const cost = callContext?.providerType === 'ollama'
    ? 0
    : calculateCost(promptTokens, completionTokens, model);
  const acc = getOrCreateAccumulator(providerId, profileId);

  acc.promptTokens += promptTokens;
  acc.completionTokens += completionTokens;
  acc.estimatedCostUsd += cost;
  acc.requestCount += 1;

  // US-918 AC1: Structured per-call log
  console.log(`[LLM-Cost] ${JSON.stringify({
    provider: providerId, model, input_tokens: promptTokens,
    output_tokens: completionTokens, estimated_cost_usd: Number(cost.toFixed(6)),
    conversation_id: callContext?.conversationId ?? null,
    tenant_id: callContext?.tenantId ?? profileId,
    timestamp: new Date().toISOString(),
  })}`);

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

  // Fire-and-forget DB upserts (daily aggregate + per-call log)
  flushToDb(providerId, profileId, acc, budget).catch(err => {
    console.error(`[CostBudget] DB flush failed for ${providerId}:`, err.message);
  });

  // US-918 AC1: Per-call record insert
  insertUsageLog(providerId, model, promptTokens, completionTokens, cost, profileId, callContext).catch(err => {
    console.error(`[CostBudget] Usage log insert failed:`, err.message);
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

// ─── US-903: Global Daily Budget Alert ──────────────────────────────

/** Tracks whether global budget warning/critical alerts have fired today */
const globalBudgetAlertState = {
  date: '',
  warningSent: false,
  criticalSent: false,
};

function resetGlobalAlertStateIfNewDay(): void {
  const today = todayUTC();
  if (globalBudgetAlertState.date !== today) {
    globalBudgetAlertState.date = today;
    globalBudgetAlertState.warningSent = false;
    globalBudgetAlertState.criticalSent = false;
  }
}

/**
 * Get total daily cost across ALL providers for the current UTC day.
 */
export function getTotalDailyCostUsd(): number {
  const today = todayUTC();
  let total = 0;
  for (const [key, acc] of accumulators.entries()) {
    if (acc.date === today) {
      total += acc.estimatedCostUsd;
    }
  }
  return total;
}

/**
 * Get global daily budget status (for admin API).
 */
export function getGlobalBudgetStatus(): {
  currentDayUsd: number;
  budgetUsd: number;
  budgetPctUsed: number;
} {
  const cfg = getCostBudgetConfig();
  const currentDayUsd = getTotalDailyCostUsd();
  const budgetUsd = cfg.llmDailyBudgetUsd;
  const budgetPctUsed = budgetUsd > 0 ? Math.min((currentDayUsd / budgetUsd) * 100, 100) : 0;
  return { currentDayUsd, budgetUsd, budgetPctUsed };
}

/**
 * Check global budget thresholds and fire notifications.
 * Called every 30 minutes by setInterval (started via startBudgetAlertInterval).
 */
export async function checkGlobalBudgetThresholds(): Promise<void> {
  const cfg = getCostBudgetConfig();
  if (!cfg.enabled || cfg.llmDailyBudgetUsd <= 0) return;

  resetGlobalAlertStateIfNewDay();

  const currentDayUsd = getTotalDailyCostUsd();
  const ratio = currentDayUsd / cfg.llmDailyBudgetUsd;

  if (ratio >= 1.0 && !globalBudgetAlertState.criticalSent) {
    globalBudgetAlertState.criticalSent = true;
    console.warn(`[CostBudget] CRITICAL: Global daily spend $${currentDayUsd.toFixed(4)} >= budget $${cfg.llmDailyBudgetUsd.toFixed(2)} — rate-limiting LLM calls`);
    notifyAdminLLMBudgetAlert('critical', currentDayUsd, cfg.llmDailyBudgetUsd).catch(() => {});
  } else if (ratio >= cfg.alertThreshold && !globalBudgetAlertState.warningSent) {
    globalBudgetAlertState.warningSent = true;
    console.warn(`[CostBudget] WARNING: Global daily spend at ${(ratio * 100).toFixed(0)}%: $${currentDayUsd.toFixed(4)} / $${cfg.llmDailyBudgetUsd.toFixed(2)}`);
    notifyAdminLLMBudgetAlert('warning', currentDayUsd, cfg.llmDailyBudgetUsd).catch(() => {});
  }
}

// ─── Per-JID Rate Limiting (when global budget is breached) ─────────

/** In-memory token bucket: JID → last allowed timestamp */
const jidLastLLMCall = new Map<string, number>();
const BUDGET_RATE_LIMIT_MS = 30_000; // 1 call per 30 seconds per JID

/**
 * Check if an LLM call for this JID should be rate-limited due to global budget breach.
 * Returns true if the call should be BLOCKED.
 */
export function isJidRateLimited(jid: string): boolean {
  const cfg = getCostBudgetConfig();
  if (!cfg.enabled || cfg.llmDailyBudgetUsd <= 0) return false;

  const currentDayUsd = getTotalDailyCostUsd();
  if (currentDayUsd < cfg.llmDailyBudgetUsd) return false;

  // Budget breached — enforce 1 call per 30s per JID
  const now = Date.now();
  const lastCall = jidLastLLMCall.get(jid) ?? 0;
  if (now - lastCall < BUDGET_RATE_LIMIT_MS) {
    return true; // rate-limited
  }
  jidLastLLMCall.set(jid, now);
  return false; // allowed (token consumed)
}

// ─── Budget Alert Interval ──────────────────────────────────────────

let budgetAlertInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the 30-minute budget check interval.
 * Call once at server startup.
 */
export function startBudgetAlertInterval(): void {
  if (budgetAlertInterval) return; // already running
  const THIRTY_MINUTES_MS = 30 * 60 * 1000;
  budgetAlertInterval = setInterval(() => {
    checkGlobalBudgetThresholds().catch(err => {
      console.error('[CostBudget] Budget check failed:', err.message);
    });
    // US-918 AC3: Monthly budget check
    checkMonthlyBudgetThreshold().catch(err => {
      console.error('[CostBudget] Monthly budget check failed:', err.message);
    });
  }, THIRTY_MINUTES_MS);
  // Don't prevent process exit
  if (budgetAlertInterval.unref) budgetAlertInterval.unref();
  console.log('[CostBudget] Started global budget alert interval (every 30 min)');
}

/**
 * Stop the budget alert interval (for testing/cleanup).
 */
export function stopBudgetAlertInterval(): void {
  if (budgetAlertInterval) {
    clearInterval(budgetAlertInterval);
    budgetAlertInterval = null;
  }
}

// ─── US-918: Per-Call Usage Log ──────────────────────────────────────

async function insertUsageLog(
  providerId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  estimatedCostUsd: number,
  profileId: string,
  callContext?: LLMCallContext
): Promise<void> {
  await db.insert(llmUsageLog).values({
    provider: providerId,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    conversationId: callContext?.conversationId ?? null,
    tenantId: callContext?.tenantId ?? profileId,
    timestamp: new Date(),
  });
}

// ─── US-918 AC3: Monthly Budget Alert ────────────────────────────────

const monthlyBudgetAlertState = {
  month: '',    // YYYY-MM
  alertSent: false,
};

function currentMonthUTC(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function getMonthlyBudgetUsd(): number {
  const settings = configStore.getSettings() as any;
  const val = settings?.costBudget?.monthlyBudgetAlertUsd;
  return typeof val === 'number' && val > 0 ? val : 50.0; // default $50
}

/**
 * Query total monthly spend from llm_cost_daily table.
 */
export async function getMonthlySpendUsd(month?: string): Promise<number> {
  const targetMonth = month || currentMonthUTC();
  const startDate = `${targetMonth}-01`;
  // End date: first of next month
  const [y, m] = targetMonth.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const endDate = `${nextMonth}-01`;

  const result = await db.select({
    total: sql<number>`coalesce(sum(${llmCostDaily.estimatedCostUsd}), 0)`,
  }).from(llmCostDaily).where(
    and(
      sql`${llmCostDaily.date} >= ${startDate}`,
      sql`${llmCostDaily.date} < ${endDate}`,
    )
  );

  return result[0]?.total ?? 0;
}

/**
 * Check monthly budget threshold and fire notification (US-918 AC3).
 * Called alongside daily budget check in the 30-minute interval.
 */
export async function checkMonthlyBudgetThreshold(): Promise<void> {
  const month = currentMonthUTC();
  if (monthlyBudgetAlertState.month !== month) {
    monthlyBudgetAlertState.month = month;
    monthlyBudgetAlertState.alertSent = false;
  }
  if (monthlyBudgetAlertState.alertSent) return;

  const budgetUsd = getMonthlyBudgetUsd();
  if (budgetUsd <= 0) return;

  const spentUsd = await getMonthlySpendUsd(month);
  if (spentUsd >= budgetUsd) {
    monthlyBudgetAlertState.alertSent = true;
    console.warn(`[CostBudget] MONTHLY ALERT: AI spend $${spentUsd.toFixed(2)} >= threshold $${budgetUsd.toFixed(2)} for ${month}`);
    notifyAdminLLMBudgetAlert('critical', spentUsd, budgetUsd).catch(() => {});
  }
}

// ─── US-918 AC6: Provider Comparison Query ──────────────────────────

/**
 * Provider comparison: cost per resolved conversation.
 * Queries llm_usage_log grouped by provider with conversation counts.
 */
export async function queryProviderComparison(days: number = 30): Promise<any[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db.select({
    provider: llmUsageLog.provider,
    model: llmUsageLog.model,
    totalInputTokens: sql<number>`coalesce(sum(${llmUsageLog.inputTokens}), 0)::int`,
    totalOutputTokens: sql<number>`coalesce(sum(${llmUsageLog.outputTokens}), 0)::int`,
    totalCostUsd: sql<number>`coalesce(sum(${llmUsageLog.estimatedCostUsd}), 0)`,
    totalCalls: sql<number>`count(*)::int`,
    uniqueConversations: sql<number>`count(distinct ${llmUsageLog.conversationId})::int`,
  }).from(llmUsageLog)
    .where(gte(llmUsageLog.timestamp, since))
    .groupBy(llmUsageLog.provider, llmUsageLog.model)
    .orderBy(sql`sum(${llmUsageLog.estimatedCostUsd}) DESC`);

  return rows.map(r => ({
    provider: r.provider,
    model: r.model,
    totalInputTokens: r.totalInputTokens,
    totalOutputTokens: r.totalOutputTokens,
    totalCostUsd: Number(Number(r.totalCostUsd).toFixed(6)),
    totalCalls: r.totalCalls,
    uniqueConversations: r.uniqueConversations,
    costPerConversation: r.uniqueConversations > 0
      ? Number((Number(r.totalCostUsd) / r.uniqueConversations).toFixed(6))
      : 0,
  }));
}

// ─── US-918 AC4: CSV Export Query ────────────────────────────────────

/**
 * Query usage log records for CSV export.
 */
export async function queryUsageLogForExport(options: {
  days?: number;
  month?: string;
  tenantId?: string;
}): Promise<any[]> {
  const conditions: any[] = [];

  if (options.month) {
    const startDate = new Date(`${options.month}-01T00:00:00Z`);
    const [y, m] = options.month.split('-').map(Number);
    const nextMonth = m === 12 ? new Date(`${y + 1}-01-01T00:00:00Z`) : new Date(`${y}-${String(m + 1).padStart(2, '0')}-01T00:00:00Z`);
    conditions.push(gte(llmUsageLog.timestamp, startDate));
    conditions.push(sql`${llmUsageLog.timestamp} < ${nextMonth}`);
  } else {
    const d = options.days ?? 30;
    const since = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    conditions.push(gte(llmUsageLog.timestamp, since));
  }

  if (options.tenantId) {
    conditions.push(eq(llmUsageLog.tenantId, options.tenantId));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(llmUsageLog).where(where).orderBy(sql`${llmUsageLog.timestamp} DESC`);
}

// ─── Test Exports ───────────────────────────────────────────────────

export const _testExports = {
  accumulators,
  globalBudgetAlertState,
  monthlyBudgetAlertState,
  jidLastLLMCall,
  resetGlobalAlertStateIfNewDay,
  getCostBudgetConfig,
  todayUTC,
  currentMonthUTC,
  getMonthlyBudgetUsd,
  calculateCost,
};
