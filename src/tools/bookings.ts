/**
 * US-064: Booking modification tool helpers
 * US-072: Booking cancellation with automatic credit calculation
 *
 * Provides findConflictingBookings() for detecting overlapping reservations
 * before applying guest-initiated booking changes (date, room type, amenities).
 * Provides calculateCancellationCredit() for calculating refund amounts based on cancellation timing.
 */

import { pool } from '../lib/db.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface DateRange {
  checkIn: Date;
  checkOut: Date;
}

export interface BookingRecord {
  id: string;
  guestName: string;
  roomType: string;
  checkIn: Date;
  checkOut: Date;
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictingBookings: BookingRecord[];
  reason?: 'date_overlap' | 'room_type_unavailable' | 'none';
}

// ─── Internal helpers ────────────────────────────────────────────────

function datesOverlap(
  checkIn1: Date, checkOut1: Date,
  checkIn2: Date, checkOut2: Date
): boolean {
  return checkIn1 < checkOut2 && checkIn2 < checkOut1;
}

// ─── Main function ───────────────────────────────────────────────────

/**
 * Find existing bookings that conflict with the proposed date range and room type.
 *
 * Queries scheduled_messages for pending/sent bookings in the same profile.
 * Returns overlapping bookings filtered by room type when specified.
 *
 * @param bookedDateRange - Proposed check-in and check-out dates
 * @param roomType - Room/capsule type requested (e.g. 'capsule', 'private', '' for any)
 * @param profileId - Business profile identifier (e.g. 'pelangi', 'southern')
 */
export async function findConflictingBookings(
  bookedDateRange: DateRange,
  roomType: string,
  profileId: string
): Promise<BookingRecord[]> {
  if (bookedDateRange.checkIn >= bookedDateRange.checkOut) {
    return [];
  }

  try {
    const result = await pool.query<{
      booking_id: string | null;
      variables: string | null;
    }>(
      `SELECT booking_id, variables
       FROM scheduled_messages
       WHERE profile_id = $1
         AND booking_id IS NOT NULL
         AND status IN ('pending', 'sent')
       ORDER BY created_at DESC
       LIMIT 200`,
      [profileId]
    );

    const conflicts: BookingRecord[] = [];

    for (const row of result.rows) {
      if (!row.variables || !row.booking_id) continue;

      let vars: Record<string, unknown>;
      try {
        vars = JSON.parse(row.variables);
      } catch {
        continue;
      }

      const arrivalDate = vars['arrivalDate'];
      const departureDate = vars['departureDate'];
      const existingRoomType = String(vars['roomType'] ?? vars['room_type'] ?? '');
      const guestName = String(vars['guestName'] ?? vars['guest_name'] ?? 'Unknown');

      if (typeof arrivalDate !== 'string') continue;

      const existingCheckIn = new Date(arrivalDate);
      const existingCheckOut = departureDate
        ? new Date(String(departureDate))
        : (() => { const d = new Date(existingCheckIn); d.setDate(d.getDate() + 1); return d; })();

      if (isNaN(existingCheckIn.getTime()) || isNaN(existingCheckOut.getTime())) continue;

      if (!datesOverlap(bookedDateRange.checkIn, bookedDateRange.checkOut, existingCheckIn, existingCheckOut)) {
        continue;
      }

      // Room type filter: if a specific room type is requested, only flag conflicts for that type
      if (roomType && existingRoomType && existingRoomType.toLowerCase() !== roomType.toLowerCase()) {
        continue;
      }

      conflicts.push({
        id: row.booking_id,
        guestName,
        roomType: existingRoomType,
        checkIn: existingCheckIn,
        checkOut: existingCheckOut,
      });
    }

    return conflicts;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bookings] findConflictingBookings DB error:`, msg);
    // Fail-open: return no conflicts on DB error to avoid blocking the guest
    return [];
  }
}

/**
 * Calculate cancellation credit based on check-in timing.
 *
 * Returns 100% credit if cancellation is more than 48 hours before check-in.
 * Returns 50% credit if cancellation is 48 hours or less before check-in.
 *
 * @param checkInDate - Booking check-in date (ISO string or Date object)
 * @returns Credit message with percentage amount
 */
export function calculateCancellationCredit(checkInDate: string | Date): string {
  try {
    const checkIn = new Date(checkInDate);
    const now = new Date();

    if (isNaN(checkIn.getTime())) {
      return '❌ Error: Invalid check-in date format. Please provide a valid date.';
    }

    // Calculate hours between now and check-in
    const hoursUntilCheckIn = (checkIn.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilCheckIn > 48) {
      return '✅ 100% credit applied. You will receive a full refund within 3-5 business days.';
    } else {
      return '✅ 50% credit applied. You will receive 50% refund within 3-5 business days.';
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bookings] calculateCancellationCredit error:`, msg);
    return '❌ Error calculating cancellation credit. Please contact support.';
  }
}

