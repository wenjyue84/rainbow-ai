/**
 * kds-webhook.ts — POS/KDS webhook integration (US-876, US-1014)
 *
 * Sends confirmed orders to an external Kitchen Display System via HTTP POST.
 * Supports retry with exponential backoff and persistent fallback queue.
 *
 * US-1014: Admin-configurable endpoint URL and auth token per profile.
 * Config priority: env vars > settings.json > disabled.
 */

import { createHash } from 'crypto';
import { createModuleLogger } from './logger.js';
import { sendWhatsAppMessage, getWhatsAppStatus } from './baileys-client.js';

const logger = createModuleLogger('kds-webhook');

// ─── Configuration (env vars override settings, settings override defaults) ──

const KDS_WEBHOOK_URL = () => process.env.KDS_WEBHOOK_URL || '';
const KDS_WEBHOOK_AUTH_TOKEN = () => process.env.KDS_WEBHOOK_AUTH_TOKEN || '';
const KDS_MAX_RETRIES = 3;
const KDS_BASE_DELAY_MS = 1000; // 1s, 2s, 4s exponential backoff

/** Runtime config overrides from settings.json (set via setKdsConfig) */
let settingsUrl = '';
let settingsAuthToken = '';

/** Update KDS config from admin settings (called when settings load/change) */
export function setKdsConfig(config: { webhookUrl?: string; webhookAuthToken?: string }): void {
  settingsUrl = config.webhookUrl || '';
  settingsAuthToken = config.webhookAuthToken || '';
}

/** Resolve effective KDS URL: env var takes precedence over settings */
function resolveUrl(): string {
  return KDS_WEBHOOK_URL() || settingsUrl;
}

/** Resolve effective KDS auth token: env var takes precedence over settings */
function resolveAuthToken(): string {
  return KDS_WEBHOOK_AUTH_TOKEN() || settingsAuthToken;
}

// ─── Types ──────────────────────────────────────────────────────────

export interface KdsOrderPayload {
  orderId: string;
  items: KdsOrderItem[];
  tableOrPickup: string;        // e.g. "Table 5" or "Takeaway"
  customerJidHash: string;      // SHA-256 hash of JID for privacy
  timestamp: string;            // ISO 8601
  profileId: string;
}

export interface KdsOrderItem {
  name: string;
  code?: string;
  qty: number;
  specialInstructions?: string;
}

export interface KdsWebhookResult {
  success: boolean;
  posStatus?: string;           // accepted | rejected | unknown
  posMessage?: string;          // status message from POS
  error?: string;
}

// ─── In-memory retry queue ──────────────────────────────────────────

interface QueueEntry {
  payload: KdsOrderPayload;
  attempt: number;
  nextRetryAt: number;
  opsPhone: string;
}

const retryQueue: QueueEntry[] = [];
let retryTimerActive = false;

// ─── Core: send order to KDS webhook ────────────────────────────────

export async function sendToKds(
  payload: KdsOrderPayload,
  opsPhone: string
): Promise<KdsWebhookResult> {
  const url = resolveUrl();
  if (!url) {
    logger.debug('KDS webhook URL not configured, skipping');
    return { success: false, error: 'KDS webhook URL not configured' };
  }

  try {
    const result = await postToKds(url, payload);
    logger.info('KDS webhook delivered', { orderId: payload.orderId, posStatus: result.posStatus });
    return result;
  } catch (err: any) {
    logger.warn('KDS webhook failed, queuing for retry', { orderId: payload.orderId, error: err.message });
    enqueueRetry(payload, opsPhone, 0);
    return { success: false, error: err.message };
  }
}

async function postToKds(url: string, payload: KdsOrderPayload): Promise<KdsWebhookResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authToken = resolveAuthToken();
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10s timeout

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`KDS returned HTTP ${res.status}`);
    }

    // Parse POS response for status relay
    try {
      const data = await res.json() as Record<string, any>;
      return {
        success: true,
        posStatus: data.status || 'accepted',
        posMessage: data.message || undefined,
      };
    } catch {
      // Non-JSON response is fine — treat as accepted
      return { success: true, posStatus: 'accepted' };
    }
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ─── Retry logic with exponential backoff ───────────────────────────

