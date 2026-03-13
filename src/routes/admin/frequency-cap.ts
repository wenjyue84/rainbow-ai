/**
 * Frequency Cap Analytics Routes (US-441)
 *
 * Exposes per-instance frequency-capped rejection counts for the admin dashboard.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getFrequencyCapStats24h } from '../../lib/frequency-cap.js';
import { ok, serverError } from './http-utils.js';

const router = Router();

/**
 * GET /analytics/frequency-cap
 *
 * Returns the number of messages rejected due to Meta marketing frequency
 * cap (error 131049) in the past 24 hours, broken down by WhatsApp instance.
 *
 * Response shape:
 *   { total: number; byInstance: Record<instanceId, number>; windowHours: 24 }
 */
router.get('/analytics/frequency-cap', async (_req: Request, res: Response) => {
  try {
    const stats = await getFrequencyCapStats24h();
    ok(res, {
      frequency_capped_count_24h: stats.total,
      by_instance: stats.byInstance,
      window_hours: 24,
      description: 'Messages rejected by Meta with error 131049 (marketing frequency cap)',
    });
  } catch (err: any) {
    serverError(res, err);
  }
});

export default router;
