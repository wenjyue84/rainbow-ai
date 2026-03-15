/**
 * analytics-push.ts — Admin API for push notification analytics (US-916)
 *
 * Provides delivery rate tracking and subscription stats for the admin dashboard.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPushAnalytics, broadcastPushNotification } from '../../assistant/push-notifications.js';
import type { PushPayload } from '../../assistant/push-notifications.js';

const router = Router();

/**
 * GET /analytics/push
 * Returns push notification delivery stats for the current profile.
 */
router.get('/analytics/push', async (_req: Request, res: Response) => {
  const profileId = (res.locals as any)?.profileId || 'pelangi';

  try {
    const analytics = await getPushAnalytics(profileId);
    res.json(analytics);
  } catch (err: any) {
    console.error('[Push Analytics] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch push analytics' });
  }
});

/**
 * POST /push/broadcast
 * Send a push notification to all active subscribers for the profile.
 * Body: { title, body, type, url? }
 */
router.post('/push/broadcast', async (req: Request, res: Response) => {
  const profileId = (res.locals as any)?.profileId || 'pelangi';
  const { title, body: msgBody, type, url } = req.body;

  if (!title || !msgBody || !type) {
    res.status(400).json({ error: 'title, body, type required' });
    return;
  }

  const validTypes = ['order_ready', 'promotion', 'incomplete_order'];
  if (!validTypes.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
    return;
  }

  try {
    const result = await broadcastPushNotification(profileId, {
      title,
      body: msgBody,
      type,
      url: url || `/chat/${profileId}`,
    } as PushPayload);
    res.json(result);
  } catch (err: any) {
    console.error('[Push Broadcast] Error:', err.message);
    res.status(500).json({ error: 'Failed to broadcast notification' });
  }
});

export default router;
