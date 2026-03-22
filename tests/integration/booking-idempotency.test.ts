/**
 * US-149: Idempotent booking confirmation — integration tests
 *
 * Tests:
 * 1. Missing idempotency key -> 400
 * 2. Invalid (non-UUID) key -> 400
 * 3. Key via header: first request creates booking -> 200 + booking_id
 * 4. Duplicate request with same key -> 200 + same booking_id (cached)
 * 5. Key via query param: first request creates booking -> 200 + booking_id
 * 6. Different keys produce independent bookings
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import bookingConfirmRouter, { idempotencyCache } from '../../src/routes/booking-confirm.js';

// ─── Test App ────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(bookingConfirmRouter);
  return app;
}

const VALID_UUID_1 = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

const VALID_BODY = {
  guestName: 'Alice Tan',
  checkIn: '2026-05-01',
  checkOut: '2026-05-03',
  roomType: 'capsule',
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('US-149: booking-confirm idempotency', () => {
  beforeEach(() => {
    idempotencyCache.clear();
  });

  // ── Test 1: Missing idempotency key ──────────────────────────────
  it('returns 400 when idempotency-key header is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/booking-confirm')
      .send(VALID_BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/idempotency-key/i);
  });

  // ── Test 2: Invalid UUID key ──────────────────────────────────────
  it('returns 400 for non-UUID idempotency-key', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/booking-confirm')
      .set('idempotency-key', 'not-a-uuid')
      .send(VALID_BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uuid/i);
  });

  // ── Test 3: First request via header ─────────────────────────────
  it('creates booking on first request with valid UUID header', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/booking-confirm')
      .set('idempotency-key', VALID_UUID_1)
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.booking_id).toBe('string');
    expect(res.body.booking_id.length).toBeGreaterThan(0);
    expect(res.body.confirmed).toBe(true);
    expect(res.body.idempotent).toBeUndefined();
  });

  // ── Test 4: Duplicate request returns cached response ─────────────
  it('returns cached booking_id for duplicate request with same key', async () => {
    const app = buildApp();

    const first = await request(app)
      .post('/booking-confirm')
      .set('idempotency-key', VALID_UUID_1)
      .send(VALID_BODY);

    expect(first.status).toBe(200);
    const firstBookingId = first.body.booking_id;

    const second = await request(app)
      .post('/booking-confirm')
      .set('idempotency-key', VALID_UUID_1)
      .send(VALID_BODY);

    expect(second.status).toBe(200);
    expect(second.body.booking_id).toBe(firstBookingId);
    expect(second.body.idempotent).toBe(true);
  });

  // ── Test 5: Key via query param ───────────────────────────────────
  it('accepts idempotency key via x-idempotency-key query param', async () => {
    const app = buildApp();
    const res = await request(app)
      .post(`/booking-confirm?x-idempotency-key=${VALID_UUID_2}`)
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(typeof res.body.booking_id).toBe('string');
  });

  // ── Test 6: Different keys produce independent bookings ───────────
  it('different idempotency keys produce independent bookings', async () => {
    const app = buildApp();

    const r1 = await request(app)
      .post('/booking-confirm')
      .set('idempotency-key', VALID_UUID_1)
      .send(VALID_BODY);

    const r2 = await request(app)
      .post('/booking-confirm')
      .set('idempotency-key', VALID_UUID_2)
      .send(VALID_BODY);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.booking_id).not.toBe(r2.body.booking_id);
  });

  // ── Test 7: Missing body fields ───────────────────────────────────
  it('returns 400 when guestName is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/booking-confirm')
      .set('idempotency-key', VALID_UUID_1)
      .send({ checkIn: '2026-05-01' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/guestName/i);
  });
});
