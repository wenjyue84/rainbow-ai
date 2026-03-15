/**
 * whatsapp-cost.ts — WhatsApp cost tracking (US-495, US-845)
 *
 * Tracks outbound message costs under the Meta July 2025 pricing model:
 * - Per-message pricing (not conversation-based)
 * - Template types: marketing, utility, authentication, service
 * - Utility templates within Customer Service Window (CSW) are FREE
 * - Cost varies by template_type + recipient country
 *
 * US-845: Adds per-conversation legacy model estimation for admin comparison.
 * The billing.pricingModel setting toggles which model is active.
 *
 * Architecture mirrors llm-cost-budget.ts: in-memory accumulator + async DB flush.
 */
import { db } from './db.js';
import { whatsappCostDaily, rainbowMessages } from '../../shared/schema-tables.js';
import { appSettings } from '../../shared/schema-tables.js';
import { sql, eq, and } from 'drizzle-orm';

// ─── Types ──────────────────────────────────────────────────────────

export type PricingModel = 'per_conversation' | 'per_message';
export type TemplateType = 'marketing' | 'utility' | 'authentication' | 'service';

export interface WhatsappMessageCostInput {
  phone: string;
  templateType: TemplateType;
  countryCode?: string; // ISO 3166-1 alpha-2, default 'MY'
  profileId?: string;
}

interface CostAccumulator {
  date: string;
  totalMessages: number;
  billableMessages: number;
  cswFreeMessages: number;
  estimatedCostUsd: number;
}

// ─── Default Rate Table (USD per message, July 2025) ────────────────
// Source: https://developers.facebook.com/docs/whatsapp/pricing/
// Only includes countries relevant to this deployment. Stored in app_settings
// as JSON under key 'whatsapp_cost_rate_table' for admin configurability.

const DEFAULT_RATE_TABLE: Record<string, Record<string, number>> = {
  marketing: {
    MY: 0.0732,   // Malaysia
    SG: 0.0516,   // Singapore
    ID: 0.0339,   // Indonesia
    TH: 0.0631,   // Thailand
    PH: 0.0559,   // Philippines
    IN: 0.0158,   // India
    US: 0.0250,   // United States
    _default: 0.0500,
  },
  utility: {
    MY: 0.0200,
    SG: 0.0147,
    ID: 0.0150,
    TH: 0.0150,
    PH: 0.0150,
    IN: 0.0042,
    US: 0.0080,
    _default: 0.0150,
  },
  authentication: {
    MY: 0.0315,
    SG: 0.0226,
    ID: 0.0240,
    TH: 0.0240,
    PH: 0.0240,
    IN: 0.0042,
    US: 0.0135,
    _default: 0.0200,
  },
  service: {
    _default: 0.0000, // Service (session) messages are free
  },
};

// ─── Legacy Per-Conversation Rate Table (US-845) ────────────────────
// Under the old model, one rate covers all messages within a 24h conversation window.
// These are used for comparison display only.

const DEFAULT_CONVERSATION_RATE_TABLE: Record<string, Record<string, number>> = {
  marketing: {
    MY: 0.0732,
    SG: 0.0858,
    ID: 0.0411,
    _default: 0.0600,
  },
  utility: {
    MY: 0.0200,
    SG: 0.0318,
    ID: 0.0150,
    _default: 0.0200,
  },
  authentication: {
    MY: 0.0315,
    SG: 0.0453,
    ID: 0.0240,
    _default: 0.0300,
  },
  service: {
    _default: 0.0000,
  },
};

// ─── Pricing Model ──────────────────────────────────────────────────

let _pricingModelCache: PricingModel | null = null;
let _pricingModelCacheExpiry = 0;
const PRICING_MODEL_CACHE_TTL = 300_000; // 5 min

/**
 * Read the active pricing model from app_settings.
 * Falls back to 'per_message' (July 2025 default).
 */
export async function getActivePricingModel(): Promise<PricingModel> {
  const now = Date.now();
  if (_pricingModelCache && now < _pricingModelCacheExpiry) return _pricingModelCache;

  try {
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, 'billing_pricing_model'));
    if (rows.length > 0 && rows[0].value) {
      const val = rows[0].value;
      if (val === 'per_conversation' || val === 'per_message') {
        _pricingModelCache = val;
        _pricingModelCacheExpiry = now + PRICING_MODEL_CACHE_TTL;
        return val;
      }
    }
  } catch (err: any) {
    console.warn('[WACost] Failed to load pricing model, using default:', err.message);
  }

  _pricingModelCache = 'per_message';
  _pricingModelCacheExpiry = now + PRICING_MODEL_CACHE_TTL;
  return 'per_message';
}

