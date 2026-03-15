/**
 * push-notifications.ts — Web Push notification service (US-916)
 *
 * Manages VAPID keys, sending push notifications, and subscription lifecycle.
 * Stores subscriptions in push_subscriptions table, logs deliveries to push_notification_log.
 */

import webpush from 'web-push';
import { pool } from '../lib/db.js';

// ─── VAPID Configuration ─────────────────────────────────────────────
// VAPID keys should be set via env vars. If not present, generate ephemeral
// keys on startup (suitable for dev; production should use stable keys).

let vapidConfigured = false;

function ensureVapidConfigured(): void {
  if (vapidConfigured) return;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@pelangi.my';

  if (publicKey && privateKey) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
    console.log('[Push] VAPID keys configured from environment');
  } else {
    // Generate ephemeral keys for development
    const keys = webpush.generateVAPIDKeys();
    webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
    vapidConfigured = true;
    console.warn('[Push] No VAPID keys in env — generated ephemeral keys (push won\'t persist across restarts)');
    console.log('[Push] Public key:', keys.publicKey);
  }
}

/**
 * Get the VAPID public key for client-side subscription.
 */
export function getVapidPublicKey(): string {
  ensureVapidConfigured();
  return process.env.VAPID_PUBLIC_KEY || '';
}

// ─── DB Table Migration ──────────────────────────────────────────────
// Create tables if they don't exist (safe to call multiple times).

const migrationPromise = pool.query(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(128) NOT NULL,
    profile_id TEXT NOT NULL DEFAULT 'pelangi',
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    max_frequency_minutes INTEGER NOT NULL DEFAULT 30,
    last_notified_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )
`).then(() => pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subs_session_profile
    ON push_subscriptions (session_id, profile_id)
`)).then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS push_notification_log (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(128) NOT NULL,
    profile_id TEXT NOT NULL DEFAULT 'pelangi',
    notification_type VARCHAR(32) NOT NULL,
    payload TEXT,
    delivered BOOLEAN NOT NULL DEFAULT false,
    error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )
`)).then(() => pool.query(`
  CREATE INDEX IF NOT EXISTS idx_push_log_created
    ON push_notification_log (created_at)
