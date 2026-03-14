/**
 * Admin API: Fallback Rate Alert (US-814)
 *
 * GET  /analytics/fallback-alert/history  — alert history (with optional ?profileId=&limit=)
 * POST /analytics/fallback-alert/check    — trigger an immediate manual check
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { dbReady } from '../../lib/db.js';
import { getFallbackAlertHistory, runDailyFallbackCheck } from '../../lib/fallback-alert.js';

const router = Router();

// GET /analytics/fallback-alert/history
router.get('/analytics/fallback-alert/history', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({ success: true, history: [], warning: 'Database unavailable' });
    }

    const profileId = req.query.profileId as string | undefined;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));

    const history = await getFallbackAlertHistory(profileId, limit);
    res.json({ success: true, profileId: profileId || 'all', history });
  } catch (err: any) {
    console.error('[FallbackAlert] History query failed:', err.message);
    res.status(500).json({ error: 'Failed to retrieve alert history' });
  }
});

// POST /analytics/fallback-alert/check — manual trigger
router.post('/analytics/fallback-alert/check', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const results = await runDailyFallbackCheck();
    res.json({ success: true, results });
  } catch (err: any) {
    console.error('[FallbackAlert] Manual check failed:', err.message);
    res.status(500).json({ error: 'Failed to run fallback check' });
  }
});

export default router;
