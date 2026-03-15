/**
 * US-909: phone_number_quality_update webhook handler tests
 *
 * Tests:
 * - Handler persists quality rating and event type to app_settings for YELLOW events
 * - Handler persists quality rating and event type to app_settings for RED events
 * - Admin notification is sent for YELLOW and RED events
 * - Graceful handling of missing payloads
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

// Track DB upserts
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
}));

// Mock phone-quality — track calls
const updateQualityCalls: Array<{ profileId: string; update: any }> = [];
vi.mock('../../../lib/phone-quality.js', () => ({
  updateQualityState: vi.fn().mockImplementation((profileId: string, update: any) => {
    updateQualityCalls.push({ profileId, update });
    return Promise.resolve();
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

describe('US-909: POST /webhooks/meta/quality — phone_number_quality_update', () => {
  let server: http.Server;

  beforeEach(async () => {
    insertValues.length = 0;
    updateQualityCalls.length = 0;
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

  it('persists YELLOW quality rating and event to app_settings and sends notification', async () => {
    const payload = {
      phone_number: '60123456789',
      event: 'QUALITY_SCORE_CHANGE',
      quality: 'YELLOW',
      messaging_limit_tier: '10000',
      profile_id: 'pelangi',
    };

    const res = await makeRequest(server, 'POST', '/webhooks/meta/quality', payload);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Wait for async processing
    await new Promise(r => setTimeout(r, 150));

    // Verify quality state was updated in-memory
    expect(updateQualityCalls.length).toBeGreaterThanOrEqual(1);
    expect(updateQualityCalls[0].profileId).toBe('pelangi');
    expect(updateQualityCalls[0].update.rating).toBe('YELLOW');

    // Verify quality rating persisted to app_settings
    const ratingInsert = insertValues.find(v => v.key === 'phone_quality_rating_pelangi');
    expect(ratingInsert).toBeDefined();
    expect(ratingInsert!.value).toBe('YELLOW');

    // Verify event type persisted to app_settings
    const eventInsert = insertValues.find(v => v.key === 'phone_quality_event_pelangi');
    expect(eventInsert).toBeDefined();
    expect(eventInsert!.value).toBe('QUALITY_SCORE_CHANGE');

    // Verify admin notification was sent for YELLOW
    expect(qualityNotifyCalls.length).toBeGreaterThanOrEqual(1);
    expect(qualityNotifyCalls[0].rating).toBe('YELLOW');
    expect(qualityNotifyCalls[0].phone).toBe('60123456789');
  });

  it('persists RED quality rating to app_settings and sends notification', async () => {
    const payload = {
      phone_number: '60198765432',
      event: 'FLAGGED',
      quality: 'RED',
      profile_id: 'southern',
    };

    const res = await makeRequest(server, 'POST', '/webhooks/meta/quality', payload);
    expect(res.status).toBe(200);

    await new Promise(r => setTimeout(r, 150));

    // Verify quality rating persisted to app_settings for southern profile
    const ratingInsert = insertValues.find(v => v.key === 'phone_quality_rating_southern');
    expect(ratingInsert).toBeDefined();
    expect(ratingInsert!.value).toBe('RED');

    // Verify event type
    const eventInsert = insertValues.find(v => v.key === 'phone_quality_event_southern');
    expect(eventInsert).toBeDefined();
    expect(eventInsert!.value).toBe('FLAGGED');

    // Verify admin notification for RED
    expect(qualityNotifyCalls.length).toBeGreaterThanOrEqual(1);
    expect(qualityNotifyCalls[0].rating).toBe('RED');
    expect(qualityNotifyCalls[0].status).toBe('FLAGGED');
  });

  it('persists GREEN rating without sending notification', async () => {
    const payload = {
      phone_number: '60123456789',
      event: 'UNFLAGGED',
      quality: 'GREEN',
    };

    const res = await makeRequest(server, 'POST', '/webhooks/meta/quality', payload);
    expect(res.status).toBe(200);

    await new Promise(r => setTimeout(r, 150));

    // Quality state should be updated
    expect(updateQualityCalls.length).toBeGreaterThanOrEqual(1);
    expect(updateQualityCalls[0].update.rating).toBe('GREEN');

    // app_settings should still be written
    const ratingInsert = insertValues.find(v => v.key === 'phone_quality_rating_pelangi');
    expect(ratingInsert).toBeDefined();
    expect(ratingInsert!.value).toBe('GREEN');

    // No admin notification for GREEN
    expect(qualityNotifyCalls.length).toBe(0);
  });

  it('defaults profile to pelangi when profile_id is absent', async () => {
    const payload = {
      phone_number: '60111111111',
      event: 'QUALITY_SCORE_CHANGE',
      quality: 'YELLOW',
    };

    const res = await makeRequest(server, 'POST', '/webhooks/meta/quality', payload);
    expect(res.status).toBe(200);

    await new Promise(r => setTimeout(r, 150));

    // Should default to 'pelangi' profile
    expect(updateQualityCalls[0].profileId).toBe('pelangi');
    const ratingInsert = insertValues.find(v => v.key === 'phone_quality_rating_pelangi');
    expect(ratingInsert).toBeDefined();
  });
});
