import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { sql } from 'drizzle-orm';
import { ok, serverError } from './http-utils.js';
import { getStore } from './http-utils.js';
import { queryDailyCosts, getProviderDailyCost, getGlobalBudgetStatus } from '../../assistant/llm-cost-budget.js';

const router = Router();

/**
 * GET /analytics/llm-cost
 *
 * Returns LLM token usage and cost analytics:
 * - total tokens by profile
 * - average tokens per conversation
 * - top 10 most expensive conversations (last 30 days)
 * - daily token spend (last 7 days, for sparkline)
 */
router.get('/analytics/llm-cost', async (req: Request, res: Response) => {
  try {
    const settings = getStore(res).getSettings();
    const tokenPrices: Record<string, number> = (settings as any).token_prices || {};
    const defaultPrice = tokenPrices.default ?? 0.0001;

    // 1. Total tokens by profile
    const byProfile = await db.execute(sql`
      SELECT
        COALESCE(profile_id, 'pelangi') AS profile_id,
        COALESCE(SUM(prompt_tokens), 0)::bigint AS total_prompt_tokens,
        COALESCE(SUM(completion_tokens), 0)::bigint AS total_completion_tokens,
        COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
        COUNT(*) FILTER (WHERE total_tokens > 0)::int AS messages_with_usage
      FROM rainbow_messages
      WHERE deleted_at IS NULL
      GROUP BY COALESCE(profile_id, 'pelangi')
      ORDER BY total_tokens DESC
    `);

    const profileStats = (byProfile as any).rows.map((r: any) => {
      const totalTokens = Number(r.total_tokens);
      return {
        profileId: r.profile_id,
        promptTokens: Number(r.total_prompt_tokens),
        completionTokens: Number(r.total_completion_tokens),
        totalTokens,
        messagesWithUsage: Number(r.messages_with_usage),
        estimatedCostUsd: Number(((totalTokens / 1000) * defaultPrice).toFixed(6)),
      };
    });

    // 2. Average tokens per conversation
    const avgPerConvo = await db.execute(sql`
      SELECT
        COUNT(DISTINCT phone)::int AS conversation_count,
        COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
        CASE
          WHEN COUNT(DISTINCT phone) > 0
          THEN ROUND(SUM(total_tokens)::numeric / COUNT(DISTINCT phone), 0)
          ELSE 0
        END AS avg_tokens_per_conversation
      FROM rainbow_messages
      WHERE deleted_at IS NULL AND total_tokens > 0
    `);
    const avgRow = (avgPerConvo as any).rows[0] || {};

    // 3. Top 10 most expensive conversations (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const topConvos = await db.execute(sql`
      SELECT
        phone,
        COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
        COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
        COUNT(*)::int AS message_count,
        MAX(model) AS last_model
      FROM rainbow_messages
      WHERE deleted_at IS NULL
        AND total_tokens > 0
        AND timestamp > ${thirtyDaysAgo}
      GROUP BY phone
      ORDER BY total_tokens DESC
      LIMIT 10
    `);

    const topConversations = (topConvos as any).rows.map((r: any) => {
      const totalTokens = Number(r.total_tokens);
      const modelPrice = tokenPrices[r.last_model] ?? defaultPrice;
      return {
        phone: r.phone,
        promptTokens: Number(r.prompt_tokens),
        completionTokens: Number(r.completion_tokens),
        totalTokens,
        messageCount: Number(r.message_count),
        lastModel: r.last_model,
        estimatedCostUsd: Number(((totalTokens / 1000) * modelPrice).toFixed(6)),
      };
    });

    // 4. Daily token spend (last 7 days) — for sparkline widget
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dailySpend = await db.execute(sql`
      SELECT
        DATE(timestamp) AS day,
        COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
        COUNT(*) FILTER (WHERE total_tokens > 0)::int AS messages_with_usage
      FROM rainbow_messages
      WHERE deleted_at IS NULL
        AND timestamp > ${sevenDaysAgo}
      GROUP BY DATE(timestamp)
      ORDER BY day ASC
    `);

    const dailyTokens = (dailySpend as any).rows.map((r: any) => {
      const totalTokens = Number(r.total_tokens);
      return {
        day: r.day,
        totalTokens,
        messagesWithUsage: Number(r.messages_with_usage),
        estimatedCostUsd: Number(((totalTokens / 1000) * defaultPrice).toFixed(6)),
      };
    });

    // US-903: Include global daily budget status
    const globalBudget = getGlobalBudgetStatus();

    ok(res, {
      currentDayUsd: globalBudget.currentDayUsd,
      budgetUsd: globalBudget.budgetUsd,
      budgetPctUsed: globalBudget.budgetPctUsed,
      byProfile: profileStats,
      averagePerConversation: {
        conversationCount: Number(avgRow.conversation_count ?? 0),
        totalTokens: Number(avgRow.total_tokens ?? 0),
        avgTokensPerConversation: Number(avgRow.avg_tokens_per_conversation ?? 0),
      },
      topConversations,
      dailySpend: dailyTokens,
      tokenPrices,
    });
  } catch (err: any) {
    console.error('[LLM Cost] Analytics query failed:', err.message);
    serverError(res, err);
  }
});

/**
 * GET /llm-costs
 *
 * Returns daily cost breakdown by provider with budget status (US-433).
 * Query params:
 *   date      - specific date (YYYY-MM-DD), default: today
 *   profile_id - filter by profile
 *   days      - number of days to look back (default: 7, max: 90)
 */
router.get('/llm-costs', async (req: Request, res: Response) => {
  try {
    const date = req.query.date as string | undefined;
    const profileId = req.query.profile_id as string | undefined;
    const days = Math.min(parseInt(req.query.days as string) || 7, 90);

    const rows = await queryDailyCosts({ date, profileId, days: date ? undefined : days });

    // Aggregate totals per provider across the date range
    const providerTotals: Record<string, { promptTokens: number; completionTokens: number; estimatedCostUsd: number; requestCount: number; budgetCapUsd: number | null; budgetBreached: boolean }> = {};
    let totalCostUsd = 0;

    for (const row of rows) {
      totalCostUsd += row.estimatedCostUsd;
      if (!providerTotals[row.provider]) {
        providerTotals[row.provider] = {
          promptTokens: 0,
          completionTokens: 0,
          estimatedCostUsd: 0,
          requestCount: 0,
          budgetCapUsd: row.budgetCapUsd,
          budgetBreached: false,
        };
      }
      const t = providerTotals[row.provider];
      t.promptTokens += row.promptTokens;
      t.completionTokens += row.completionTokens;
      t.estimatedCostUsd += row.estimatedCostUsd;
      t.requestCount += row.requestCount;
      if (row.budgetBreached) t.budgetBreached = true;
    }

    ok(res, {
      daily: rows,
      providerTotals,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      queryDays: days,
    });
  } catch (err: any) {
    console.error('[LLM Cost] Daily cost query failed:', err.message);
    serverError(res, err);
  }
});

export default router;
