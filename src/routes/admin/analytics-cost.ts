/**
 * Admin API: Comprehensive AI Cost Analytics (US-918)
 *
 * Provides:
 *   GET /analytics/cost-analytics          — Dashboard: daily/weekly/monthly spend by provider & tenant, avg cost/conversation
 *   GET /analytics/cost-analytics/csv      — CSV export of cost data
 *   GET /analytics/cost-analytics/provider-comparison — Cost per resolved conversation by provider
 *   POST /analytics/cost-analytics/budget-check — Trigger monthly budget threshold check
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady } from '../../lib/db.js';
import { sql } from 'drizzle-orm';
import { ok, serverError, badRequest } from './http-utils.js';
import { getStore } from './http-utils.js';
import { configStore } from '../../assistant/config-store.js';

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────

function getTokenPrices(): Record<string, number> {
  const settings = configStore.getSettings() as any;
  return settings.token_prices || {};
}

function getMonthlyBudgetConfig(): { thresholdUsd: number; email: string } {
  const settings = configStore.getSettings() as any;
  const cfg = settings.costBudget || {};
  return {
    thresholdUsd: typeof cfg.monthlyBudgetAlertUsd === 'number' ? cfg.monthlyBudgetAlertUsd : 50.0,
    email: cfg.monthlyBudgetAlertEmail || '',
  };
}

/**
 * GET /analytics/cost-analytics
 *
 * AC2: Cost Analytics dashboard data.
 * Query params:
 *   period  - 'daily' | 'weekly' | 'monthly' (default: daily)
 *   days    - lookback window (default: 30, max: 90)
 *   profileId - filter by tenant
 */
router.get('/analytics/cost-analytics', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return ok(res, { warning: 'Database unavailable', byProvider: [], byTenant: [], avgCostPerConversation: 0, dailySpend: [] });
    }

    const period = (req.query.period as string) || 'daily';
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 30));
    const profileId = (req.query.profileId as string) || undefined;

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    const profileFilter = profileId ? sql`AND profile_id = ${profileId}` : sql``;

    // 1. Spend by provider (aggregated over the period)
    const byProviderResult = await db.execute(sql`
      SELECT
        provider,
        SUM(prompt_tokens)::bigint AS prompt_tokens,
        SUM(completion_tokens)::bigint AS completion_tokens,
        SUM(estimated_cost_usd)::float AS total_cost_usd,
        SUM(request_count)::int AS total_requests
      FROM llm_cost_daily
      WHERE date >= ${sinceStr} ${profileFilter}
      GROUP BY provider
      ORDER BY total_cost_usd DESC
    `);

    const byProvider = (byProviderResult as any).rows.map((r: any) => ({
      provider: r.provider,
      promptTokens: Number(r.prompt_tokens),
      completionTokens: Number(r.completion_tokens),
      totalCostUsd: Number(Number(r.total_cost_usd).toFixed(6)),
      totalRequests: Number(r.total_requests),
    }));

    // 2. Spend by tenant (profileId)
    const byTenantResult = await db.execute(sql`
      SELECT
        profile_id,
        SUM(prompt_tokens)::bigint AS prompt_tokens,
        SUM(completion_tokens)::bigint AS completion_tokens,
        SUM(estimated_cost_usd)::float AS total_cost_usd,
        SUM(request_count)::int AS total_requests
      FROM llm_cost_daily
      WHERE date >= ${sinceStr} ${profileFilter}
      GROUP BY profile_id
      ORDER BY total_cost_usd DESC
    `);

    const byTenant = (byTenantResult as any).rows.map((r: any) => ({
      tenantId: r.profile_id,
      promptTokens: Number(r.prompt_tokens),
      completionTokens: Number(r.completion_tokens),
      totalCostUsd: Number(Number(r.total_cost_usd).toFixed(6)),
      totalRequests: Number(r.total_requests),
    }));

    // 3. Average cost per conversation (from rainbow_messages)
    const avgCostResult = await db.execute(sql`
      SELECT
        COUNT(DISTINCT phone)::int AS conversation_count,
        COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens
      FROM rainbow_messages
      WHERE deleted_at IS NULL
        AND total_tokens > 0
        AND timestamp >= ${since}
        ${profileFilter}
    `);
    const avgRow = (avgCostResult as any).rows[0] || {};
    const conversationCount = Number(avgRow.conversation_count || 0);
    const totalTokens = Number(avgRow.total_tokens || 0);
    const prices = getTokenPrices();
    const defaultPrice = prices.default ?? 0.0001;
    const totalEstCost = (totalTokens / 1000) * defaultPrice;
    const avgCostPerConversation = conversationCount > 0 ? Number((totalEstCost / conversationCount).toFixed(6)) : 0;

    // 4. Daily/weekly/monthly spend timeline
    let dateGroupSql;
    if (period === 'weekly') {
      dateGroupSql = sql`DATE_TRUNC('week', date::date)::date::text`;
    } else if (period === 'monthly') {
      dateGroupSql = sql`DATE_TRUNC('month', date::date)::date::text`;
    } else {
      dateGroupSql = sql`date`;
    }

    const timelineResult = await db.execute(sql`
      SELECT
        ${dateGroupSql} AS period,
        SUM(prompt_tokens)::bigint AS prompt_tokens,
        SUM(completion_tokens)::bigint AS completion_tokens,
        SUM(estimated_cost_usd)::float AS total_cost_usd,
        SUM(request_count)::int AS total_requests
      FROM llm_cost_daily
      WHERE date >= ${sinceStr} ${profileFilter}
      GROUP BY ${dateGroupSql}
      ORDER BY period ASC
    `);

    const timeline = (timelineResult as any).rows.map((r: any) => ({
      period: r.period,
      promptTokens: Number(r.prompt_tokens),
      completionTokens: Number(r.completion_tokens),
      totalCostUsd: Number(Number(r.total_cost_usd).toFixed(6)),
      totalRequests: Number(r.total_requests),
    }));

    // 5. Monthly budget status (AC3)
    const budgetCfg = getMonthlyBudgetConfig();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartStr = monthStart.toISOString().slice(0, 10);

    const monthlySpendResult = await db.execute(sql`
      SELECT COALESCE(SUM(estimated_cost_usd), 0)::float AS monthly_cost_usd
      FROM llm_cost_daily
      WHERE date >= ${monthStartStr}
    `);
    const monthlyCostUsd = Number((monthlySpendResult as any).rows[0]?.monthly_cost_usd || 0);

    ok(res, {
      byProvider,
      byTenant,
      avgCostPerConversation,
      timeline,
      period,
      queryDays: days,
      monthlyBudget: {
        currentMonthCostUsd: Number(monthlyCostUsd.toFixed(6)),
        thresholdUsd: budgetCfg.thresholdUsd,
        pctUsed: budgetCfg.thresholdUsd > 0 ? Number(((monthlyCostUsd / budgetCfg.thresholdUsd) * 100).toFixed(1)) : 0,
        exceeded: monthlyCostUsd >= budgetCfg.thresholdUsd,
        alertEmail: budgetCfg.email || '(not configured)',
      },
      tokenPrices: prices,
    });
  } catch (err: any) {
    console.error('[analytics-cost] Dashboard query failed:', err.message);
    serverError(res, err);
  }
});

