/**
 * WABA Webhook Subscription Health Check (US-892)
 *
 * Meta's developer experience change in late 2025 means the WABA-to-App webhook
 * subscription can fail silently. This module checks on startup (and every 6 hours)
 * that the app is subscribed to the WABA, and auto-resubscribes if not.
 *
 * Required env vars (all optional — check is skipped gracefully if absent):
 *   WABA_ID            — WhatsApp Business Account ID
 *   META_ACCESS_TOKEN  — Permanent or system-user Graph API access token
 */

import { createModuleLogger } from './logger.js';
import { WA_API_TIMEOUT_MS } from './timeouts.js';

const logger = createModuleLogger('WABASubscriptionCheck');

const GRAPH_API_BASE = 'https://graph.facebook.com/v20.0';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// In-memory state exposed to /health endpoint
let _webhookSubscribed: boolean | null = null;
let _lastCheckedAt: string | null = null;

export function getWebhookSubscriptionState(): {
  webhookSubscribed: boolean | null;
  lastCheckedAt: string | null;
  skipped: boolean;
} {
  const hasCredentials = !!(process.env.WABA_ID && process.env.META_ACCESS_TOKEN);
  return {
    webhookSubscribed: _webhookSubscribed,
    lastCheckedAt: _lastCheckedAt,
    skipped: !hasCredentials,
  };
}

/**
 * Check whether the current app is listed as a subscribed app on the WABA.
 * Returns true if subscribed, false if not.
 * Throws on network / auth errors.
 */
async function isSubscribed(wabaId: string, token: string): Promise<boolean> {
  const url = `${GRAPH_API_BASE}/${wabaId}/subscribed_apps`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WA_API_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Graph API ${res.status}: ${body}`);
    }

    const data = await res.json() as { data?: Array<{ whatsapp_business_api_data?: { id: string } }> };
    // data.data is an array of subscribed app objects; non-empty means we're subscribed
    return Array.isArray(data.data) && data.data.length > 0;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Subscribe the current app to the WABA.
 * Throws on network / auth errors.
 */
async function subscribe(wabaId: string, token: string): Promise<void> {
  const url = `${GRAPH_API_BASE}/${wabaId}/subscribed_apps`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WA_API_TIMEOUT_MS);

  try {
    // US-909: Explicitly subscribe to phone_number_quality_update alongside messages
    const params = new URLSearchParams();
    params.set('subscribed_fields', [
      'messages',
      'phone_number_quality_update',
      'account_update',
      'message_template_status_update',
      'business_capability_update',
    ].join(','));

    const res = await fetch(`${url}?${params.toString()}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Graph API ${res.status}: ${body}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one subscription health check cycle.
 * - Checks if the app is subscribed.
 * - If not, attempts auto-resubscription.
 * - Sends admin notification if resubscription fails.
 * - Updates in-memory state for /health endpoint.
 */
export async function runSubscriptionCheck(): Promise<void> {
  const wabaId = process.env.WABA_ID;
  const token = process.env.META_ACCESS_TOKEN;

  if (!wabaId || !token) {
    logger.debug('WABA_ID or META_ACCESS_TOKEN not set — skipping subscription check');
    return;
  }

  logger.info('Running WABA webhook subscription check', { wabaId });

  try {
    const subscribed = await isSubscribed(wabaId, token);
    _lastCheckedAt = new Date().toISOString();

    if (subscribed) {
      _webhookSubscribed = true;
      logger.info('WABA webhook subscription: OK');
      return;
    }

    // Not subscribed — attempt auto-resubscription
    logger.warn('WABA webhook subscription missing — attempting auto-resubscription');

    try {
      await subscribe(wabaId, token);
      _webhookSubscribed = true;
      logger.info('WABA webhook auto-resubscription: SUCCESS');
    } catch (resubErr: any) {
      _webhookSubscribed = false;
      logger.error('WABA webhook auto-resubscription FAILED', {
        error: resubErr.message,
      });

      // Notify admin of the failure
      try {
        const { notifyAdminWabaSubscriptionFailed } = await import('./admin-notifier.js');
        await notifyAdminWabaSubscriptionFailed(wabaId, resubErr.message);
      } catch (notifyErr: any) {
        logger.error('Failed to send admin notification', { error: notifyErr.message });
      }
    }
  } catch (err: any) {
    _lastCheckedAt = new Date().toISOString();
    logger.error('WABA subscription check error', { error: err.message });
    // Don't mark as false on network errors — keep last known state
  }
}

/**
 * Start the subscription check on startup and schedule re-checks every 6 hours.
 * Safe to call multiple times (idempotent via module-level flag).
 */
let _started = false;

export function startWabaSubscriptionMonitor(): void {
  if (_started) return;
  _started = true;

  // Run immediately on startup (fire-and-forget)
  runSubscriptionCheck().catch(err =>
    logger.error('Startup subscription check threw', { error: err.message })
  );

  // Schedule recurring checks
  setInterval(() => {
    runSubscriptionCheck().catch(err =>
      logger.error('Scheduled subscription check threw', { error: err.message })
    );
  }, CHECK_INTERVAL_MS).unref(); // .unref() so this timer won't prevent process exit
}
