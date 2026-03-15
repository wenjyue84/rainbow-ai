/**
 * push-notifications.ts — PWA Web Push Notifications (US-916)
 *
 * Manages push subscriptions and sends notifications to webchat users
 * for order-ready alerts, promotions, and re-engagement.
 *
 * Uses the Web Push Protocol with VAPID authentication.
 * Subscriptions stored in push_subscriptions DB table.
 */

import { pool } from './db.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('push-notifications');

// ─── Types ──────────────────────────────────────────────────────────

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string }>;
}

// ─── Table Setup ────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        profile_id VARCHAR(50) DEFAULT 'makan-moments',
        opted_out BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_used_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_notification_log (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255),
        notification_type VARCHAR(50) NOT NULL,
        title TEXT,
        delivered BOOLEAN DEFAULT FALSE,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    _tableEnsured = true;
  } catch (err: any) {
    logger.warn('Table ensure failed (non-fatal)', { error: err.message });
  }
}

// ─── VAPID Configuration ────────────────────────────────────────────

function getVapidKeys(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@pelangicapsulehostel.com',
  };
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

// ─── Subscription Management ────────────────────────────────────────

export async function saveSubscription(
  sessionId: string,
  subscription: PushSubscriptionData,
  profileId = 'makan-moments'
): Promise<void> {
  await ensureTable();
  await pool.query(
    `INSERT INTO push_subscriptions (session_id, endpoint, p256dh, auth, profile_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       session_id = $1, p256dh = $3, auth = $4, last_used_at = NOW(), opted_out = FALSE`,
    [sessionId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, profileId]
  );
  logger.info('Push subscription saved', { sessionId });
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await ensureTable();
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

export async function optOutSubscription(sessionId: string): Promise<void> {
  await ensureTable();
  await pool.query(
    'UPDATE push_subscriptions SET opted_out = TRUE WHERE session_id = $1',
    [sessionId]
  );
}

// ─── Send Notifications ─────────────────────────────────────────────

export async function sendPushNotification(
  sessionId: string,
  payload: PushNotificationPayload
): Promise<{ sent: number; failed: number }> {
  const vapid = getVapidKeys();
  if (!vapid) {
    logger.warn('VAPID keys not configured — push notification skipped');
    return { sent: 0, failed: 0 };
  }

  await ensureTable();

  const result = await pool.query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions
     WHERE session_id = $1 AND opted_out = FALSE`,
    [sessionId]
  );

  if (result.rows.length === 0) return { sent: 0, failed: 0 };

  // Dynamic import to avoid issues when web-push isn't installed
  const webpush = await import('web-push');
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  let sent = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      const subscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      sent++;

      // Update last_used_at
      pool.query('UPDATE push_subscriptions SET last_used_at = NOW() WHERE endpoint = $1', [row.endpoint]).catch(() => {});
    } catch (err: any) {
      failed++;
      // Remove expired/invalid subscriptions (410 Gone, 404 Not Found)
      if (err.statusCode === 410 || err.statusCode === 404) {
        await removeSubscription(row.endpoint).catch(() => {});
      }
      logger.warn('Push send failed', { endpoint: row.endpoint.slice(0, 50), error: err.message });
    }
  }

  // Log to analytics
  logNotification(sessionId, payload.tag || 'general', payload.title || '', sent > 0).catch(() => {});

  return { sent, failed };
}

export async function sendPushToAllSubscribers(
  profileId: string,
  payload: PushNotificationPayload
): Promise<{ sent: number; failed: number }> {
  const vapid = getVapidKeys();
  if (!vapid) return { sent: 0, failed: 0 };

  await ensureTable();

  const result = await pool.query<{ session_id: string; endpoint: string; p256dh: string; auth: string }>(
    `SELECT session_id, endpoint, p256dh, auth FROM push_subscriptions
     WHERE profile_id = $1 AND opted_out = FALSE`,
    [profileId]
  );

  if (result.rows.length === 0) return { sent: 0, failed: 0 };

  const webpush = await import('web-push');
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  let sent = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err: any) {
      failed++;
      if (err.statusCode === 410 || err.statusCode === 404) {
        await removeSubscription(row.endpoint).catch(() => {});
      }
    }
  }

  return { sent, failed };
}

// ─── Analytics ──────────────────────────────────────────────────────

async function logNotification(
  sessionId: string,
  type: string,
  title: string,
  delivered: boolean,
  error?: string
): Promise<void> {
  try {
    await ensureTable();
    await pool.query(
      `INSERT INTO push_notification_log (session_id, notification_type, title, delivered, error)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, type, title, delivered, error || null]
    );
  } catch { /* non-critical */ }
}

export async function getPushAnalytics(days = 7): Promise<{
  totalSent: number;
  totalDelivered: number;
  deliveryRate: number;
  byType: Array<{ type: string; count: number; delivered: number }>;
  activeSubscriptions: number;
}> {
  await ensureTable();

  const [logResult, subsResult] = await Promise.all([
    pool.query(
      `SELECT notification_type as type,
              COUNT(*)::int as count,
              SUM(CASE WHEN delivered THEN 1 ELSE 0 END)::int as delivered
       FROM push_notification_log
       WHERE created_at >= NOW() - INTERVAL '1 day' * $1
       GROUP BY notification_type`,
      [days]
    ),
    pool.query('SELECT COUNT(*)::int as count FROM push_subscriptions WHERE opted_out = FALSE'),
  ]);

  const byType = logResult.rows.map(r => ({ type: r.type, count: r.count, delivered: r.delivered }));
  const totalSent = byType.reduce((s, r) => s + r.count, 0);
  const totalDelivered = byType.reduce((s, r) => s + r.delivered, 0);

  return {
    totalSent,
    totalDelivered,
    deliveryRate: totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0,
    byType,
    activeSubscriptions: subsResult.rows[0]?.count || 0,
  };
}