/**
 * Estimate cost under legacy per-conversation model.
 * In per-conversation pricing, you pay once per 24h window per unique phone+category.
 * For estimation from per-message data: cost = uniqueConversations × conversationRate.
 */
export function estimateConversationCost(
  templateType: TemplateType,
  countryCode: string,
  uniqueConversations: number,
): number {
  if (templateType === 'service') return 0;
  const typeRates = DEFAULT_CONVERSATION_RATE_TABLE[templateType] || {};
  const rate = typeRates[countryCode] ?? typeRates['_default'] ?? 0.05;
  return uniqueConversations * rate;
}

// ─── In-memory Accumulator ──────────────────────────────────────────

/** Key: `${date}::${profileId}::${templateType}::${countryCode}` */
const accumulators = new Map<string, CostAccumulator>();

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function accKey(profileId: string, templateType: string, countryCode: string, date?: string): string {
  return `${date || todayUTC()}::${profileId}::${templateType}::${countryCode}`;
}

function getOrCreateAccumulator(profileId: string, templateType: string, countryCode: string): CostAccumulator {
  const date = todayUTC();
  const key = accKey(profileId, templateType, countryCode, date);
  let acc = accumulators.get(key);
  if (!acc || acc.date !== date) {
    acc = { date, totalMessages: 0, billableMessages: 0, cswFreeMessages: 0, estimatedCostUsd: 0 };
    accumulators.set(key, acc);
  }
  return acc;
}

// ─── Rate Table ─────────────────────────────────────────────────────

let _rateTableCache: Record<string, Record<string, number>> | null = null;
let _rateTableCacheExpiry = 0;
const RATE_TABLE_CACHE_TTL = 300_000; // 5 min

async function getRateTable(): Promise<Record<string, Record<string, number>>> {
  const now = Date.now();
  if (_rateTableCache && now < _rateTableCacheExpiry) return _rateTableCache;

  try {
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, 'whatsapp_cost_rate_table'));
    if (rows.length > 0 && rows[0].value) {
      const parsed = JSON.parse(rows[0].value);
      if (typeof parsed === 'object' && parsed !== null) {
        _rateTableCache = parsed;
        _rateTableCacheExpiry = now + RATE_TABLE_CACHE_TTL;
        return parsed;
      }
    }
  } catch (err: any) {
    console.warn('[WACost] Failed to load rate table from DB, using defaults:', err.message);
  }

  _rateTableCache = DEFAULT_RATE_TABLE;
  _rateTableCacheExpiry = now + RATE_TABLE_CACHE_TTL;
  return DEFAULT_RATE_TABLE;
}

// ─── CSW (Customer Service Window) Detection ────────────────────────

/**
 * Check if the given phone number has sent a message within the last 24 hours.
 * If so, the reply is within the Customer Service Window and utility templates are free.
 */
export async function isWithinCSW(phone: string): Promise<boolean> {
  try {
    const result = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(rainbowMessages)
      .where(
        sql`${rainbowMessages.phone} = ${phone} AND ${rainbowMessages.role} = 'user' AND ${rainbowMessages.timestamp} > NOW() - INTERVAL '24 hours' AND ${rainbowMessages.deletedAt} IS NULL`
      );
    return Number(result[0]?.count ?? 0) > 0;
  } catch (err: any) {
    console.warn('[WACost] CSW check failed, assuming outside CSW:', err.message);
    return false;
  }
}

// ─── Cost Estimation ────────────────────────────────────────────────

/**
 * Estimate the cost of a single outbound message.
 * Returns 0 for service messages and utility messages within CSW.
 */
export async function estimateMessageCost(
  templateType: TemplateType,
  countryCode: string,
  withinCSW: boolean
): Promise<number> {
  // Service messages are always free
  if (templateType === 'service') return 0;

  // Utility messages within CSW are free (July 2025 model)
  if (templateType === 'utility' && withinCSW) return 0;

  const rateTable = await getRateTable();
  const typeRates = rateTable[templateType] || rateTable['marketing'] || {};
  const rate = typeRates[countryCode] ?? typeRates['_default'] ?? 0.05;
  return rate;
}

// ─── Public API: Record Outbound Message Cost ───────────────────────