// ─── US-556: Booking Availability Validation ───────────────────────────────

export interface AlternativeDateRange {
  checkIn: string; // ISO date string
  checkOut: string; // ISO date string
  daysCount: number;
}

export interface AvailabilityResult {
  available: boolean;
  alternatives?: AlternativeDateRange[];
}

/**
 * Check if a requested booking dates are available for a unit.
 *
 * Queries guest_bookings table for conflicts. If dates are unavailable,
 * suggests 3 alternative date ranges starting from check-out date of last conflict.
 *
 * @param profile - Business profile identifier (e.g. 'pelangi', 'southern')
 * @param unitId - Unit/room identifier
 * @param checkIn - Proposed check-in date (ISO string or Date)
 * @param checkOut - Proposed check-out date (ISO string or Date)
 * @returns {available: boolean, alternatives?: [{checkIn, checkOut, daysCount}]}
 */
export async function checkAvailability(
  profile: string,
  unitId: string,
  checkIn: string | Date,
  checkOut: string | Date
): Promise<AvailabilityResult> {
  try {
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);

    // Validate dates
    if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
      console.error(`[bookings] checkAvailability: invalid date format`);
      return { available: false };
    }

    if (checkInDate >= checkOutDate) {
      console.error(`[bookings] checkAvailability: check-in >= check-out`);
      return { available: false };
    }

    // Query guest_bookings for conflicts on this unit
    const result = await pool.query<{
      check_in: string;
      check_out: string;
    }>(
      `SELECT check_in, check_out
       FROM guest_bookings
       WHERE profile_id = $1
         AND unit_id = $2
         AND status IN ('confirmed', 'checked_in')
         AND check_out > $3
         AND check_in < $4
       ORDER BY check_in ASC`,
      [profile, unitId, checkInDate.toISOString(), checkOutDate.toISOString()]
    );

    // If no conflicts, unit is available
    if (result.rows.length === 0) {
      return { available: true };
    }

    // Dates are unavailable — generate 3 alternative ranges
    const alternatives = generateAlternativeDates(
      checkOutDate,
      result.rows.map(row => ({
        checkIn: new Date(row.check_in),
        checkOut: new Date(row.check_out),
      }))
    );

    return {
      available: false,
      alternatives,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bookings] checkAvailability DB error:`, msg);
    // Fail open: allow booking if DB query fails
    return { available: true };
  }
}

/**
 * Generate 3 alternative date ranges when requested dates are unavailable.
 *
 * Starting from available slots, finds the next 3 available windows (2-night stays).
 */
function generateAlternativeDates(
  originalCheckOut: Date,
  conflictingBookings: DateRange[]
): AlternativeDateRange[] {
  const alternatives: AlternativeDateRange[] = [];

  // Sort conflicting bookings by check-in date
  const sorted = [...conflictingBookings].sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());

  if (sorted.length === 0) {
    // No conflicts - suggest dates after original check-out
    let searchStart = new Date(originalCheckOut);
    for (let i = 0; i < 3; i++) {
      const checkIn = new Date(searchStart);
      const checkOut = new Date(checkIn);
      checkOut.setDate(checkOut.getDate() + 2);
      alternatives.push({
        checkIn: checkIn.toISOString().split('T')[0],
        checkOut: checkOut.toISOString().split('T')[0],
        daysCount: 2,
      });
      searchStart = new Date(checkOut);
    }
    return alternatives;
  }

  // Start searching from the last conflicting booking's check-out
  let searchStart = new Date(sorted[sorted.length - 1]!.checkOut);

  // Find 3 alternative windows
  for (let attempts = 0; attempts < 20 && alternatives.length < 3; attempts++) {
    // Try a 2-night stay starting at searchStart
    const altCheckIn = new Date(searchStart);
    const altCheckOut = new Date(altCheckIn);
    altCheckOut.setDate(altCheckOut.getDate() + 2); // 2-night alternative

    // Check if this window conflicts with any bookings
    const hasConflict = sorted.some(
      booking =>
        altCheckIn < booking.checkOut && booking.checkIn < altCheckOut
    );

    if (!hasConflict) {
      alternatives.push({
        checkIn: altCheckIn.toISOString().split('T')[0],
        checkOut: altCheckOut.toISOString().split('T')[0],
        daysCount: 2,
      });
      searchStart = new Date(altCheckOut);
    } else {
      // Skip to after the conflicting booking
      const conflictingWithWindow = sorted.find(
        booking => altCheckIn < booking.checkOut && booking.checkIn < altCheckOut
      );
      if (conflictingWithWindow) {
        searchStart = new Date(conflictingWithWindow.checkOut);
      } else {
        // Move forward by 1 day
        searchStart.setDate(searchStart.getDate() + 1);
      }
    }
  }

  return alternatives;
}
