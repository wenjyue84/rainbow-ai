/**
 * Admin API: Data retention management (US-419)
 *
 * GET  /api/rainbow/data-retention/stats — Records eligible for purge in next run
 * POST /api/rainbow/data-retention/run   — Manually trigger a retention purge
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getRetentionStats, runRetentionPurge } from '../../lib/data-retention.js';

const router = Router();

// GET /api/rainbow/data-retention/stats
router.get('/data-retention/stats', async (req: Request, res: Response) => {
  try {
    const profileId = req.headers['x-profile-id'] as string | undefined;
    const stats = await getRetentionStats(profileId);
    res.json({ success: true, ...stats });
  } catch (error: any) {
    console.error('[DataRetention] Failed to get stats:', error.message);
    res.status(500).json({ error: 'Failed to retrieve retention stats' });
  }
});

// POST /api/rainbow/data-retention/run
router.post('/data-retention/run', async (req: Request, res: Response) => {
  try {
    const profileId = (req.headers['x-profile-id'] as string | undefined)
      ?? (req.body?.profile_id as string | undefined);
    const result = await runRetentionPurge(profileId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[DataRetention] Manual purge failed:', error.message);
    res.status(500).json({ error: 'Retention purge failed' });
  }
});

export default router;
