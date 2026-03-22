/**
 * Booking Confirmation Route (US-149)
 *
 * POST /booking-confirm — Confirm a booking with idempotency support.
 *
 * Accepts idempotency key via:
 *   - Header:      idempotency-key
 *   - Query param: x-idempotency-key
 *
 * Duplicate requests with the same key within 24 hours return the
 * cached response (same booking_id) without creating a new booking.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, badRequest, serverError } from './admin/http-utils.js';

const router = Router();

// ─── Idempotency Cache ───────────────────────────────────────────────

interface CachedBookingEntry {
  booking_id: string;
  confirmed: boolean;
  confirmed_at: string;
  expiresAt: number;
}

// Exported so integration tests can inspect/clear it
export const idempotencyCache = new Map<string, CachedBookingEntry>();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Purge expired entries hourly to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache.entries()) {
    if (entry.expiresAt <= now) {
      idempotencyCache.delete(key);
    }
  }
}, 60 * 60 * 1000).unref();

// ─── Route ───────────────────────────────────────────────────────────

router.post('/booking-confirm', async (req: Request, res: Response) => {
  try {
    // Accept key from header OR query param
    const idempotencyKey =
      (req.headers['idempotency-key'] as string | undefined) ||
      (req.query['x-idempotency-key'] as string | undefined);

    if (!idempotencyKey) {
      badRequest(res, 'idempotency-key header or x-idempotency-key query param is required');
      return;
    }

    if (!UUID_RE.test(idempotencyKey)) {
      badRequest(res, 'idempotency-key must be a valid UUID (e.g. 550e8400-e29b-41d4-a716-446655440000)');
      return;
    }

    // Return cached response for duplicate requests
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached && cached.expiresAt > Date.now()) {
      const { expiresAt: _ttl, ...payload } = cached;
      ok(res, { ...payload, idempotent: true });
      return;
    }

    // Validate required fields
    const { guestName, checkIn } = req.body;
    if (!guestName || !checkIn) {
      badRequest(res, 'guestName and checkIn are required');
      return;
    }

    // Generate booking confirmation
    const booking_id = `BK-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const confirmed_at = new Date().toISOString();

    const entry: CachedBookingEntry = {
      booking_id,
      confirmed: true,
      confirmed_at,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    idempotencyCache.set(idempotencyKey, entry);

    const { expiresAt: _ttl, ...payload } = entry;
    ok(res, payload);
  } catch (error: any) {
    serverError(res, error);
  }
});

export default router;
