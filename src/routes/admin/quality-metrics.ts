/**
 * Admin API: Message Quality Metrics (US-431)
 *
 * GET /api/rainbow/quality-metrics?profile_id=pelangi&days=7 — time-series quality data
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getQualityMetrics, aggregateDailyMetrics } from '../../lib/quality-metrics.js';

const router = Router();

// GET /api/rainbow/quality-metrics
router.get('/quality-metrics', async (req: Request, res: Response) => {
  try {
    const profileId = (req.query.profile_id as string) || (res.locals.profileId as string) || 'pelangi';
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));

    const data = await getQualityMetrics(profileId, days);
    res.json({ success: true, profileId, days, data });
  } catch (error) {
    console.error('[QualityMetrics Admin] Failed to fetch metrics:', error);
    res.status(500).json({ error: 'Failed to retrieve quality metrics' });
  }
});

// POST /api/rainbow/quality-metrics/aggregate — manually trigger aggregation
router.post('/quality-metrics/aggregate', async (_req: Request, res: Response) => {
  try {
    await aggregateDailyMetrics();
    res.json({ success: true, message: 'Aggregation completed' });
  } catch (error) {
    console.error('[QualityMetrics Admin] Aggregation failed:', error);
    res.status(500).json({ error: 'Aggregation failed' });
  }
});

export default router;
