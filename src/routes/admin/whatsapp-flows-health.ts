/**
 * US-934: Admin API — WhatsApp Flows Health and Error Monitoring
 *
 * GET  /analytics/flows-health         — per-flow health status with traffic-light indicators
 * GET  /analytics/flows-health/errors  — recent endpoint failures with flow_id, screen_id, error_code
 * POST /analytics/flows-health/check   — trigger immediate health evaluation
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  runFlowHealthCheck,
  getRecentFlowErrors,
} from '../../lib/whatsapp-flows-health.js';

const router = Router();

// GET /analytics/flows-health — per-flow health dashboard
router.get('/analytics/flows-health', async (_req: Request, res: Response) => {
  try {
    const flows = await runFlowHealthCheck();

    // Overall status: worst of all flows
    let overall: 'healthy' | 'degraded' | 'broken' = 'healthy';
    for (const f of flows) {
      if (f.status === 'broken') { overall = 'broken'; break; }
      if (f.status === 'degraded') overall = 'degraded';
    }

    res.json({
      timestamp: new Date().toISOString(),
      overall,
      flows,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve flow health' });
  }
});

// GET /analytics/flows-health/errors — recent endpoint failures
router.get('/analytics/flows-health/errors', async (req: Request, res: Response) => {
  try {
    const flowId = req.query.flow_id as string | undefined;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));

    const errors = await getRecentFlowErrors(flowId, limit);
    res.json({
      flow_id: flowId || 'all',
      count: errors.length,
      errors,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve flow errors' });
  }
});

// POST /analytics/flows-health/check — trigger immediate health check
router.post('/analytics/flows-health/check', async (_req: Request, res: Response) => {
  try {
    const results = await runFlowHealthCheck();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      flows: results,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to run flow health check' });
  }
});

export default router;
