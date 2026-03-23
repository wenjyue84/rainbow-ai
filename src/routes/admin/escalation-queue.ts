/**
 * Admin API: Escalation Queue (US-212)
 *
 * GET /admin/escalation-queue?limit=20&profile=pelangi
 *   Returns low-confidence intent classifications flagged for human review,
 *   sorted by confidence ascending (most uncertain first).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { escalationQueue } from '../../../shared/schema-tables.js';
import { eq, asc } from 'drizzle-orm';

const router = Router();

router.get('/escalation-queue', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 200);
  const profile = req.query.profile as string | undefined;

  const query = db.select().from(escalationQueue);
  const filtered = profile
    ? query.where(eq(escalationQueue.profile, profile))
    : query;

  const rows = await filtered
    .orderBy(asc(escalationQueue.confidenceScore))
    .limit(limit);

  const items = rows.map(row => ({
    id: row.id,
    conversationId: row.conversationId,
    originalIntent: row.originalIntent,
    confidenceScore: row.confidenceScore,
    messagePreview: row.messagePreview,
    recommendedKeywords: row.recommendedKeywords ? JSON.parse(row.recommendedKeywords) : [],
    guestCorrectionIntent: row.guestCorrectionIntent,
    profile: row.profile,
    timestamp: row.timestamp,
  }));

  res.json({ escalationQueue: items, total: items.length });
});

export default router;
