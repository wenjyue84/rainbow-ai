/**
 * Admin API: Intent Gap Report (US-432)
 *
 * GET /api/admin/intent-gaps — top unhandled utterances by frequency
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { utteranceGaps } from '../../../shared/schema.js';
import { desc, eq, gte, and, sql } from 'drizzle-orm';

const router = Router();

/**
 * GET /intent-gaps?profile_id=pelangi&days=30&limit=20
 *
 * Returns top unmatched utterances sorted by count descending.
 */
router.get('/intent-gaps', async (req: Request, res: Response) => {
  try {
    const profileId = (req.query.profile_id as string) || res.locals.profileId || 'pelangi';
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);

    const since = new Date();
    since.setDate(since.getDate() - days);

    const gaps = await db.select({
      id: utteranceGaps.id,
      utteranceSample: utteranceGaps.utteranceSample,
      tierReached: utteranceGaps.tierReached,
      count: utteranceGaps.count,
      lastSeenAt: utteranceGaps.lastSeenAt,
      createdAt: utteranceGaps.createdAt,
    })
      .from(utteranceGaps)
      .where(and(
        eq(utteranceGaps.profileId, profileId),
        gte(utteranceGaps.lastSeenAt, since),
      ))
      .orderBy(desc(utteranceGaps.count))
      .limit(limit);

    const totalCount = await db.select({
      total: sql<number>`count(*)::int`,
      totalOccurrences: sql<number>`coalesce(sum(${utteranceGaps.count}), 0)::int`,
    })
      .from(utteranceGaps)
      .where(and(
        eq(utteranceGaps.profileId, profileId),
        gte(utteranceGaps.lastSeenAt, since),
      ));

    res.json({
      profileId,
      days,
      uniqueGaps: totalCount[0]?.total ?? 0,
      totalOccurrences: totalCount[0]?.totalOccurrences ?? 0,
      gaps,
    });
  } catch (err: any) {
    console.error('[IntentGaps] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
