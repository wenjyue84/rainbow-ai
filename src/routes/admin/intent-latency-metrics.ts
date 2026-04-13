/**
 * US-552: Intent Classification Latency Metrics Endpoint
 *
 * Provides GET /admin/metrics/intent-latency endpoint that returns
 * p50, p95, p99 percentiles for intent classification latency per profile.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getAllMetrics } from '../../lib/metrics.js';

const router = Router();

/**
 * GET /admin/metrics/intent-latency
 *
 * Returns intent classification latency metrics per profile with percentiles.
 *
 * Response format:
 * {
 *   pelangi: { p50: 45, p95: 120, p99: 250, sample_count: 1000, min: 10, max: 2500, mean: 95.5 },
 *   southern: { ... },
 *   makan: { ... }
 * }
 */
router.get('/intent-latency', (_req: Request, res: Response) => {
  try {
    const metrics = getAllMetrics();

    res.json({
      timestamp: new Date().toISOString(),
      metrics,
      description: 'Intent classification latency percentiles per profile (p50, p95, p99 in milliseconds)',
    });
  } catch (err) {
    const errorMsg = (err as Error).message;
    res.status(500).json({
      error: 'Failed to retrieve latency metrics',
      details: errorMsg,
    });
  }
});

export default router;
