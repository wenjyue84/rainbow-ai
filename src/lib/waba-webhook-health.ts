/**
 * WABA Webhook Subscription Health Check (US-892)
 *
 * On startup and every 6 hours, verifies that the WhatsApp Business Account
 * (WABA) webhook subscription is active via Meta's Graph API. If the
 * subscription is missing, attempts auto-resubscription and alerts admin
 * on failure.
 *
 * Skips gracefully when WABA credentials are absent (e.g. dev environment).
 */

import { loadAdminNotificationSettings } from './admin-notification-settings.js';
import { metaGraphUrl } from './meta-graph-api.js';

// ─── Types ────────────────────────────────────────────────────────

export interface WebhookHealthState {
  webhookSubscribed: boolean | null; // null = not yet checked
  lastCheckedAt: string | null;
  lastError: string | null;
}

interface SubscribedAppsResponse {
  data?: Array<{
    whatsapp_business_api_data?: {
      id?: string;
      link?: string;
      name?: string;
    };
    id?: string;
    link?: string;
    name?: string;
  }>;
  error?: { message: string; type?: string; code?: number };
}

// ─── State ────────────────────────────────────────────────────────

let _state: WebhookHealthState = {
  webhookSubscribed: null,
  lastCheckedAt: null,
  lastError: null,
};

let _intervalHandle: ReturnType<typeof setInterval> | null = null;
let _notifySender: ((phone: string, text: string) => Promise<any>) | null = null;

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ─── Public API ───────────────────────────────────────────────────

/** Get current webhook health state (for /health endpoint). */
export function getWebhookHealthState(): WebhookHealthState {
  return { ..._state };
}

/**
 * Initialize notification sender (called after WhatsApp is connected).
 * Uses the same pattern as pacing-monitor's initPacingNotifier.
 */
export function initWebhookHealthNotifier(
  sender: (phone: string, text: string) => Promise<any>,
): void {
  _notifySender = sender;
}

/**
 * Start the periodic webhook health check (6h interval).
 * First check runs after a 30s delay to avoid blocking startup.
 */
export function startWebhookHealthCheck(): void {
  if (_intervalHandle) return; // already started

  // Initial check with 30s delay
  setTimeout(() => {
    checkWabaSubscription().catch((err) =>
      console.error('[WebhookHealth] Initial check failed:', err.message),
    );
  }, 30_000);

  // Periodic check every 6 hours
  _intervalHandle = setInterval(() => {
    checkWabaSubscription().catch((err) =>
      console.error('[WebhookHealth] Periodic check failed:', err.message),
    );
  }, CHECK_INTERVAL_MS);
}

/** Stop the polling loop (for testing/cleanup). */
export function stopWebhookHealthCheck(): void {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

/** Reset state for testing. */
export function _resetForTesting(): void {
  stopWebhookHealthCheck();
  _state = { webhookSubscribed: null, lastCheckedAt: null, lastError: null };
  _notifySender = null;
}

// ─── Core Check Logic ─────────────────────────────────────────────

/**
 * Check WABA webhook subscription and auto-resubscribe if missing.
 * Exported for testing and manual trigger.
 */
export async function checkWabaSubscription(): Promise<WebhookHealthState> {
  const wabaId = process.env.WABA_BUSINESS_ID || process.env.WABA_ID;
  const accessToken = process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;

  if (!wabaId || !accessToken) {
    // No credentials — skip silently (dev environment)
    _state.lastCheckedAt = new Date().toISOString();
    return _state;
  }

  try {
    const isSubscribed = await fetchSubscriptionStatus(wabaId, accessToken);
    _state.lastCheckedAt = new Date().toISOString();

    if (isSubscribed) {
      _state.webhookSubscribed = true;
      _state.lastError = null;
      console.log('[WebhookHealth] WABA webhook subscription active');
      return _state;
    }

    // Not subscribed — attempt auto-resubscribe
    console.warn('[WebhookHealth] WABA webhook subscription missing — attempting resubscription');
    const resubscribed = await resubscribeApp(wabaId, accessToken);

    if (resubscribed) {
      _state.webhookSubscribed = true;
      _state.lastError = null;
      console.log('[WebhookHealth] Auto-resubscription successful');
    } else {
      _state.webhookSubscribed = false;
      _state.lastError = 'Auto-resubscription failed';
      console.error('[WebhookHealth] Auto-resubscription FAILED — admin notification required');
      await notifyAdminResubscriptionFailed('Resubscription POST returned unsuccessful response');
    }
  } catch (err: any) {
    _state.webhookSubscribed = false;
    _state.lastCheckedAt = new Date().toISOString();
    _state.lastError = err.message || 'Unknown error';
    console.error('[WebhookHealth] Check failed:', err.message);
    await notifyAdminResubscriptionFailed(err.message);
  }

  return _state;
}

// ─── Meta Graph API Calls ─────────────────────────────────────────

/**
 * Check if the app is subscribed to the WABA's webhooks.
 * GET /{waba-id}/subscribed_apps
 */
export async function fetchSubscriptionStatus(
  wabaId: string,
  accessToken: string,
): Promise<boolean> {
  const url = metaGraphUrl(`${wabaId}/subscribed_apps?access_token=${accessToken}`);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Meta API GET subscribed_apps returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as SubscribedAppsResponse;

  if (json.error) {
    throw new Error(`Meta API error: ${json.error.message}`);
  }

  // If data array has entries, the app is subscribed
  return Array.isArray(json.data) && json.data.length > 0;
}

/**
 * Resubscribe the app to the WABA's webhooks.
 * POST /{waba-id}/subscribed_apps
 */
export async function resubscribeApp(
  wabaId: string,
  accessToken: string,
): Promise<boolean> {
  const url = metaGraphUrl(`${wabaId}/subscribed_apps`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Meta API POST subscribed_apps returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { success?: boolean; error?: { message: string } };

  if (json.error) {
    throw new Error(`Meta API resubscribe error: ${json.error.message}`);
  }

  return json.success === true;
}

// ─── Admin Notification ───────────────────────────────────────────

async function notifyAdminResubscriptionFailed(reason: string): Promise<void> {
  try {
    const settings = await loadAdminNotificationSettings();
    if (!settings.enabled || !settings.systemAdminPhone) return;

    const message =
      `⚠️ *WABA Webhook Subscription Alert*\n\n` +
      `The webhook subscription check found the subscription missing ` +
      `and auto-resubscription *failed*.\n\n` +
      `Reason: ${reason}\n` +
      `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}\n\n` +
      `⚡ *Action required:* Manually verify webhook subscription in Meta Business Manager.\n` +
      `Inbound WhatsApp messages may not be received until this is resolved.`;

    if (_notifySender) {
      await _notifySender(settings.systemAdminPhone, message);
      console.log('[WebhookHealth] Admin notification sent');
    } else {
      console.warn('[WebhookHealth] No notification sender configured — logging alert only');
    }
  } catch (err: any) {
    console.error('[WebhookHealth] Failed to send admin notification:', err.message);
  }
}
