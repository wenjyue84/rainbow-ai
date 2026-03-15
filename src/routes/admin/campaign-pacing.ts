/**
 * Campaign Pacing Admin API (US-962)
 *
 * GET  /analytics/pacing/health          — pacing health summary (held vs. delivered per batch)
 * GET  /analytics/pacing/held-messages   — list held messages pending operator review
 * POST /analytics/pacing/held-messages/:id/resend  — mark message as resent
 * POST /analytics/pacing/held-messages/:id/cancel  — mark message as cancelled
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { campaignPacingEvents } from '../../../shared/schema-tables.js';
import { eq, and, gte, desc } from 'drizzle-orm';
import {
  getPacingHealthSummary,
  getBatchPacingStats,
  updateHeldMessageStatus,
} from '../../lib/campaign-pacing.js';

const router = Router();

/**
 * GET /analytics/pacing/health
 * Returns pacing health summary across all batches in the last 24 hours (default).
 * Includes the 'Pacing Pause' alert indicator when held messages exist.
 */
router.get('/analytics/pacing/health', async (_req: Request, res: Response) => {
  const hours = Math.min(168, Math.max(1, parseInt(_req.query.hours as string) || 24));

  const summary = await getPacingHealthSummary(hours);

  // Build alert indicator for the dashboard
  const alert = summary.pendingReview > 0
    ? {
        type: 'pacing_pause' as const,
        severity: summary.pendingReview >= 10 ? 'critical' : 'warning',
        message: `${summary.pendingReview} messages are held due to portfolio pacing (error 131049).`,
        pendingReview: summary.pendingReview,
      }
    : null;

  res.json({
    alert,
    totalHeld: summary.totalHeld,
    pendingReview: summary.pendingReview,
    windowHours: hours,
    byBatch: summary.byBatch,
  });
});

/**
 * GET /analytics/pacing/held-messages
 * Lists held messages pending operator review. Supports filtering by batchId.
 */
router.get('/analytics/pacing/held-messages', async (req: Request, res: Response) => {
  const batchId = req.query.batchId as string | undefined;
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // default: last 7 days

  const conditions = [
    eq(campaignPacingEvents.reviewStatus, 'pending'),
    gte(campaignPacingEvents.heldAt, since),
    ...(batchId ? [eq(campaignPacingEvents.batchId, batchId)] : []),
  ];

  const messages = await db
    .select()
    .from(campaignPacingEvents)
    .where(and(...conditions))
    .orderBy(desc(campaignPacingEvents.heldAt))
    .limit(limit);

  const batchStats = batchId ? await getBatchPacingStats(batchId) : null;

  res.json({
    count: messages.length,
    batchStats,
    messages,
  });
});

/**
 * POST /analytics/pacing/held-messages/:id/resend
 * Mark a held message as resent (after operator manually re-queues it).
 */
router.post('/analytics/pacing/held-messages/:id/resend', async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const reviewedBy = (req.headers['x-admin-user'] as string) || 'operator';

  const updated = await updateHeldMessageStatus(id, 'resent', reviewedBy);
  if (!updated) {
    res.status(404).json({ error: 'Message not found or already reviewed' });
    return;
  }
  res.json({ ok: true, id, status: 'resent' });
});

/**
 * POST /analytics/pacing/held-messages/:id/cancel
 * Mark a held message as cancelled (operator decides not to re-send).
 */
router.post('/analytics/pacing/held-messages/:id/cancel', async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const reviewedBy = (req.headers['x-admin-user'] as string) || 'operator';

  const updated = await updateHeldMessageStatus(id, 'cancelled', reviewedBy);
  if (!updated) {
    res.status(404).json({ error: 'Message not found or already reviewed' });
    return;
  }
  res.json({ ok: true, id, status: 'cancelled' });
});

export default router;
