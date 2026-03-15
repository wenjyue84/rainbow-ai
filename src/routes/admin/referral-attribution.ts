/**
 * US-910: Referral Attribution Admin API
 *
 * Provides endpoints to view Click-to-WhatsApp (CTWA) ad campaign attribution
 * data. Each conversation originating from a Meta ad carries a referral object
 * with campaign ID, click ID, and ad creative metadata.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { rainbowConversations } from '../../../shared/schema-tables.js';
import { isNotNull, desc, eq, and } from 'drizzle-orm';
import { serverError } from './http-utils.js';

const router = Router();

/**
 * GET /referral-attribution
 *
 * Returns all conversations that have Click-to-WhatsApp referral data.
 * Supports optional ?profileId= and ?sourceType= filters.
 * Response includes lead source details for ad ROI measurement.
 */
router.get('/referral-attribution', async (req: Request, res: Response) => {
  try {
    const profileId = (req.query.profileId as string) || (res.locals.tenantId as string | undefined);
    const sourceType = req.query.sourceType as string | undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || '100', 10), 500);
    const offset = parseInt((req.query.offset as string) || '0', 10);

    // Build where conditions — require ctwa_clid or source_id to be present
    const conditions = [isNotNull(rainbowConversations.referralCtwaClid)];
    if (profileId) {
      conditions.push(eq(rainbowConversations.profileId, profileId));
    }
    if (sourceType) {
      conditions.push(eq(rainbowConversations.referralSourceType, sourceType));
    }

    const rows = await db
      .select({
        phone: rainbowConversations.phone,
        pushName: rainbowConversations.pushName,
        profileId: rainbowConversations.profileId,
        instanceId: rainbowConversations.instanceId,
        status: rainbowConversations.status,
        referralCtwaClid: rainbowConversations.referralCtwaClid,
        referralSourceId: rainbowConversations.referralSourceId,
        referralSourceType: rainbowConversations.referralSourceType,
        referralHeadline: rainbowConversations.referralHeadline,
        referralBody: rainbowConversations.referralBody,
        createdAt: rainbowConversations.createdAt,
        updatedAt: rainbowConversations.updatedAt,
      })
      .from(rainbowConversations)
      .where(and(...conditions))
      .orderBy(desc(rainbowConversations.createdAt))
      .limit(limit)
      .offset(offset);

    const results = rows.map(row => ({
      phone: row.phone,
      pushName: row.pushName,
      profileId: row.profileId,
      instanceId: row.instanceId,
      status: row.status,
      leadSource: {
        ctwaClid: row.referralCtwaClid,
        sourceId: row.referralSourceId,
        sourceType: row.referralSourceType,   // 'ad' | 'post' | 'qr_code'
        headline: row.referralHeadline,
        body: row.referralBody,
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    res.json({
      total: results.length,
      limit,
      offset,
      data: results,
    });
  } catch (err: any) {
    console.error('[Admin] referral-attribution GET failed:', err);
    serverError(res, err);
  }
});

/**
 * GET /referral-attribution/stats
 *
 * Returns aggregated lead source stats by sourceType and sourceId (campaign).
 * Useful for quick ROI comparison across ad campaigns.
 */
router.get('/referral-attribution/stats', async (req: Request, res: Response) => {
  try {
    const profileId = (req.query.profileId as string) || (res.locals.tenantId as string | undefined);

    const conditions = [isNotNull(rainbowConversations.referralCtwaClid)];
    if (profileId) {
      conditions.push(eq(rainbowConversations.profileId, profileId));
    }

    const rows = await db
      .select({
        sourceType: rainbowConversations.referralSourceType,
        sourceId: rainbowConversations.referralSourceId,
        headline: rainbowConversations.referralHeadline,
      })
      .from(rainbowConversations)
      .where(and(...conditions));

    // Aggregate by sourceType and sourceId
    const byType: Record<string, number> = {};
    const byCampaign: Record<string, { sourceId: string; headline: string | null; count: number }> = {};

    for (const row of rows) {
      const st = row.sourceType ?? 'unknown';
      byType[st] = (byType[st] ?? 0) + 1;

      if (row.sourceId) {
        const key = row.sourceId;
        if (!byCampaign[key]) {
          byCampaign[key] = { sourceId: row.sourceId, headline: row.headline, count: 0 };
        }
        byCampaign[key].count++;
      }
    }

    res.json({
      total: rows.length,
      bySourceType: byType,
      byCampaign: Object.values(byCampaign).sort((a, b) => b.count - a.count),
    });
  } catch (err: any) {
    console.error('[Admin] referral-attribution/stats GET failed:', err);
    serverError(res, err);
  }
});

export default router;
