/**
 * US-821: Webhook event routing unit tests
 *
 * Tests:
 * - Handler dispatch via POST /webhooks/events
 * - 422 for unrecognized event type
 * - 500 for handler that throws
 * - 400 for missing event type
 * - dispatchWebhookEvent() registry logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import { Router } from 'express';

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

// ─── Handler registry unit tests ──────────────────────────────────────────────

describe('US-821: dispatchWebhookEvent registry', () => {
  it('dispatches to a registered handler', async () => {
    const { handlerRegistry, dispatchWebhookEvent } = await import('../handlers.js');
    const spy = vi.fn().mockResolvedValue(undefined);
    const original = handlerRegistry['booking_created'];
    handlerRegistry['booking_created'] = spy;

    try {
      await dispatchWebhookEvent({ type: 'booking_created', bookingRef: 'B001' });
      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith({ type: 'booking_created', bookingRef: 'B001' });
    } finally {
      handlerRegistry['booking_created'] = original;
    }
  });

  it('throws UnrecognizedEventError for unknown event type', async () => {
    const { dispatchWebhookEvent, UnrecognizedEventError } = await import('../handlers.js');
    await expect(
      dispatchWebhookEvent({ type: 'totally_unknown_event_xyz' })
    ).rejects.toThrow(UnrecognizedEventError);
  });

  it('re-throws handler errors without wrapping', async () => {
    const { handlerRegistry, dispatchWebhookEvent } = await import('../handlers.js');
    const boom = new Error('boom from handler');
    const original = handlerRegistry['booking_created'];
    handlerRegistry['booking_created'] = vi.fn().mockRejectedValue(boom);

    try {
      await expect(dispatchWebhookEvent({ type: 'booking_created' })).rejects.toThrow('boom from handler');
    } finally {
      handlerRegistry['booking_created'] = original;
    }
  });
});

// ─── HTTP endpoint integration tests ─────────────────────────────────────────

describe('US-821: POST /webhooks/events HTTP routing', () => {
  let server: http.Server;

  beforeEach(async () => {
    // Import router fresh (mocks are already in place)
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

  it('returns 200 for a recognized event type', async () => {
    // Override booking_created handler to avoid DB/WA side effects
    const { handlerRegistry } = await import('../handlers.js');
    const original = handlerRegistry['booking_created'];
    handlerRegistry['booking_created'] = vi.fn().mockResolvedValue(undefined);

    try {
      const res = await makeRequest(server, 'POST', '/webhooks/events', {
        type: 'booking_created',
        bookingRef: 'TEST-001',
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.event).toBe('booking_created');
    } finally {
      handlerRegistry['booking_created'] = original;
    }
  });

  it('returns 422 for an unrecognized event type', async () => {
    const res = await makeRequest(server, 'POST', '/webhooks/events', {
      type: 'not_a_real_event_type',
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/unrecognized event type/i);
    expect(res.body.event).toBe('not_a_real_event_type');
  });

  it('returns 500 when the handler throws', async () => {
    const { handlerRegistry } = await import('../handlers.js');
    const original = handlerRegistry['booking_created'];
    handlerRegistry['booking_created'] = vi.fn().mockRejectedValue(new Error('handler explosion'));

    try {
      const res = await makeRequest(server, 'POST', '/webhooks/events', {
        type: 'booking_created',
      });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Handler error');
      expect(res.body.event).toBe('booking_created');
    } finally {
      handlerRegistry['booking_created'] = original;
    }
  });

  it('returns 400 when the type field is missing', async () => {
    const res = await makeRequest(server, 'POST', '/webhooks/events', {
      payload: 'no type here',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required field: type/i);
  });
});
