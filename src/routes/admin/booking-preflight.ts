/**
 * Booking Confirmation Pre-flight Checklist (US-224)
 *
 * Admin endpoint that validates a booking against all business rules before
 * confirmation: guest existence, room availability, date validity, no schedule
 * conflicts, pricing accuracy, and profile restrictions.
 *
 * POST /admin/bookings/preflight?booking_id=<id>
 * Request body: { guestPhone, roomType, checkInDate, checkOutDate, totalPrice, profile? }
 * Returns: { passed: bool, violations: [], warnings: [], estimated_revenue: number }
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, badRequest, serverError, validateRequired } from './http-utils.js';
import { configStore } from '../../assistant/config-store.js';
import { pool } from '../../lib/db.js';

const router = Router();

interface Violation {
  violation_type: string;
  description: string;
  impact_level: 'critical' | 'warning';
  suggested_fix: string;
}

interface PreflightResult {
  passed: boolean;
  violations: Violation[];
  warnings: Violation[];
  estimated_revenue: number;
}

/**
 * Validate a booking against all business rules
 */
async function validateBooking(
  guestPhone: string,
  roomType: string,
  checkInDateStr: string,
  checkOutDateStr: string,
  totalPrice: number,
  profileId: string
): Promise<PreflightResult> {
  const violations: Violation[] = [];
  const warnings: Violation[] = [];
  let estimatedRevenue = totalPrice;

  try {
    const checkInDate = new Date(checkInDateStr);
    const checkOutDate = new Date(checkOutDateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ─── Validation 1: Guest exists in database ──────────────────────────
    if (guestPhone) {
      const guestResult = await pool.query(
        `SELECT COUNT(*) as count FROM rainbow_conversations
         WHERE phone = $1 LIMIT 1`,
        [guestPhone]
      );

      const guestCount = parseInt(guestResult.rows[0]?.count || '0');
      if (guestCount === 0) {
        warnings.push({
          violation_type: 'guest_not_found',
          description: `Guest with phone ${guestPhone} has no recorded conversation history`,
          impact_level: 'warning',
          suggested_fix: `Guest may be first-time booker. Verify guest details are accurate.`
        });
      }
    }

    // ─── Validation 2: Room type is valid for profile ────────────────────
    const roomTypes = getRoomTypesForProfile(profileId);
    const normalizedRoomType = roomType?.toLowerCase() || '';
    const validRoomTypes = roomTypes.map(r => r.toLowerCase());

    if (normalizedRoomType && !validRoomTypes.includes(normalizedRoomType)) {
      violations.push({
        violation_type: 'invalid_room_type',
        description: `Room type "${roomType}" is not configured for this profile`,
        impact_level: 'critical',
        suggested_fix: `Select a valid room type from: ${roomTypes.join(', ')}`
      });
    }

    // ─── Validation 3: Check-in date is not in past ──────────────────────
    if (checkInDate < today) {
      violations.push({
        violation_type: 'past_date',
        description: `Check-in date ${formatDate(checkInDate)} is in the past`,
        impact_level: 'critical',
        suggested_fix: `Select a check-in date on or after ${formatDate(today)}`
      });
    }

    // ─── Validation 4: No overlapping bookings exist ──────────────────────
    const overlapResult = await pool.query(
      `SELECT * FROM room_reservations
       WHERE room_id = $1
       AND profile = $2
       AND status IN ('confirmed', 'pending')
       AND check_in_date < $3
       AND check_out_date > $4`,
      [roomType, profileId, checkOutDate, checkInDate]
    );

    if (overlapResult.rows.length > 0) {
      const overlappingBooking = overlapResult.rows[0];
      violations.push({
        violation_type: 'room_conflict',
        description: `Room ${roomType} is already booked from ${formatDate(overlappingBooking.check_in_date)} to ${formatDate(overlappingBooking.check_out_date)}`,
        impact_level: 'critical',
        suggested_fix: `Select a different room or adjust dates to avoid conflict`
      });
    }

    // ─── Validation 5: Check-in/check-out date validity ────────────────────
    if (checkInDate >= checkOutDate) {
      violations.push({
        violation_type: 'invalid_date_range',
        description: `Check-out date must be after check-in date`,
        impact_level: 'critical',
        suggested_fix: `Ensure check-out date is after check-in date`
      });
    }

    // ─── Validation 6: Pricing sanity check ──────────────────────────────
    const numberOfNights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));
    if (numberOfNights > 0) {
      const pricePerNight = totalPrice / numberOfNights;
      // Sanity check: price should be reasonable (RM30-1000 per night)
      if (pricePerNight < 30 || pricePerNight > 1000) {
        warnings.push({
          violation_type: 'unusual_pricing',
          description: `Price per night (RM${pricePerNight.toFixed(2)}) is outside typical range (RM30–RM1000)`,
          impact_level: 'warning',
          suggested_fix: `Verify pricing is correct against current rate cards`
        });
      }
    }

    estimatedRevenue = totalPrice;

  } catch (error: any) {
    console.error('[BookingPreflight] Validation error:', error.message);
    throw error;
  }

  return {
    passed: violations.length === 0,
    violations,
    warnings,
    estimated_revenue: Math.round(estimatedRevenue * 100) / 100
  };
}

/**
 * Get room types configured for a profile
 */
function getRoomTypesForProfile(profileId: string): string[] {
  try {
    const settings = configStore.getSettings();
    if ((settings as any).rooms && Array.isArray((settings as any).rooms)) {
      return ((settings as any).rooms as Array<{ name?: string; id?: string }>)
        .map(room => room.name || room.id)
        .filter(Boolean) as string[];
    }
    if ((settings as any).booking && (settings as any).booking.available_rooms) {
      return (settings as any).booking.available_rooms;
    }
  } catch (err) {
    console.warn('[BookingPreflight] Failed to get room types from config:', err);
  }

  // Fallback defaults
  return ['2-bed', '4-bed', 'private', 'dorm'];
}

/**
 * Format date for display (e.g., "24 Mar 2026")
 */
function formatDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// ─── Routes ────────────────────────────────────────────────────────────────

/**
 * POST /bookings/preflight?booking_id=<id>
 *
 * Validate a booking against all business rules before confirmation.
 * Request body: { guestPhone, roomType, checkInDate, checkOutDate, totalPrice, profile? }
 * Returns: { passed, violations, warnings, estimated_revenue }
 */
router.post('/bookings/preflight', async (req: Request, res: Response) => {
  try {
    const bookingId = req.query.booking_id as string;

    if (!bookingId) {
      badRequest(res, 'booking_id query parameter is required');
      return;
    }

    // Validate required fields in request body
    const err = validateRequired(req.body, ['guestPhone', 'roomType', 'checkInDate', 'checkOutDate', 'totalPrice']);
    if (err) {
      badRequest(res, err);
      return;
    }

    const {
      guestPhone,
      roomType,
      checkInDate,
      checkOutDate,
      totalPrice,
      profile = 'pelangi',
    } = req.body;

    const result = await validateBooking(guestPhone, roomType, checkInDate, checkOutDate, totalPrice, profile);
    ok(res, result);
  } catch (error: any) {
    console.error('[BookingPreflight] POST /bookings/preflight failed:', error.message);
    serverError(res, error);
  }
});

export default router;
