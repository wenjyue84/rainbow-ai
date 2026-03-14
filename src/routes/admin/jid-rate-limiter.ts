/**
 * Per-JID Rate Limiter Admin API (US-833)
 *
 * GET /analytics/jid-rate-limiter — current throttled JID count + events in last 24 h
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getThrottledJidCount,
  getThrottleEventsLast24h,
} from '../../assistant/jid-rate-limiter.js';

const router = Router();

router.get('/analytics/jid-rate-limiter', (_req: Request, res: Response) => {
  const events = getThrottleEventsLast24h();
  res.json({
    success: true,
    data: {
      throttledJidCount: getThrottledJidCount(),
      throttleEventsLast24h: events.length,
      recentEvents: events.slice(-50).map(e => ({
        jid: e.jid,
        timestamp: new Date(e.timestamp).toISOString(),
      })),
    },
  });
});

export default router;
