/**
 * WhatsApp Message Cost Admin API (US-495)
 *
 * Tracks per-message WhatsApp template costs under July 2025 pricing model.
 *
 * GET  /analytics/whatsapp-cost          — cost summary (daily, by type, top countries)
 * GET  /analytics/whatsapp-cost/daily    — detailed daily breakdown
 * GET  /analytics/whatsapp-cost/rate-table — current rate table
 * PUT  /analytics/whatsapp-cost/rate-table — update rate table
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { appSettings } from '../../../shared/schema.js';
import { sql, eq, and } from 'drizzle-orm';
import { ok, badRequest, serverError } from './http-utils.js';
import {
  queryWhatsappCostSummary,
  queryWhatsappDailyCosts,
  getPricingModel,
  estimateConversationCost,
  getVolumeTierStatus,
  queryMonthlyCostReport,
} from '../../lib/whatsapp-cost.js';

const router = Router();

/**
 * GET /analytics/whatsapp-cost
 *
 * Returns WhatsApp message cost summary:
 * - daily spend (for sparkline)
 * - breakdown by template type
 * - top 5 countries by cost
 * - total estimated spend
 */
router.get('/analytics/whatsapp-cost', async (req: Request, res: Response) => {
  try {
    const profileId = req.query.profile_id as string | undefined;
    const days = Math.min(parseInt(req.query.days as string) || 7, 90);

    const [summary, activePricingModel] = await Promise.all([
      queryWhatsappCostSummary({ profileId, days }),
      getPricingModel(profileId),
    ]);

    // Compute per-conversation comparison from the per-message data.
    // Each unique (templateType, countryCode) combination within a day represents
    // one conversation window for the legacy model.
    const dailyRows = await queryWhatsappDailyCosts({ profileId, days });
    const perConversationEstimateUsd = dailyRows.reduce((sum, row) => {
      const rate = estimateConversationCost(
        row.templateType as any,
        row.countryCode,
        false // conservative: assume outside CSW for comparison
      );
      // One conversation per unique (date, type, country) row
      return sum + rate;
    }, 0);

    ok(res, {
      ...summary,
      queryDays: days,
      activePricingModel,
      modelComparison: {
        perMessage: {
          model: 'per_message',
          estimatedCostUsd: summary.totalEstimatedCostUsd,
          isActive: activePricingModel === 'per_message',
        },
        perConversation: {
          model: 'per_conversation',
          estimatedCostUsd: Number(perConversationEstimateUsd.toFixed(4)),
          isActive: activePricingModel === 'per_conversation',
        },
      },
    });
  } catch (err: any) {
    console.error('[WACost] Summary query failed:', err.message);
    serverError(res, err);
  }
});

/**
 * GET /analytics/whatsapp-cost/daily
 *
 * Returns detailed daily cost breakdown by template type and country.
 */
router.get('/analytics/whatsapp-cost/daily', async (req: Request, res: Response) => {
  try {
    const date = req.query.date as string | undefined;
    const profileId = req.query.profile_id as string | undefined;
    const days = Math.min(parseInt(req.query.days as string) || 7, 90);

    const rows = await queryWhatsappDailyCosts({ date, profileId, days: date ? undefined : days });

    ok(res, { daily: rows, queryDays: days });
  } catch (err: any) {
    console.error('[WACost] Daily query failed:', err.message);
    serverError(res, err);
  }
});

/**
 * GET /analytics/whatsapp-cost/rate-table
 *
 * Returns the current WhatsApp message cost rate table.
 */
router.get('/analytics/whatsapp-cost/rate-table', async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, 'whatsapp_cost_rate_table'));
    if (rows.length > 0 && rows[0].value) {
      ok(res, { rateTable: JSON.parse(rows[0].value), source: 'database' });
    } else {
      // Return default rate table
      const { _testExports } = await import('../../lib/whatsapp-cost.js');
      ok(res, { rateTable: _testExports.DEFAULT_RATE_TABLE, source: 'default' });
    }
  } catch (err: any) {
    console.error('[WACost] Rate table query failed:', err.message);
    serverError(res, err);
  }
});

/**
 * PUT /analytics/whatsapp-cost/rate-table
 *
 * Update the WhatsApp message cost rate table.
 * Body: { rateTable: { marketing: { MY: 0.0732, ... }, utility: {...}, ... } }
 */