/**
 * Record the cost of an outbound WhatsApp message.
 * Called after a message is successfully sent.
 */
export async function recordWhatsappMessageCost(input: WhatsappMessageCostInput): Promise<void> {
  const { phone, templateType, countryCode = 'MY', profileId = 'pelangi' } = input;

  const withinCSW = await isWithinCSW(phone);
  const cost = await estimateMessageCost(templateType, countryCode, withinCSW);
  const isFreeCSW = templateType === 'utility' && withinCSW;

  const acc = getOrCreateAccumulator(profileId, templateType, countryCode);
  acc.totalMessages += 1;
  if (isFreeCSW) {
    acc.cswFreeMessages += 1;
  } else {
    acc.billableMessages += 1;
    acc.estimatedCostUsd += cost;
  }

  // Fire-and-forget DB upsert
  flushToDb(profileId, templateType, countryCode, acc).catch(err => {
    console.error(`[WACost] DB flush failed:`, err.message);
  });
}

// ─── DB Persistence ─────────────────────────────────────────────────

async function flushToDb(
  profileId: string,
  templateType: string,
  countryCode: string,
  acc: CostAccumulator
): Promise<void> {
  await db.insert(whatsappCostDaily).values({
    date: acc.date,
    profileId,
    templateType,
    countryCode,
    totalMessages: acc.totalMessages,
    billableMessages: acc.billableMessages,
    cswFreeMessages: acc.cswFreeMessages,
    estimatedCostUsd: acc.estimatedCostUsd,
  }).onConflictDoUpdate({
    target: [whatsappCostDaily.date, whatsappCostDaily.profileId, whatsappCostDaily.templateType, whatsappCostDaily.countryCode],
    set: {
      totalMessages: sql`excluded.total_messages`,
      billableMessages: sql`excluded.billable_messages`,
      cswFreeMessages: sql`excluded.csw_free_messages`,
      estimatedCostUsd: sql`excluded.estimated_cost_usd`,
      updatedAt: sql`NOW()`,
    },
  });
}

// ─── Startup: Load Today's Costs ─────────────────────────────────────

export async function loadTodayWhatsappCosts(): Promise<void> {
  try {
    const today = todayUTC();
    const rows = await db.select().from(whatsappCostDaily).where(eq(whatsappCostDaily.date, today));
    for (const row of rows) {
      const key = accKey(row.profileId, row.templateType, row.countryCode, today);
      accumulators.set(key, {
        date: today,
        totalMessages: row.totalMessages,
        billableMessages: row.billableMessages,
        cswFreeMessages: row.cswFreeMessages,
        estimatedCostUsd: row.estimatedCostUsd,
      });
    }
    if (rows.length > 0) {
      console.log(`[WACost] Loaded ${rows.length} cost records for ${today}`);
    }
  } catch (err: any) {
    console.warn('[WACost] Failed to load today\'s costs:', err.message);
  }
}

// ─── Query: Daily Cost Summary ──────────────────────────────────────