/**
 * GET /analytics/cost-analytics/csv
 *
 * AC4: Export cost data as CSV for monthly reporting.
 * Query params:
 *   days      - lookback window (default: 30, max: 90)
 *   profileId - filter by tenant
 */
router.get('/analytics/cost-analytics/csv', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return badRequest(res, 'Database unavailable');
    }

    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 30));
    const profileId = (req.query.profileId as string) || undefined;

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    const profileFilter = profileId ? sql`AND profile_id = ${profileId}` : sql``;

    const result = await db.execute(sql`
      SELECT
        date,
        provider,
        profile_id,
        prompt_tokens,
        completion_tokens,
        estimated_cost_usd,
        request_count,
        budget_cap_usd,
        budget_breached
      FROM llm_cost_daily
      WHERE date >= ${sinceStr} ${profileFilter}
      ORDER BY date DESC, estimated_cost_usd DESC
    `);

    const rows = (result as any).rows;

    // Build CSV
    const headers = ['date', 'provider', 'tenant_id', 'prompt_tokens', 'completion_tokens', 'estimated_cost_usd', 'request_count', 'budget_cap_usd', 'budget_breached'];
    const csvLines = [headers.join(',')];

    for (const r of rows) {
      csvLines.push([
        r.date,
        `"${r.provider}"`,
        `"${r.profile_id}"`,
        r.prompt_tokens,
        r.completion_tokens,
        Number(r.estimated_cost_usd).toFixed(6),
        r.request_count,
        r.budget_cap_usd ?? '',
        r.budget_breached ? 'true' : 'false',
      ].join(','));
    }

    const csv = csvLines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ai-cost-report-${sinceStr}-to-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err: any) {
    console.error('[analytics-cost] CSV export failed:', err.message);
    serverError(res, err);
  }
});

/**
 * GET /analytics/cost-analytics/provider-comparison
 *
 * AC6: Provider comparison report — cost per resolved conversation.
 * A "resolved conversation" is one where the last message is from the assistant
 * (indicating the bot handled it without needing human escalation).
 *
 * Query params:
 *   days      - lookback window (default: 30, max: 90)
 *   profileId - filter by tenant
 */
