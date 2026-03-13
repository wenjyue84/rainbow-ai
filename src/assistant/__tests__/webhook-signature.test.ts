/**
 * Tests for US-442: webhook HMAC-SHA256 signature validation middleware.
 */

import crypto from 'crypto';
import { describe, it, expect, vi } from 'vitest';
import { validateWebhookSignature, captureRawBody } from '../../lib/webhook-signature.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-secret-abc123';

function signBody(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function makeMocks(overrides?: {
  sigHeader?: string | string[];
  rawBody?: Buffer;
}) {
  const body = JSON.stringify({ event: 'message.upsert' });
  const req: any = {
    headers: {
      'x-hub-signature-256': overrides?.sigHeader ?? signBody(body, TEST_SECRET),
    },
    rawBody: overrides?.rawBody ?? Buffer.from(body),
  };
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  return { req, res, next, body };
}

// ─── captureRawBody ──────────────────────────────────────────────────────────

describe('captureRawBody', () => {
  it('attaches the buffer as req.rawBody', () => {
    const req: any = {};
    const buf = Buffer.from('{"hello":"world"}');
    captureRawBody(req, {} as any, buf);
    expect(req.rawBody).toBe(buf);
  });
});

// ─── validateWebhookSignature ────────────────────────────────────────────────

describe('validateWebhookSignature — no secret (permissive mode)', () => {
  it('returns a pass-through middleware that always calls next()', () => {
    const guard = validateWebhookSignature('');
    const { req, res, next } = makeMocks({ sigHeader: undefined });
    delete req.headers['x-hub-signature-256'];
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('validateWebhookSignature — valid secret', () => {
  it('calls next() when X-Hub-Signature-256 matches body HMAC', () => {
    const guard = validateWebhookSignature(TEST_SECRET);
    const { req, res, next } = makeMocks();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when signature header is missing', () => {
    const guard = validateWebhookSignature(TEST_SECRET);
    const { req, res, next } = makeMocks();
    delete req.headers['x-hub-signature-256'];
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing X-Hub-Signature-256 header' });
  });

  it('returns 401 when body was tampered after signing', () => {
    const guard = validateWebhookSignature(TEST_SECRET);
    const originalBody = '{"event":"message.upsert"}';
    const tamperedBody = '{"event":"message.delete"}';
    const req: any = {
      headers: { 'x-hub-signature-256': signBody(originalBody, TEST_SECRET) },
      rawBody: Buffer.from(tamperedBody),
    };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid webhook signature' });
  });

  it('returns 401 when signature uses a different secret', () => {
    const guard = validateWebhookSignature(TEST_SECRET);
    const body = '{"event":"message.upsert"}';
    const wrongSig = signBody(body, 'wrong-secret');
    const req: any = {
      headers: { 'x-hub-signature-256': wrongSig },
      rawBody: Buffer.from(body),
    };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 400 when rawBody was not captured (verify not wired)', () => {
    const guard = validateWebhookSignature(TEST_SECRET);
    const body = '{"event":"test"}';
    const req: any = {
      headers: { 'x-hub-signature-256': signBody(body, TEST_SECRET) },
      // rawBody intentionally absent
    };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
