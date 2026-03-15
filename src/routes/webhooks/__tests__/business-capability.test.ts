/**
 * US-908: business_capability_update webhook handler tests
 *
 * Tests:
 * - Handler updates the DB row (messaging tier + max phone numbers)
 * - Admin notification is dispatched on tier change
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

// Mock phone-quality
vi.mock('../../../lib/phone-quality.js', () => ({
  updateQualityState: vi.fn().mockResolvedValue(undefined),
}));

// Mock account-status
vi.mock('../../../lib/account-status.js', () => ({
  recordAccountViolation: vi.fn(),
  recordAccountRestriction: vi.fn(),
}));

// Track admin notifications
const capabilityNotifyCalls: Array<{ newTier: string; maxPhones: number | null; previousTier: string | null }> = [];
vi.mock('../../../lib/admin-notifier.js', () => ({
  notifyAdminQualityDegradation: vi.fn().mockResolvedValue(undefined),
  notifyAdminAccountViolation: vi.fn().mockResolvedValue(undefined),
  notifyAdminAccountRestriction: vi.fn().mockResolvedValue(undefined),
  notifyAdminTemplatePaused: vi.fn().mockResolvedValue(undefined),
  notifyAdminCapabilityUpdate: vi.fn().mockImplementation((newTier: string, maxPhones: number | null, previousTier: string | null) => {
    capabilityNotifyCalls.push({ newTier, maxPhones, previousTier });
    return Promise.resolve();
  }),
}));

// Mock messaging-limits getCurrentTier
vi.mock('../../admin/messaging-limits.js', () => ({
  getCurrentTier: vi.fn().mockResolvedValue('10000'),
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

describe('US-908: POST /webhooks/meta/capability', () => {
  let server: http.Server;

  beforeEach(async () => {
    insertValues.length = 0;
    capabilityNotifyCalls.length = 0;

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

  it('returns 200 and updates DB tier for valid business_capability_update payload', async () => {
    const payload = {
      entry: [{
        changes: [{
          field: 'business_capability_update',
          value: {
            max_daily_conversation_per_phone: 100000,
            max_phone_numbers_per_business: 25,
          },
        }],
      }],
    };

    const res = await makeRequest(server, 'POST', '/webhooks/meta/capability', payload);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Wait for async processing
    await new Promise(r => setTimeout(r, 100));

    // Verify DB was updated with tier
    const tierInsert = insertValues.find(v => v.key === 'rainbow_portfolio_tier');
    expect(tierInsert).toBeDefined();
    expect(tierInsert!.value).toBe('100000');

    // Verify max phone numbers stored
    const phonesInsert = insertValues.find(v => v.key === 'rainbow_max_phone_numbers');
    expect(phonesInsert).toBeDefined();
    expect(phonesInsert!.value).toBe('25');
  });

  it('sends admin notification on tier change', async () => {
    const payload = {
      entry: [{
        changes: [{
          field: 'business_capability_update',
          value: {
            max_daily_conversation_per_phone: 100000,
          },
        }],
      }],
    };

    const res = await makeRequest(server, 'POST', '/webhooks/meta/capability', payload);
    expect(res.status).toBe(200);

    // Wait for async processing
    await new Promise(r => setTimeout(r, 100));

    expect(capabilityNotifyCalls.length).toBeGreaterThanOrEqual(1);
    expect(capabilityNotifyCalls[0].newTier).toBe('100000');
    expect(capabilityNotifyCalls[0].previousTier).toBe('10000');
  });

  it('handles payload with no entry changes gracefully', async () => {
    const res = await makeRequest(server, 'POST', '/webhooks/meta/capability', {});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // No DB writes or notifications
    await new Promise(r => setTimeout(r, 50));
    expect(insertValues.length).toBe(0);
    expect(capabilityNotifyCalls.length).toBe(0);
  });

  it('ignores changes with non-matching field name', async () => {
    const payload = {
      entry: [{
        changes: [{
          field: 'some_other_field',
          value: { max_daily_conversation_per_phone: 50000 },
        }],
      }],
    };

    const res = await makeRequest(server, 'POST', '/webhooks/meta/capability', payload);
    expect(res.status).toBe(200);

    await new Promise(r => setTimeout(r, 50));
    expect(insertValues.length).toBe(0);
    expect(capabilityNotifyCalls.length).toBe(0);
  });
});