export async function queryWhatsappDailyCosts(options: {
  date?: string;
  profileId?: string;
  days?: number;
}): Promise<any[]> {
  const conditions: any[] = [];

  if (options.date) {
    conditions.push(eq(whatsappCostDaily.date, options.date));
  } else if (options.days) {
    const since = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    conditions.push(sql`${whatsappCostDaily.date} >= ${since}`);
  }

  if (options.profileId) {
    conditions.push(eq(whatsappCostDaily.profileId, options.profileId));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select().from(whatsappCostDaily).where(where)
    .orderBy(sql`${whatsappCostDaily.date} DESC, ${whatsappCostDaily.estimatedCostUsd} DESC`);

  return rows.map(r => ({
    date: r.date,
    profileId: r.profileId,
    templateType: r.templateType,
    countryCode: r.countryCode,
    totalMessages: r.totalMessages,
    billableMessages: r.billableMessages,
    cswFreeMessages: r.cswFreeMessages,
    estimatedCostUsd: r.estimatedCostUsd,
  }));
}

/**
 * Get aggregated cost summary for a date range, grouped by day.
 * Used for admin dashboard sparkline.
 */
export async function queryWhatsappCostSummary(options: {
  profileId?: string;
  days?: number;
}): Promise<{
  daily: Array<{ day: string; totalMessages: number; billableMessages: number; cswFreeMessages: number; estimatedCostUsd: number }>;
  byTemplateType: Array<{ templateType: string; totalMessages: number; billableMessages: number; estimatedCostUsd: number }>;
  topCountries: Array<{ countryCode: string; totalMessages: number; estimatedCostUsd: number }>;
  totalEstimatedCostUsd: number;
}> {
  const days = options.days || 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const profileFilter = options.profileId ? sql`AND profile_id = ${options.profileId}` : sql``;

  // Daily totals
  const dailyResult = await db.execute(sql`
    SELECT
      date AS day,
      SUM(total_messages)::int AS total_messages,
      SUM(billable_messages)::int AS billable_messages,
      SUM(csw_free_messages)::int AS csw_free_messages,
      COALESCE(SUM(estimated_cost_usd), 0)::real AS estimated_cost_usd
    FROM whatsapp_cost_daily
    WHERE date >= ${since} ${profileFilter}
    GROUP BY date
    ORDER BY date ASC
  `);

  // By template type
  const byTypeResult = await db.execute(sql`
    SELECT
      template_type,
      SUM(total_messages)::int AS total_messages,
      SUM(billable_messages)::int AS billable_messages,
      COALESCE(SUM(estimated_cost_usd), 0)::real AS estimated_cost_usd
    FROM whatsapp_cost_daily
    WHERE date >= ${since} ${profileFilter}
    GROUP BY template_type
    ORDER BY estimated_cost_usd DESC
  `);

  // Top 5 countries
  const topCountriesResult = await db.execute(sql`
    SELECT
      country_code,
      SUM(total_messages)::int AS total_messages,
      COALESCE(SUM(estimated_cost_usd), 0)::real AS estimated_cost_usd
    FROM whatsapp_cost_daily
    WHERE date >= ${since} ${profileFilter}
    GROUP BY country_code
    ORDER BY estimated_cost_usd DESC
    LIMIT 5
  `);

  const daily = (dailyResult as any).rows.map((r: any) => ({
    day: r.day,
    totalMessages: Number(r.total_messages),
    billableMessages: Number(r.billable_messages),
    cswFreeMessages: Number(r.csw_free_messages),
    estimatedCostUsd: Number(r.estimated_cost_usd),
  }));

  const byTemplateType = (byTypeResult as any).rows.map((r: any) => ({
    templateType: r.template_type,
    totalMessages: Number(r.total_messages),
    billableMessages: Number(r.billable_messages),
    estimatedCostUsd: Number(r.estimated_cost_usd),
  }));

  const topCountries = (topCountriesResult as any).rows.map((r: any) => ({
    countryCode: r.country_code,
    totalMessages: Number(r.total_messages),
    estimatedCostUsd: Number(r.estimated_cost_usd),
  }));

  const totalEstimatedCostUsd = daily.reduce((sum: number, d: any) => sum + d.estimatedCostUsd, 0);

  return { daily, byTemplateType, topCountries, totalEstimatedCostUsd };
}

// ─── Daily Aggregation Job ───────────────────────────────────────────

let _dailyLogTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Log previous day's WhatsApp cost as a structured metric.
 * Runs once per day at startup + on interval.
 */
async function logDailyCostMetric(): Promise<void> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    const rows = await queryWhatsappDailyCosts({ date: yesterday });
    if (rows.length === 0) return;

    const totalCost = rows.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
    const totalMessages = rows.reduce((sum, r) => sum + r.totalMessages, 0);
    const billable = rows.reduce((sum, r) => sum + r.billableMessages, 0);

    console.log(JSON.stringify({
      metric: 'whatsapp.estimated_cost_usd',
      date: yesterday,
      totalCostUsd: Number(totalCost.toFixed(4)),
      totalMessages,
      billableMessages: billable,
      breakdown: rows.map(r => ({
        type: r.templateType,
        country: r.countryCode,
        cost: r.estimatedCostUsd,
        messages: r.totalMessages,
      })),
    }));
  } catch (err: any) {
    console.warn('[WACost] Daily cost metric log failed:', err.message);
  }
}

/**
 * Start the daily cost aggregation log (runs every 24h).
 */
export function startWhatsappCostDailyJob(): void {
  // Log yesterday's cost on startup
  logDailyCostMetric().catch(() => {});

  // Then every 24 hours
  _dailyLogTimer = setInterval(() => {
    logDailyCostMetric().catch(() => {});
  }, 24 * 60 * 60 * 1000);
}

// ─── Comparison Query (US-845) ──────────────────────────────────────

/**
 * Return cost summary with estimated costs under BOTH pricing models.
 * Uses per-message actual data + estimates per-conversation costs by counting
 * unique phone-day pairs as proxy for conversation windows.
 */
