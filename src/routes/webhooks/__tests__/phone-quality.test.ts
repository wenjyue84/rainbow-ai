/**
 * US-909: phone_number_quality_update webhook handler tests
 *
 * Tests:
 * - Handler persists quality rating and event type to app_settings
 * - Admin notification is sent for YELLOW and RED ratings
 * - No notification sent for GREEN rating
 * - Graceful handling of missing/partial payloads
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock webhook-signature to bypass HMAC checks in tests
vi.mock('../../../lib/webhook-signature.js', () => ({
  validateWebhookSignature: () => (_req: any, _res: any, next: any) => next(),
  validateMetaSignature: () => (_req: any, _res: any, next: any) => next(),
}));

// Mock logger so tests stay quiet
vi.mock('../../../lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Track DB upserts for app_settings
const insertValues: Array<{ key: string; value: string }> = [];

// Mock db and drizzle
vi.mock('../../../lib/db.js', () => {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const valuesFn = vi.fn().mockImplementation((vals: any) => {
    insertValues.push({ key: vals.key, value: vals.value });
    return { onConflictDoUpdate };
  });
  const insertFn = vi.fn().mockReturnValue({ values: valuesFn });
  return {
    db: { insert: insertFn, select: vi.fn() },
  };
});

vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }),
  eq: (a: any, b: any) => ({ a, b }),
}));

vi.mock('../../../../shared/schema.js', () => ({
  appSettings: { key: 'key' },
  templateQualityEvents: {},
  webhookRawEvents: {},
}));

// Track updateQualityState calls
const qualityStateCalls: Array<{ profileId: string; update: any }> = [];
vi.mock('../../../lib/phone-quality.js', () => ({
  updateQualityState: vi.fn().mockImplementation((profileId: string, update: any) => {
    qualityStateCalls.push({ profileId, update });
    return Promise.resolve({
      rating: update.rating ?? 'UNKNOWN',
      status: update.status ?? 'UNKNOWN',
      lastUpdatedAt: new Date().toISOString(),
    });
  }),
}));

// Mock account-status
vi.mock('../../../lib/account-status.js', () => ({
  recordAccountViolation: vi.fn(),
  recordAccountRestriction: vi.fn(),
}));

// Track admin quality degradation notifications
const qualityNotifyCalls: Array<{ profileId: string; rating: string; status: string; phone: string }> = [];
vi.mock('../../../lib/admin-notifier.js', () => ({
  notifyAdminQualityDegradation: vi.fn().mockImplementation(
    (profileId: string, rating: string, status: string, phone: string) => {
      qualityNotifyCalls.push({ profileId, rating, status, phone });
      return Promise.resolve();
    }
  ),
  notifyAdminAccountViolation: vi.fn().mockResolvedValue(undefined),
  notifyAdminAccountRestriction: vi.fn().mockResolvedValue(undefined),
  notifyAdminTemplatePaused: vi.fn().mockResolvedValue(undefined),
  notifyAdminCapabilityUpdate: vi.fn().mockResolvedValue(undefined),
}));

// Mock handlers
vi.mock('../handlers.js', () => ({
  dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined),
  UnrecognizedEventError: class extends Error {
    constructor(public readonly eventType: string) {
      super(`Unrecognized event type: "${eventType}"`);
      this.name = 'UnrecognizedEventError';
    }
  },
}));

// Mock webhook-raw-events
vi.mock('../../../lib/webhook-raw-events.js', () => ({
  persistRawEvent: vi.fn().mockResolvedValue('test-event-id'),
  markRawEventProcessed: vi.fn().mockResolvedValue(undefined),
}));

// Mock meta-messages
vi.mock('../meta-messages.js', () => ({
  parseCloudApiMessages: vi.fn().mockReturnValue([]),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(
  server: http.Server,
  method: 'POST' | 'GET',
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const payload = body != null ? JSON.stringify(body) : undefined;
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode!, body: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('US-909: POST /webhooks/meta/quality', () => {
  let server: http.Server;

  beforeEach(async () => {
    insertValues.length = 0;
    qualityStateCalls.length = 0;
    qualityNotifyCalls.length = 0;

    const { default: webhookRouter } = await import('../index.js');
    const app = express();
    app.use(express.json());
    app.use(webhookRouter);

    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
  });

  afterEach(() => {
    server?.close();
    vi.resetModules();
  });

  it('persists quality rating and event type to app_settings for YELLOW', async () => {
    const payload = {
      phone_number: '60123456789',
      event: 'FLAGGED',
      quality: 'YELLOW',
      messaging_limit_tier: '1000',
      profile_id: 'pelangi',
    };

    const res = await makeRequest(server, 'POST', '/webhooks/meta/quality', payload);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Wait for async fire-and-forget processing
    await new Promise(r => setTimeout(r, 100));

    // Verify app_settings DB writes
    const ratingInsert = insertValues.find(v => v.key === 'phone_quality_rating_pelangi');
    expect(ratingInsert).toBeDefined();
    expect(ratingInsert!.value).toBe('YELLOW');

    const eventInsert = insertValues.find(v => v.key === 'phone_quality_event_pelangi');
    expect(eventInsert).toBeDefined();
    expect(eventInsert!.value).toBe('FLAGGED');

    const tsInsert = insertValues.find(v => v.key === 'phone_quality_updated_at_pelangi');
    expect(tsInsert).toBeDefined();
  });

  it('persists quality rating and event type to app_settings for RED', async () => {
    const payload = {
      phone_number: '60123456789',
      event: 'QUALITY_SCORE_CHANGE',
      quality: 'RED',
      profile_id: 'pelangi',
    };

    const res = await makeRequest(server, 'POST', '/webhooks/meta/quality', payload);
    expect(res.status).toBe(200);

    await new Promise(r => setTimeout(r, 100));

    const ratingInsert = insertValues.find(v => v.key === 'phone_quality_rating_pelangi');
    expect(ratingInsert).toBeDefined();
    expect(ratingInsert!.value).toBe('RED');
  });

  it('sends admin notification for YELLOW rating', async () => {
    const payload = {
      phone_number: '60123456789',
      event: 'FLAGGED',
      quality: 'YELLOW',
      profile_id: 'pelangi',
    };

    const res = await makeRequest(server, 'POST', '/webhooks/meta/quality', payload);
    expect(res.status).toBe(200);

    await new Promise(r => setTimeout(r, 100));

    expect(qualityNotifyCalls.length).toBeGreaterThanOrEqual(1);
    expect(qualityNotifyCalls[0].rating).toBe('YELLOW');
    expect(qualityNotifyCalls[0].profileId).toBe('pelangi');
  });

  it('sends admin notification for RED rating', async () => {
    const payload = {
      phone_number: '60123456789',
      event: 'QUALITY_SCORE_CHANGE',
      quality: 'RED',
      profile_id: 'pelangi',
    };

    const res = await makeRequest(server, 'POST', '/webhooks/meta/quality', payload);
    expect(res.status).toBe(200);

    await new Promise(r => setTimeout(r, 100));

    expect(qualityNotifyCalls.length).toBeGreaterThanOrEqual(1);
    expect(qualityNotifyCalls[0].rating).toBe('RED');
  });

  it('does NOT send admin notification for GREEN rating', async () => {
    const payload = {
      phone_number: '60123456789',
      event: 'UNFLAGGED',
      quality: 'GREEN',
      profile_id: 'pelangi',
    };

    const res = await makeRequest(server, 'POST', '/webhooks/meta/quality', payload);
    expect(res.status).toBe(200);

    await new Promise(r => setTimeout(r, 100));

    expect(qualityNotifyCalls.length).toBe(0);
  });

  it('updates quality state via updateQualityState', async () => {
    const payload = {
      phone_number: '60123456789',
      event: 'FLAGGED',
      quality: 'YELLOW',
      messaging_limit_tier: '1000',
      profile_id: 'pelangi',
    };

    const res = await makeRequest(server, 'POST', '/webhooks/meta/quality', payload);
    expect(res.status).toBe(200);

    await new Promise(r => setTimeout(r, 100));

    expect(qualityStateCalls.length).toBeGreaterThanOrEqual(1);
    expect(qualityStateCalls[0].profileId).toBe('pelangi');
    expect(qualityStateCalls[0].update.rating).toBe('YELLOW');
    expect(qualityStateCalls[0].update.status).toBe('FLAGGED');
  });

  it('handles empty payload gracefully', async () => {
    const res = await makeRequest(server, 'POST', '/webhooks/meta/quality', {});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Still persists with defaults
    await new Promise(r => setTimeout(r, 100));
    expect(qualityStateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('defaults profile_id to pelangi when not provided', async () => {
    const payload = {
      phone_number: '60123456789',
      event: 'FLAGGED',
      quality: 'YELLOW',
    };

    const res = await makeRequest(server, 'POST', '/webhooks/meta/quality', payload);
    expect(res.status).toBe(200);

    await new Promise(r => setTimeout(r, 100));

    const ratingInsert = insertValues.find(v => v.key === 'phone_quality_rating_pelangi');
    expect(ratingInsert).toBeDefined();
  });
});
