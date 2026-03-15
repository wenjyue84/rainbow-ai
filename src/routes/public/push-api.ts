/**
 * push-api.ts — Public Push Notification API (US-916)
 *
 * Endpoints for managing push subscriptions from the webchat widget.
 * These are public endpoints (no admin auth) since they're called
 * from the browser service worker context.
 */

import { Router } from 'express';
import {
  saveSubscription,
  removeSubscription,
  optOutSubscription,
  getVapidPublicKey,
} from '../../lib/push-notifications.js';

const router = Router();

/**
 * GET /push/vapid-key — Return the VAPID public key for client-side subscription
 */
router.get('/vapid-key', (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) {
    res.json({ configured: false });
    return;
  }
  res.json({ configured: true, publicKey: key });
});

/**
 * POST /push/subscribe — Save a push subscription
 * Body: { sessionId, subscription: { endpoint, keys: { p256dh, auth } }, profileId? }
 */
router.post('/subscribe', async (req, res) => {
  try {
    const { sessionId, subscription, profileId } = req.body;
    if (!sessionId || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    await saveSubscription(sessionId, subscription, profileId);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[PushAPI] Subscribe error:', err.message);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

/**
 * POST /push/unsubscribe — Remove a push subscription
 * Body: { endpoint }
 */
router.post('/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      res.status(400).json({ error: 'Missing endpoint' });
      return;
    }

    await removeSubscription(endpoint);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[PushAPI] Unsubscribe error:', err.message);
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

/**
 * POST /push/opt-out — Opt out of push notifications (keep subscription but mark inactive)
 * Body: { sessionId }
 */
router.post('/opt-out', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }

    await optOutSubscription(sessionId);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[PushAPI] Opt-out error:', err.message);
    res.status(500).json({ error: 'Failed to opt out' });
  }
});

export default router;
