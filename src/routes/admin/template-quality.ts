/**
 * Admin API: Template Quality Events (US-831)
 *
 * GET  /analytics/template-quality          — Recent template status events + current status per template
 * GET  /analytics/template-quality/summary  — 24h summary for daily report integration
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { templateQualityEvents } from '../../../shared/schema.js';
import { desc, sql } from 'drizzle-orm';
import { serverError } from './http-utils.js';

const router = Router();

/** GET /analytics/template-quality — current status per template + recent events */
router.get('/analytics/template-quality', async (_req: Request, res: Response) => {
  try {
    // Get latest status per template (most recent event wins)
    const latestPerTemplate = await db
      .select({
        templateName: templateQualityEvents.templateName,
        currentStatus: templateQualityEvents.newStatus,
        reason: templateQualityEvents.reason,
        lastUpdated: templateQualityEvents.createdAt,
        profileId: templateQualityEvents.profileId,
      })
      .from(templateQualityEvents)
      .where(
        sql`(${templateQualityEvents.templateName}, ${templateQualityEvents.createdAt}) IN (
          SELECT template_name, MAX(created_at)
          FROM template_quality_events
          GROUP BY template_name
        )`
      )
      .orderBy(desc(templateQualityEvents.createdAt));

    // Get last 50 events for timeline view
    const recentEvents = await db
      .select()
      .from(templateQualityEvents)
      .orderBy(desc(templateQualityEvents.createdAt))
      .limit(50);

    res.json({
      templates: latestPerTemplate,
      recentEvents,
    });
  } catch (err: any) {
    serverError(res, err);
  }
});

/** GET /analytics/template-quality/summary — 24h summary for daily report */
router.get('/analytics/template-quality/summary', async (_req: Request, res: Response) => {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const events24h = await db
      .select()
      .from(templateQualityEvents)
      .where(sql`${templateQualityEvents.createdAt} >= ${oneDayAgo}`)
      .orderBy(desc(templateQualityEvents.createdAt));

    const paused = events24h.filter(e => e.newStatus === 'PAUSED').length;
    const disabled = events24h.filter(e => e.newStatus === 'DISABLED').length;
    const approved = events24h.filter(e => e.newStatus === 'APPROVED').length;

    res.json({
      period: '24h',
      totalEvents: events24h.length,
      paused,
      disabled,
      approved,
      events: events24h,
    });
  } catch (err: any) {
    serverError(res, err);
  }
});

export default router;