router.put('/analytics/whatsapp-cost/rate-table', async (req: Request, res: Response) => {
  try {
    const { rateTable } = req.body;
    if (!rateTable || typeof rateTable !== 'object') {
      return badRequest(res, 'rateTable object required');
    }

    // Validate structure: each key should be a template type with country->price mapping
    for (const [type, rates] of Object.entries(rateTable)) {
      if (typeof rates !== 'object' || rates === null) {
        return badRequest(res, `Invalid rate table entry for type "${type}"`);
      }
      for (const [country, price] of Object.entries(rates as Record<string, any>)) {
        if (typeof price !== 'number' || price < 0) {
          return badRequest(res, `Invalid price for ${type}.${country}: must be a non-negative number`);
        }
      }
    }

    const value = JSON.stringify(rateTable);
    await db.insert(appSettings)
      .values({
        key: 'whatsapp_cost_rate_table',
        value,
        description: 'WhatsApp per-message cost rate table (USD) by template type and country code',
      })
      .onConflictDoUpdate({
        target: [appSettings.key],
        set: { value, updatedAt: sql`NOW()` },
      });

    ok(res, { rateTable, updatedAt: new Date().toISOString() });
  } catch (err: any) {
    console.error('[WACost] Rate table update failed:', err.message);
    serverError(res, err);
  }
});

/**
 * GET /analytics/whatsapp-cost/volume-tier
 *
 * Returns current month's volume tier status and discount threshold info.
 */
router.get('/analytics/whatsapp-cost/volume-tier', async (req: Request, res: Response) => {
  try {
    const profileId = req.query.profile_id as string | undefined;
    const tierStatus = await getVolumeTierStatus(profileId);
    ok(res, tierStatus);
  } catch (err: any) {
    console.error('[WACost] Volume tier query failed:', err.message);
    serverError(res, err);
  }
});

/**
 * GET /analytics/whatsapp-cost/monthly
 *
 * Returns monthly cost report distinguishing free CSW messages from billable,
 * with per-category breakdown and volume tier per month.
 */
router.get('/analytics/whatsapp-cost/monthly', async (req: Request, res: Response) => {
  try {
    const profileId = req.query.profile_id as string | undefined;
    const months = Math.min(parseInt(req.query.months as string) || 3, 12);

    const report = await queryMonthlyCostReport({ profileId, months });

    ok(res, { months: report, queryMonths: months });
  } catch (err: any) {
    console.error('[WACost] Monthly report query failed:', err.message);
    serverError(res, err);
  }
});

/**
 * GET /analytics/whatsapp-cost/pricing-events
 *
 * Returns per-message actual pricing data captured from Meta Cloud API
 * pricing_analytics webhook field.
 */
router.get('/analytics/whatsapp-cost/pricing-events', async (req: Request, res: Response) => {
  try {
    const profileId = req.query.profile_id as string | undefined;
    const days = Math.min(parseInt(req.query.days as string) || 7, 90);
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    const { whatsappPricingEvents } = await import('../../../shared/schema.js');
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const conditions: any[] = [sql`${whatsappPricingEvents.createdAt} >= ${since}::timestamp`];
    if (profileId) {
      conditions.push(eq(whatsappPricingEvents.profileId, profileId));
    }

    const rows = await db.select().from(whatsappPricingEvents)
      .where(and(...conditions))
      .orderBy(sql`${whatsappPricingEvents.createdAt} DESC`)
      .limit(limit);

    // Summary stats
    const totalEvents = rows.length;
    const billableCount = rows.filter(r => r.billable).length;
    const cswFreeCount = rows.filter(r => r.cswFree).length;
    const totalCost = rows.reduce((sum, r) => sum + (r.price ?? 0), 0);

    // Category breakdown
    const byCategory = new Map<string, { count: number; billable: number; cswFree: number; totalCost: number }>();
    for (const r of rows) {
      const cat = r.category;
      const entry = byCategory.get(cat) ?? { count: 0, billable: 0, cswFree: 0, totalCost: 0 };
      entry.count++;
      if (r.billable) entry.billable++;
      if (r.cswFree) entry.cswFree++;
      entry.totalCost += r.price ?? 0;
      byCategory.set(cat, entry);
    }

    ok(res, {
      events: rows,
      summary: {
        totalEvents,
        billableCount,
        cswFreeCount,
        totalCost: Number(totalCost.toFixed(4)),
        byCategory: Object.fromEntries(byCategory),
      },
      queryDays: days,
    });
  } catch (err: any) {
    console.error('[WACost] Pricing events query failed:', err.message);
    serverError(res, err);
  }
});

export default router;
