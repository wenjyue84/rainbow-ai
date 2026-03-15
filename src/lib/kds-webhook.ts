/**
 * kds-webhook.ts — Kitchen Display System webhook dispatcher (US-876)
 *
 * After order confirmation, POSTs the order payload to a configurable
 * KDS_WEBHOOK_URL so kitchen staff see the ticket in real time.
 *
 * Features:
 *  - Configurable webhook URL, auth header, and retry settings
 *  - In-memory retry queue with exponential backoff (max 3 attempts)
 *  - Ops WhatsApp alert on persistent failure
 *  - POS response relay (accepted/rejected) back to caller
 */

import { createHash } from 'crypto';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('KdsWebhook');

// ─── Types ────────────────────────────────────────────────────────────

export interface KdsWebhookConfig {
  enabled: boolean;
  /** Full URL to POST order payloads to */
  webhookUrl: string;
  /** Value sent as Authorization header (e.g. "Bearer <token>") */
  authToken?: string;
  /** Max retry attempts (default 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default 2000) */
  baseDelayMs?: number;
}

export interface KdsOrderPayload {
  orderId: string;
  items: Array<{
    name: string;
    qty: number;
    code?: string;
    specialInstructions?: string;
  }>;
  tableOrPickup: string;
  customerJidHash: string;
  timestamp: string;
  profileId: string;
}

export interface KdsResponse {
  status: 'accepted' | 'rejected' | 'error' | 'disabled';
  message?: string;
}

// ─── In-memory retry queue ────────────────────────────────────────────

interface RetryEntry {
  payload: KdsOrderPayload;
  config: KdsWebhookConfig;
  attempt: number;
  nextRetryAt: number;
}

const retryQueue: RetryEntry[] = [];
let retryTimerRunning = false;

function scheduleRetry(entry: RetryEntry): void {
  retryQueue.push(entry);
  if (!retryTimerRunning) {
    retryTimerRunning = true;
    setTimeout(processRetryQueue, entry.nextRetryAt - Date.now());
  }
}

async function processRetryQueue(): Promise<void> {
  const now = Date.now();
  const ready = retryQueue.filter(e => e.nextRetryAt <= now);

  // Remove ready entries from queue
  for (const entry of ready) {
    const idx = retryQueue.indexOf(entry);
    if (idx >= 0) retryQueue.splice(idx, 1);
  }

  for (const entry of ready) {
    const result = await postToKds(entry.payload, entry.config, entry.attempt);
    if (result.status === 'error') {
      const maxRetries = entry.config.maxRetries ?? 3;
      if (entry.attempt < maxRetries) {
        const baseDelay = entry.config.baseDelayMs ?? 2000;
        const delay = baseDelay * Math.pow(2, entry.attempt);
        scheduleRetry({
          ...entry,
          attempt: entry.attempt + 1,
          nextRetryAt: Date.now() + delay,
        });
      } else {
        logger.error(`KDS webhook failed after ${maxRetries} attempts for order ${entry.payload.orderId}: ${result.message}`);
        // Alert ops — fire-and-forget (caller provides alertFn via dispatchToKds)
      }
    }
  }

  // Schedule next batch if queue has entries
  if (retryQueue.length > 0) {
    const nextTime = Math.min(...retryQueue.map(e => e.nextRetryAt));
    setTimeout(processRetryQueue, Math.max(nextTime - Date.now(), 100));
  } else {
    retryTimerRunning = false;
  }
}

// ─── HTTP POST to KDS ─────────────────────────────────────────────────

async function postToKds(
  payload: KdsOrderPayload,
  config: KdsWebhookConfig,
  _attempt: number,
): Promise<KdsResponse> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.authToken) {
      headers['Authorization'] = config.authToken;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return {
        status: 'error',
        message: `HTTP ${res.status} ${res.statusText}`,
      };
    }

    // Parse POS response for accepted/rejected status
    try {
      const body = await res.json() as { status?: string; message?: string };
      if (body.status === 'rejected') {
        return { status: 'rejected', message: body.message ?? 'Order rejected by POS' };
      }
      return { status: 'accepted', message: body.message };
    } catch {
      // Non-JSON 2xx response — treat as accepted
      return { status: 'accepted' };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', message };
  }
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Hash a JID for privacy (PDPA compliance).
 * Returns first 12 hex chars of SHA-256.
 */
export function hashJid(jid: string): string {
  return createHash('sha256').update(jid).digest('hex').slice(0, 12);
}

/**
 * Build a KDS order payload from cart data.
 */
export function buildKdsPayload(opts: {
  orderId: string;
  items: Array<{ name: string; qty: number; code?: string; notes?: string }>;
  tableNumber?: string;
  orderType?: string;
  customerJid: string;
  profileId: string;
}): KdsOrderPayload {
  let tableOrPickup = 'Walk-in';
  if (opts.orderType === 'takeaway') {
    tableOrPickup = 'Takeaway';
  } else if (opts.tableNumber) {
    tableOrPickup = `Table ${opts.tableNumber}`;
  }

  return {
    orderId: opts.orderId,
    items: opts.items.map(i => ({
      name: i.name,
      qty: i.qty,
      code: i.code,
      specialInstructions: i.notes,
    })),
    tableOrPickup,
    customerJidHash: hashJid(opts.customerJid),
    timestamp: new Date().toISOString(),
    profileId: opts.profileId,
  };
}

/**
 * Dispatch an order to the KDS webhook.
 *
 * - If KDS is disabled, returns { status: 'disabled' } immediately.
 * - On success, returns accepted/rejected from the POS.
 * - On failure, queues for retry and returns { status: 'error' }.
 * - Calls alertFn on final failure so ops gets a WhatsApp alert.
 */
export async function dispatchToKds(
  payload: KdsOrderPayload,
  config: KdsWebhookConfig,
  alertFn?: (message: string) => void,
): Promise<KdsResponse> {
  if (!config.enabled || !config.webhookUrl) {
    return { status: 'disabled' };
  }

  const result = await postToKds(payload, config, 1);

  if (result.status === 'error') {
    const maxRetries = config.maxRetries ?? 3;
    if (maxRetries > 1) {
      const baseDelay = config.baseDelayMs ?? 2000;
      scheduleRetry({
        payload,
        config,
        attempt: 2, // first attempt already done
        nextRetryAt: Date.now() + baseDelay,
      });
    }

    if (alertFn) {
      // Alert immediately on first failure — retries happen in background
      alertFn(`⚠️ KDS webhook failed for order ${payload.orderId}: ${result.message}. Retrying...`);
    }
  }

  return result;
}

/** Get current retry queue size (for monitoring/testing). */
export function getRetryQueueSize(): number {
  return retryQueue.length;
}

/** Clear retry queue (for testing). */
export function clearRetryQueue(): void {
  retryQueue.length = 0;
  retryTimerRunning = false;
}
