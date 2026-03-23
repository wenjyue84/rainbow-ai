/**
 * US-304: Booking Preflight Endpoint — Orchestrates All Validation Checks
 *
 * POST /admin/bookings/preflight?booking_id=<id>
 *
 * Integrates validation functions from:
 *   - US-301: Violation schema and helpers (validation-helpers.ts)
 *   - US-302: Guest/room validators (guest-room-validators.ts)
 *   - US-303: Date/conflict validators (date-booking-validators.ts)
 *
 * Request body: { guestPhone, roomType, checkInDate, checkOutDate, totalPrice, profile? }
 * Returns: { passed: boolean, violations: [], warnings: [], estimated_revenue: number }
 *   passed = true only if violations array is empty.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, badRequest, serverError, validateRequired } from './http-utils.js';

// US-301: Violation types and helpers
import {
  separateByLevel,
  type Violation,
  type PreflightResult,
} from '../../lib/validation-helpers.js';

// US-302: Guest and room validators
import {
  validateGuestExists,
  validateRoomTypeValid,
  validateGuestRestrictions,
  type QueryFn,
} from '../../assistant/validators/guest-room-validators.js';

// US-303: Date and booking conflict validators
import {
  validateCheckInDate,
  validateNoOverlapBookings,
} from '../../assistant/validators/date-booking-validators.js';

// Database pool for rate card queries
import { pool } from '../../lib/db.js';

const router = Router();

// ─── Rate Card Defaults ─────────────────────────────────────────────

/** Default nightly rates per room type when no rate_cards table is available */
const DEFAULT_RATE_CARD: Record<string, number> = {
  '2-bed': 45,
  '4-bed': 35,
  'private': 120,
  'dorm': 30,
  'family': 180,
  'deluxe': 220,
};

// ─── Rate Card Query ────────────────────────────────────────────────

/**
 * Query rate_cards table for the nightly rate for a room type.
 * Falls back to DEFAULT_RATE_CARD if table doesn't exist or query fails.
 *
 * @param roomType - Room type to look up
 * @param queryFn - Optional query function for testing
 * @returns Nightly rate in RM
 */
export async function getRateForRoom(
  roomType: string,
  queryFn: QueryFn = (sql, params) => pool.query(sql, params)
): Promise<number> {
  const normalized = roomType.toLowerCase().trim();

  try {
    const result = await queryFn(
      `SELECT nightly_rate FROM rate_cards
       WHERE LOWER(room_type) = $1
       AND active = true
       ORDER BY effective_from DESC
       LIMIT 1`,
      [normalized]
    );

    if (result.rows.length > 0 && result.rows[0].nightly_rate != null) {
      return Number(result.rows[0].nightly_rate);
    }
  } catch {
    // Table may not exist — fall through to defaults
  }

  return DEFAULT_RATE_CARD[normalized] ?? 0;
}

// ─── Revenue Calculation ────────────────────────────────────────────

/**
 * Calculate estimated revenue for a booking based on room type and stay duration.
 *
 * @param roomType - Room type
 * @param checkInDate - Check-in date string (YYYY-MM-DD)
 * @param checkOutDate - Check-out date string (YYYY-MM-DD)
 * @param queryFn - Optional query function for testing
 * @returns Estimated revenue rounded to 2 decimal places
 */
export async function calculateEstimatedRevenue(
  roomType: string,
  checkInDate: string,
  checkOutDate: string,
  queryFn?: QueryFn
): Promise<number> {
  const checkIn = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);

  if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
    return 0;
  }

  const nights = Math.max(
    1,
    Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24))
  );

  const rate = await getRateForRoom(roomType, queryFn);
  return Math.round(rate * nights * 100) / 100;
}

// ─── Orchestration ──────────────────────────────────────────────────

/**
 * Run all preflight validations in sequence and return the combined result.
 *
 * Calls validators from US-302 (guest/room) and US-303 (date/conflict),
 * then separates results into violations (critical) and warnings.
 *
 * @param guestPhone - Guest phone number
 * @param roomType - Requested room type
 * @param checkInDate - Check-in date (YYYY-MM-DD)
 * @param checkOutDate - Check-out date (YYYY-MM-DD)
 * @param profileId - Profile ID (default: 'pelangi')
 * @param queryFn - Optional query function for testing
 * @returns PreflightResult
 */
export async function runPreflightChecks(
  guestPhone: string,
  roomType: string,
  checkInDate: string,
  checkOutDate: string,
  profileId: string = 'pelangi',
  queryFn?: QueryFn
): Promise<PreflightResult> {
  const allIssues: Violation[] = [];

  // ─── US-302: Guest existence check ────────────────────────────────
  const guestViolations = await validateGuestExists(guestPhone, queryFn);
  allIssues.push(...guestViolations);

  // ─── US-302: Room type valid for profile ──────────────────────────
  const roomViolations = await validateRoomTypeValid(
    guestPhone,
    roomType,
    undefined, // use default room types
    queryFn
  );
  allIssues.push(...roomViolations);

  // ─── US-302: Guest restrictions (age, profile) ────────────────────
  const restrictionViolations = await validateGuestRestrictions(
    guestPhone,
    roomType,
    undefined, // use default room types
    queryFn
  );
  allIssues.push(...restrictionViolations);

  // ─── US-303: Check-in date not in past ────────────────────────────
  const dateViolations = validateCheckInDate(checkInDate);
  allIssues.push(...dateViolations);

  // ─── US-303: No overlapping bookings ──────────────────────────────
  const overlapViolations = await validateNoOverlapBookings(
    roomType,
    checkInDate,
    checkOutDate,
    queryFn
  );
  allIssues.push(...overlapViolations);

  // ─── Separate by impact level ─────────────────────────────────────
  const { violations, warnings } = separateByLevel(allIssues);

  // ─── Calculate estimated revenue ──────────────────────────────────
  const estimatedRevenue = await calculateEstimatedRevenue(
    roomType,
    checkInDate,
    checkOutDate,
    queryFn
  );

  return {
    passed: violations.length === 0,
    violations,
    warnings,
    estimated_revenue: estimatedRevenue,
  };
}

// ─── Routes ────────────────────────────────────────────────────────────────

/**
 * POST /bookings/preflight?booking_id=<id>
 *
 * Validate a booking against all business rules before confirmation.
 * Request body: { guestPhone, roomType, checkInDate, checkOutDate, totalPrice?, profile? }
 * Returns: { ok: true, passed, violations, warnings, estimated_revenue }
 */
router.post('/bookings/preflight', async (req: Request, res: Response) => {
  try {
    const err = validateRequired(req.body, ['guestPhone', 'roomType', 'checkInDate', 'checkOutDate']);
    if (err) {
      badRequest(res, err);
      return;
    }

    const {
      guestPhone,
      roomType,
      checkInDate,
      checkOutDate,
      profile = 'pelangi',
    } = req.body;

    const result = await runPreflightChecks(
      guestPhone,
      roomType,
      checkInDate,
      checkOutDate,
      profile
    );

    ok(res, result);
  } catch (error: any) {
    console.error('[BookingPreflight] POST /bookings/preflight failed:', error.message);
    serverError(res, error);
  }
});

export default router;
