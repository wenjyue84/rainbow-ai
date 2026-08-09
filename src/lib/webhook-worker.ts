/**
 * webhook-worker.ts — Outbound webhook delivery worker.
 * Listens to parityEvents EventEmitter, fans out to registered webhooks.
 * Signs payloads with HMAC-SHA256 (x-periskope-signature header).
 * Retry: exponential backoff, 5 attempts, dead-letter on final failure.
 */
import { EventEmitter } from 'events';
import { createHmac, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { listActiveWebhooks, recordDeliveryAttempt } from './parity-db.js';

const DATA_DIR = process.env.PARITY_DATA_DIR || './data';
const SIGNING_KEY_PATH = join(DATA_DIR, 'webhook_signing_key');
const ORG_ID = process.env.ORG_ID || 'local';
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY = 4_096;

// ── Global event bus ──────────────────────────────────────────────────────

/** Emit parity events here; the worker fans them out to registered webhooks. */
export const parityEvents = new EventEmitter();
parityEvents.setMaxListeners(200);

// ── Signing key ───────────────────────────────────────────────────────────

let _signingKey = '';

function loadOrCreateKey(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true });
  const keyPath = join(dataDir, 'webhook_signing_key');
  if (existsSync(keyPath)) {
    return readFileSync(keyPath, 'utf-8').trim();
  }
  const key = randomBytes(32).toString('hex');
  writeFileSync(keyPath, key, 'utf-8');
  return key;
}

function sign(body: string): string {
  return createHmac('sha256', _signingKey).update(body).digest('hex');
}

// ── SSRF guard ────────────────────────────────────────────────────────────

function isSsrfBlocked(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
    if (h.startsWith('169.254.') || h.startsWith('fe80:')) return true;
    if (h.startsWith('10.') || h.startsWith('192.168.')) return true;
    const parts = h.split('.').map(Number);
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    return false;
  } catch {
    return true;
  }
}

// ── HTTP delivery ─────────────────────────────────────────────────────────

async function deliverOnce(hookUrl: string, body: string, signature: string): Promise<{ status: number; ok: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(hookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-periskope-signature': signature,
      },
      body,
      signal: ctrl.signal,
      redirect: 'manual',
    });
    // Drain and cap response body to avoid memory leaks
    const text = await resp.text().catch(() => '');
    void text.slice(0, MAX_RESPONSE_BODY);
    return { status: resp.status, ok: resp.ok };
  } finally {
    clearTimeout(timer);
  }
}

async function deliverWithRetry(wh: any, eventType: string, data: any): Promise<void> {
  const deliveryId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const envelope = JSON.stringify({
    event: eventType,
    data,
    org_id: ORG_ID,
    timestamp: new Date().toISOString(),
  });
  const signature = sign(envelope);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await new Promise(r => setTimeout(r, BACKOFF_MS[attempt - 2] ?? 16_000));
    }

    let statusCode: number | null = null;
    let error: string | null = null;
    let success = false;

    try {
      const result = await deliverOnce(wh.hook_url, envelope, signature);
      statusCode = result.status;
      success = result.ok;
      if (!success) error = `HTTP ${statusCode}`;
    } catch (err: any) {
      error = err.message?.slice(0, 200) ?? 'unknown';
    }

    recordDeliveryAttempt({
      deliveryId,
      webhookId: wh.id,
      eventType,
      payload: envelope,
      attempt,
      statusCode,
      error,
      success,
    });

    if (success) return;

    const isFinal = attempt >= MAX_ATTEMPTS;
    if (isFinal) {
      console.warn(`[webhook-worker] Dead-letter: webhook ${wh.id} failed after ${MAX_ATTEMPTS} attempts (event: ${eventType})`);
      return;
    }
  }
}

// ── Webhook event matching ────────────────────────────────────────────────

function webhookMatchesEvent(wh: any, eventType: string): boolean {
  try {
    const events: string[] = JSON.parse(wh.integration_name || '[]');
    return events.includes('*') || events.includes(eventType);
  } catch {
    return false;
  }
}

// ── Worker start ─────────────────────────────────────────────────────────

export function initWebhookWorker(dataDir: string = DATA_DIR): void {
  _signingKey = loadOrCreateKey(dataDir);

  parityEvents.on('parity:event', ({ type, data }: { type: string; data: any }) => {
    // Fan out to all active matching webhooks — fire-and-forget
    let webhooks: any[];
    try {
      webhooks = listActiveWebhooks().filter(wh => {
        if (isSsrfBlocked(wh.hook_url)) return false;
        return webhookMatchesEvent(wh, type);
      });
    } catch {
      return; // DB not ready yet
    }

    for (const wh of webhooks) {
      deliverWithRetry(wh, type, data).catch(err => {
        console.error(`[webhook-worker] Unhandled delivery error for ${wh.id}:`, err.message);
      });
    }
  });

  console.log('[webhook-worker] ✅ Webhook delivery worker started');
}

/** Emit a parity event. Call from event handlers (messages.upsert, tickets CRUD, etc.) */
export function emitParityEvent(type: string, data: any): void {
  parityEvents.emit('parity:event', { type, data });
}