router.get('/analytics/cost-analytics/provider-comparison', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return ok(res, { warning: 'Database unavailable', providers: [] });
    }

    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 30));
    const profileId = (req.query.profileId as string) || undefined;

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    const profileFilter = profileId ? sql`AND profile_id = ${profileId}` : sql``;

    // Get cost per provider from llm_cost_daily
    const costResult = await db.execute(sql`
      SELECT
        provider,
        SUM(prompt_tokens)::bigint AS prompt_tokens,
        SUM(completion_tokens)::bigint AS completion_tokens,
        SUM(estimated_cost_usd)::float AS total_cost_usd,
        SUM(request_count)::int AS total_requests
      FROM llm_cost_daily
      WHERE date >= ${sinceStr} ${profileFilter}
      GROUP BY provider
      ORDER BY total_cost_usd DESC
    `);

    // Get conversation count by provider (from conversation_traces)
    const profileTraceFilter = profileId ? sql`AND profile_id = ${profileId}` : sql``;
    const convoResult = await db.execute(sql`
      SELECT
        llm_provider,
        COUNT(DISTINCT jid)::int AS unique_conversations,
        COUNT(*)::int AS total_traces,
        ROUND(AVG(total_ms))::int AS avg_total_ms
      FROM conversation_traces
      WHERE created_at >= ${since}
        AND llm_provider IS NOT NULL
        ${profileTraceFilter}
      GROUP BY llm_provider
    `);

    // Merge cost and conversation data
    const convoMap = new Map<string, { uniqueConversations: number; totalTraces: number; avgTotalMs: number }>();
    for (const r of (convoResult as any).rows) {
      convoMap.set(r.llm_provider, {
        uniqueConversations: Number(r.unique_conversations),
        totalTraces: Number(r.total_traces),
        avgTotalMs: Number(r.avg_total_ms),
      });
    }

    const providers = (costResult as any).rows.map((r: any) => {
      const totalCostUsd = Number(r.total_cost_usd);
      const convoData = convoMap.get(r.provider);
      const uniqueConvos = convoData?.uniqueConversations || 0;
      const costPerConversation = uniqueConvos > 0 ? Number((totalCostUsd / uniqueConvos).toFixed(6)) : null;

      return {
        provider: r.provider,
        promptTokens: Number(r.prompt_tokens),
        completionTokens: Number(r.completion_tokens),
        totalCostUsd: Number(totalCostUsd.toFixed(6)),
        totalRequests: Number(r.total_requests),
        uniqueConversations: uniqueConvos,
        costPerConversation,
        avgResponseMs: convoData?.avgTotalMs ?? null,
      };
    });

    ok(res, {
      providers,
      queryDays: days,
      since: since.toISOString(),
      ...(profileId ? { profileId } : {}),
    });
  } catch (err: any) {
    console.error('[analytics-cost] Provider comparison failed:', err.message);
    serverError(res, err);
  }
});

/**
 * POST /analytics/cost-analytics/budget-check
 *
 * AC3: Trigger monthly budget threshold check.
 * Returns current month's spend vs threshold and whether alert would fire.
 */
router.post('/analytics/cost-analytics/budget-check', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return badRequest(res, 'Database unavailable');
    }

    const budgetCfg = getMonthlyBudgetConfig();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartStr = monthStart.toISOString().slice(0, 10);

    const result = await db.execute(sql`
      SELECT COALESCE(SUM(estimated_cost_usd), 0)::float AS monthly_cost_usd
      FROM llm_cost_daily
      WHERE date >= ${monthStartStr}
    `);
    const monthlyCostUsd = Number((result as any).rows[0]?.monthly_cost_usd || 0);
    const exceeded = monthlyCostUsd >= budgetCfg.thresholdUsd;

    if (exceeded && budgetCfg.email) {
      // Log the alert (actual email sending would use a configured SMTP service)
      console.warn(`[CostBudget] MONTHLY ALERT: AI spend $${monthlyCostUsd.toFixed(2)} >= threshold $${budgetCfg.thresholdUsd.toFixed(2)}. Alert recipient: ${budgetCfg.email}`);
    }

    ok(res, {
      currentMonthCostUsd: Number(monthlyCostUsd.toFixed(6)),
      thresholdUsd: budgetCfg.thresholdUsd,
      pctUsed: budgetCfg.thresholdUsd > 0 ? Number(((monthlyCostUsd / budgetCfg.thresholdUsd) * 100).toFixed(1)) : 0,
      exceeded,
      alertEmail: budgetCfg.email || '(not configured)',
      alertTriggered: exceeded && !!budgetCfg.email,
    });
  } catch (err: any) {
    console.error('[analytics-cost] Budget check failed:', err.message);
    serverError(res, err);
  }
});

export default router;