export async function queryWhatsappCostComparison(options: {
  profileId?: string;
  days?: number;
}): Promise<{
  activePricingModel: PricingModel;
  perMessage: { totalMessages: number; billableMessages: number; estimatedCostUsd: number };
  perConversation: { estimatedConversations: number; estimatedCostUsd: number };
  daily: Array<{
    day: string;
    perMessageCostUsd: number;
    perConversationCostUsd: number;
    totalMessages: number;
  }>;
}> {
  const days = options.days || 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const profileFilter = options.profileId ? sql`AND profile_id = ${options.profileId}` : sql``;
  const activePricingModel = await getActivePricingModel();

  // Per-message totals (from whatsapp_cost_daily)
  const perMsgResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(total_messages), 0)::int AS total_messages,
      COALESCE(SUM(billable_messages), 0)::int AS billable_messages,
      COALESCE(SUM(estimated_cost_usd), 0)::real AS estimated_cost_usd
    FROM whatsapp_cost_daily
    WHERE date >= ${since} ${profileFilter}
  `);

  // Estimate unique conversations: count distinct phone+day from rainbow_messages
  // (outbound messages grouped by phone and day approximate conversation windows)
  const convResult = await db.execute(sql`
    SELECT COUNT(DISTINCT phone || '::' || date(timestamp))::int AS estimated_conversations
    FROM rainbow_messages
    WHERE role = 'assistant'
      AND timestamp >= ${since}::date
      AND deleted_at IS NULL
  `);

  // Per-message daily breakdown
  const dailyResult = await db.execute(sql`
    SELECT
      date AS day,
      COALESCE(SUM(total_messages), 0)::int AS total_messages,
      COALESCE(SUM(estimated_cost_usd), 0)::real AS per_message_cost_usd
    FROM whatsapp_cost_daily
    WHERE date >= ${since} ${profileFilter}
    GROUP BY date
    ORDER BY date ASC
  `);

  // Estimated conversations per day (for per-conversation model)
  const dailyConvResult = await db.execute(sql`
    SELECT
      date(timestamp) AS day,
      COUNT(DISTINCT phone)::int AS unique_phones
    FROM rainbow_messages
    WHERE role = 'assistant'
      AND timestamp >= ${since}::date
      AND deleted_at IS NULL
    GROUP BY date(timestamp)
    ORDER BY day ASC
  `);

  const perMsgRow = (perMsgResult as any).rows[0] || {};
  const convRow = (convResult as any).rows[0] || {};
  const estimatedConversations = Number(convRow.estimated_conversations || 0);

  // Estimate per-conversation total cost using default MY marketing rate as average
  const avgConvRate = DEFAULT_CONVERSATION_RATE_TABLE.marketing['MY'] || 0.0732;
  const perConversationCostUsd = estimatedConversations * avgConvRate;

  // Build daily comparison
  const dailyMsgRows = (dailyResult as any).rows || [];
  const dailyConvRows = (dailyConvResult as any).rows || [];
  const convByDay = new Map<string, number>();
  for (const r of dailyConvRows) {
    convByDay.set(String(r.day), Number(r.unique_phones || 0));
  }

  const daily = dailyMsgRows.map((r: any) => {
    const day = String(r.day);
    const uniquePhones = convByDay.get(day) || 0;
    return {
      day,
      perMessageCostUsd: Number(r.per_message_cost_usd || 0),
      perConversationCostUsd: uniquePhones * avgConvRate,
      totalMessages: Number(r.total_messages || 0),
    };
  });

  return {
    activePricingModel,
    perMessage: {
      totalMessages: Number(perMsgRow.total_messages || 0),
      billableMessages: Number(perMsgRow.billable_messages || 0),
      estimatedCostUsd: Number(perMsgRow.estimated_cost_usd || 0),
    },
    perConversation: {
      estimatedConversations,
      estimatedCostUsd: perConversationCostUsd,
    },
    daily,
  };
}

// ─── Exports for testing ────────────────────────────────────────────

export const _testExports = {
  DEFAULT_RATE_TABLE,
  DEFAULT_CONVERSATION_RATE_TABLE,
  accumulators,
  todayUTC,
  /** Reset all module-level caches (for testing) */
  resetCaches() {
    _rateTableCache = null;
    _rateTableCacheExpiry = 0;
    _pricingModelCache = null;
    _pricingModelCacheExpiry = 0;
  },
};