function enqueueRetry(payload: KdsOrderPayload, opsPhone: string, attempt: number) {
  if (attempt >= KDS_MAX_RETRIES) {
    logger.error('KDS webhook exhausted retries', { orderId: payload.orderId });
    sendOpsAlert(payload.orderId, opsPhone);
    return;
  }

  const delay = KDS_BASE_DELAY_MS * Math.pow(2, attempt);
  retryQueue.push({
    payload,
    attempt: attempt + 1,
    nextRetryAt: Date.now() + delay,
    opsPhone,
  });

  if (!retryTimerActive) {
    retryTimerActive = true;
    setTimeout(processRetryQueue, delay);
  }
}

async function processRetryQueue() {
  const now = Date.now();
  const ready = retryQueue.filter(e => e.nextRetryAt <= now);

  // Remove ready entries from queue
  for (const entry of ready) {
    const idx = retryQueue.indexOf(entry);
    if (idx !== -1) retryQueue.splice(idx, 1);
  }

  for (const entry of ready) {
    const url = resolveUrl();
    if (!url) continue;

    try {
      await postToKds(url, entry.payload);
      logger.info('KDS webhook retry succeeded', { orderId: entry.payload.orderId, attempt: entry.attempt });
    } catch (err: any) {
      logger.warn('KDS webhook retry failed', { orderId: entry.payload.orderId, attempt: entry.attempt, error: err.message });
      enqueueRetry(entry.payload, entry.opsPhone, entry.attempt);
    }
  }

  // Schedule next batch if entries remain
  if (retryQueue.length > 0) {
    const nextTime = Math.min(...retryQueue.map(e => e.nextRetryAt));
    setTimeout(processRetryQueue, Math.max(nextTime - Date.now(), 100));
  } else {
    retryTimerActive = false;
  }
}

// ─── Ops alert on persistent failure ────────────────────────────────

async function sendOpsAlert(orderId: string, opsPhone: string) {
  if (!opsPhone) return;
  try {
    const status = getWhatsAppStatus();
    if (status.state === 'open') {
      await sendWhatsAppMessage(
        opsPhone,
        `⚠️ KDS Webhook Failed\n\nOrder ${orderId} could not be sent to the kitchen display system after ${KDS_MAX_RETRIES} attempts. Please check the POS connection and manually enter this order.\n\n— Rainbow AI`
      );
      logger.info('Sent KDS failure alert to ops', { orderId, opsPhone });
    } else {
      logger.warn('WhatsApp not connected, cannot send KDS failure alert', { orderId });
    }
  } catch (err: any) {
    logger.error('Failed to send KDS alert', { orderId, error: err.message });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

export function hashJid(jid: string): string {
  return createHash('sha256').update(jid).digest('hex').slice(0, 16);
}

export function isKdsEnabled(settings: Record<string, any>): boolean {
  return settings?.kds?.enabled === true;
}

export function getKdsOpsPhone(settings: Record<string, any>): string {
  return settings?.kds?.opsNotifyPhone || settings?.staff?.phones?.[0] || '';
}

/** Build a KDS payload from cart data */
export function buildKdsPayload(opts: {
  orderId: string;
  items: Array<{ name: string; code?: string; qty: number; notes?: string }>;
  tableNumber?: string;
  orderType?: string;
  jid: string;
  profileId: string;
}): KdsOrderPayload {
  return {
    orderId: opts.orderId,
    items: opts.items.map(i => ({
      name: i.name,
      ...(i.code ? { code: i.code } : {}),
      qty: i.qty,
      ...(i.notes ? { specialInstructions: i.notes } : {}),
    })),
    tableOrPickup: opts.orderType === 'takeaway'
      ? 'Takeaway'
      : opts.tableNumber
        ? `Table ${opts.tableNumber}`
        : 'Walk-in',
    customerJidHash: hashJid(opts.jid),
    timestamp: new Date().toISOString(),
    profileId: opts.profileId,
  };
}