`)).catch(err => {
  console.error('[Push] Migration error:', err.message);
});

// ─── Subscription Management ─────────────────────────────────────────

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Save or update a push subscription for a webchat session.
 */
export async function saveSubscription(
  sessionId: string,
  profileId: string,
  subscription: PushSubscriptionData,
): Promise<void> {
  await migrationPromise;
  await pool.query(`
    INSERT INTO push_subscriptions (session_id, profile_id, endpoint, p256dh, auth, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (session_id, profile_id)
    DO UPDATE SET endpoint = $3, p256dh = $4, auth = $5, enabled = true, updated_at = NOW()
  `, [sessionId, profileId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]);
}

/**
 * Remove a push subscription (user opted out).
 */
export async function removeSubscription(sessionId: string, profileId: string): Promise<void> {
  await migrationPromise;
  await pool.query(`
    UPDATE push_subscriptions SET enabled = false, updated_at = NOW()
    WHERE session_id = $1 AND profile_id = $2
  `, [sessionId, profileId]);
}

/**
 * Update notification frequency preference.
 */
export async function updateFrequency(
  sessionId: string,
  profileId: string,
  maxFrequencyMinutes: number,
): Promise<void> {
  await migrationPromise;
  await pool.query(`
    UPDATE push_subscriptions SET max_frequency_minutes = $3, updated_at = NOW()
    WHERE session_id = $1 AND profile_id = $2
  `, [sessionId, profileId, maxFrequencyMinutes]);
}

// ─── Send Notifications ──────────────────────────────────────────────

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  type: 'order_ready' | 'promotion' | 'incomplete_order';
  profileId?: string;
  sessionId?: string;
  tag?: string;
  actions?: Array<{ action: string; title: string }>;
}

/**
 * Send a push notification to a specific session.
 * Respects frequency limits and logs delivery.
 */
export async function sendPushNotification(
  sessionId: string,
  profileId: string,
  payload: PushPayload,
): Promise<boolean> {
  ensureVapidConfigured();
  await migrationPromise;

  // Fetch subscription
  const result = await pool.query(`
    SELECT endpoint, p256dh, auth, last_notified_at, max_frequency_minutes, enabled
    FROM push_subscriptions
    WHERE session_id = $1 AND profile_id = $2
  `, [sessionId, profileId]);

  if (result.rows.length === 0 || !result.rows[0].enabled) {
    return false;
  }

  const sub = result.rows[0];

  // Check frequency limit
  if (sub.last_notified_at) {
    const elapsed = Date.now() - new Date(sub.last_notified_at).getTime();
    const minInterval = (sub.max_frequency_minutes || 30) * 60 * 1000;
    if (elapsed < minInterval) {
      return false; // Too soon
    }
  }

  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  const notificationPayload = JSON.stringify({
    ...payload,
    profileId,
    sessionId,
  });

  try {
    await webpush.sendNotification(pushSubscription, notificationPayload);

    // Update last notified timestamp
    await pool.query(`
      UPDATE push_subscriptions SET last_notified_at = NOW(), updated_at = NOW()
      WHERE session_id = $1 AND profile_id = $2
    `, [sessionId, profileId]);

    // Log successful delivery
    await pool.query(`
      INSERT INTO push_notification_log (session_id, profile_id, notification_type, payload, delivered)
      VALUES ($1, $2, $3, $4, true)
    `, [sessionId, profileId, payload.type, notificationPayload]);

    return true;
  } catch (err: any) {
    // If subscription is expired/invalid (410 Gone or 404), disable it
    if (err.statusCode === 410 || err.statusCode === 404) {
      await pool.query(`
        UPDATE push_subscriptions SET enabled = false, updated_at = NOW()
        WHERE session_id = $1 AND profile_id = $2
      `, [sessionId, profileId]);
    }

    // Log failed delivery
    await pool.query(`
      INSERT INTO push_notification_log (session_id, profile_id, notification_type, payload, delivered, error)
      VALUES ($1, $2, $3, $4, false, $5)
    `, [sessionId, profileId, payload.type, notificationPayload, err.message || String(err)]);

    console.error(`[Push] Failed to send notification to ${sessionId}:`, err.message);
    return false;
  }
}

/**
 * Send push notifications to all active subscribers for a profile.
 * Used for promotions / broadcast notifications.
 */
export async function broadcastPushNotification(
  profileId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  ensureVapidConfigured();
  await migrationPromise;

  const result = await pool.query(`
    SELECT session_id FROM push_subscriptions
    WHERE profile_id = $1 AND enabled = true
  `, [profileId]);

  let sent = 0;
  let failed = 0;

  for (const row of result.rows) {
    const ok = await sendPushNotification(row.session_id, profileId, payload);
    if (ok) sent++;
    else failed++;
  }

  return { sent, failed };
}

/**
 * Get push notification analytics for admin dashboard.
 */
export async function getPushAnalytics(profileId: string): Promise<{
  totalSubscriptions: number;
  activeSubscriptions: number;
  totalSent: number;
  totalDelivered: number;
  deliveryRate: number;
  byType: Record<string, { sent: number; delivered: number }>;
}> {
  await migrationPromise;

  const [subsResult, logResult, typeResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE enabled = true)::int AS active
      FROM push_subscriptions
      WHERE profile_id = $1
    `, [profileId]),
    pool.query(`
      SELECT
        COUNT(*)::int AS total_sent,
        COUNT(*) FILTER (WHERE delivered = true)::int AS total_delivered
      FROM push_notification_log
      WHERE profile_id = $1
    `, [profileId]),
    pool.query(`
      SELECT
        notification_type,
        COUNT(*)::int AS sent,
        COUNT(*) FILTER (WHERE delivered = true)::int AS delivered
      FROM push_notification_log
      WHERE profile_id = $1
      GROUP BY notification_type
    `, [profileId]),
  ]);

  const totalSent = logResult.rows[0]?.total_sent ?? 0;
  const totalDelivered = logResult.rows[0]?.total_delivered ?? 0;

  const byType: Record<string, { sent: number; delivered: number }> = {};
  for (const row of typeResult.rows) {
    byType[row.notification_type] = { sent: row.sent, delivered: row.delivered };
  }

  return {
    totalSubscriptions: subsResult.rows[0]?.total ?? 0,
    activeSubscriptions: subsResult.rows[0]?.active ?? 0,
    totalSent,
    totalDelivered,
    deliveryRate: totalSent > 0 ? totalDelivered / totalSent : 0,
    byType,
  };
}
