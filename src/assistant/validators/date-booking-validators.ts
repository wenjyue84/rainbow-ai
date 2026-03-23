/**
 * US-303: Date and booking conflict checks
 *
 * Validation functions to ensure check-in date is not in the past
 * and detect overlapping or conflicting bookings on the same room.
 *
 * All functions return Violation[] (empty if valid).
 * Exported for use in US-304 preflight endpoint integration.
 */

import { createViolation, type Violation } from '../../lib/validation-helpers.js';
import { pool } from '../../lib/db.js';

// ─── Database Abstraction ────────────────────────────────────────────

/**
 * Query function abstraction — allows dependency injection for testing.
 * Same pattern as US-302 guest-room-validators.
 */
export type QueryFn = (sql: string, params: any[]) => Promise<{ rows: any[] }>;

/** Default query function using the pool from db.ts */
const defaultQuery: QueryFn = (sql, params) => pool.query(sql, params);

// ─── Overlapping booking record shape ────────────────────────────────

export interface OverlappingBooking {
  id: string;
  room_id: string;
  guest_phone: string;
  guest_name: string;
  check_in_date: Date | string;
  check_out_date: Date | string;
  status: string;
}

// ─── Helper Functions ────────────────────────────────────────────────

/**
 * Format a Date as YYYY-MM-DD string.
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generate suggested alternative dates starting from the day after a conflict ends.
 * Returns up to 3 suggested date ranges.
 */
function suggestAlternativeDates(
  conflictEnd: Date,
  nightsRequested: number
): string {
  const suggestions: string[] = [];
  const baseDate = new Date(conflictEnd);

  for (let i = 0; i < 3; i++) {
    const suggestCheckIn = new Date(baseDate);
    suggestCheckIn.setDate(suggestCheckIn.getDate() + i);
    const suggestCheckOut = new Date(suggestCheckIn);
    suggestCheckOut.setDate(suggestCheckOut.getDate() + nightsRequested);
    suggestions.push(
      `${formatDate(suggestCheckIn)} to ${formatDate(suggestCheckOut)}`
    );
  }

  return suggestions.join(', ');
}

// ─── Validation Functions ────────────────────────────────────────────

/**
 * Validate that a check-in date is not in the past.
 *
 * Compares the provided check-in date against the current date (start of day).
 * Returns a critical violation if the date is in the past.
 *
 * @param checkInDate - Check-in date (ISO string YYYY-MM-DD or Date object)
 * @param now - Optional current date override for testing
 * @returns Violation[] - empty if date is valid (today or future)
 */
export function validateCheckInDate(
  checkInDate: string | Date,
  now?: Date
): Violation[] {
  if (!checkInDate) {
    return [
      createViolation(
        'check_in_date_missing',
        'Check-in date is required but was not provided',
        'critical',
        'Provide a valid check-in date in YYYY-MM-DD format'
      ),
    ];
  }

  let parsedDate: Date;

  if (checkInDate instanceof Date) {
    parsedDate = new Date(checkInDate);
  } else {
    // Parse ISO date string YYYY-MM-DD
    const dateFormatRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateFormatRegex.test(checkInDate)) {
      return [
        createViolation(
          'check_in_date_invalid_format',
          `Check-in date "${checkInDate}" is not in valid YYYY-MM-DD format`,
          'critical',
          'Provide the check-in date in YYYY-MM-DD format (e.g., 2026-03-25)'
        ),
      ];
    }

    const [year, month, day] = checkInDate.split('-').map(Number);
    parsedDate = new Date(year, month - 1, day, 0, 0, 0, 0);
  }

  if (isNaN(parsedDate.getTime())) {
    return [
      createViolation(
        'check_in_date_invalid',
        `Check-in date "${checkInDate}" is not a valid date`,
        'critical',
        'Provide a valid check-in date in YYYY-MM-DD format'
      ),
    ];
  }

  // Normalize both dates to start of day for comparison
  const today = now ? new Date(now) : new Date();
  today.setHours(0, 0, 0, 0);

  const checkInNormalized = new Date(parsedDate);
  checkInNormalized.setHours(0, 0, 0, 0);

  if (checkInNormalized < today) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return [
      createViolation(
        'past_date',
        `Check-in date ${formatDate(checkInNormalized)} is in the past`,
        'critical',
        `Select check-in date ${formatDate(tomorrow)} or later`
      ),
    ];
  }

  return [];
}

/**
 * Validate that there are no overlapping bookings for a room in the given date range.
 *
 * Queries the room_reservations table for conflicts using standard overlap logic:
 *   existing.check_in < new.check_out AND existing.check_out > new.check_in
 *
 * Only considers active reservations (status != 'cancelled').
 *
 * @param roomId - Room identifier to check
 * @param checkIn - Requested check-in date (ISO string YYYY-MM-DD or Date)
 * @param checkOut - Requested check-out date (ISO string YYYY-MM-DD or Date)
 * @param queryFn - Optional query function for testing
 * @returns Violation[] - empty if no overlapping bookings exist
 */
export async function validateNoOverlapBookings(
  roomId: string,
  checkIn: string | Date,
  checkOut: string | Date,
  queryFn: QueryFn = defaultQuery
): Promise<Violation[]> {
  if (!roomId || (typeof roomId === 'string' && roomId.trim() === '')) {
    return [
      createViolation(
        'room_id_missing',
        'Room ID is required to check for booking conflicts',
        'critical',
        'Provide a valid room ID to proceed with booking'
      ),
    ];
  }

  if (!checkIn) {
    return [
      createViolation(
        'check_in_missing',
        'Check-in date is required to check for booking conflicts',
        'critical',
        'Provide a valid check-in date in YYYY-MM-DD format'
      ),
    ];
  }

  if (!checkOut) {
    return [
      createViolation(
        'check_out_missing',
        'Check-out date is required to check for booking conflicts',
        'critical',
        'Provide a valid check-out date in YYYY-MM-DD format'
      ),
    ];
  }

  // Parse dates
  const checkInDate = checkIn instanceof Date ? checkIn : new Date(checkIn);
  const checkOutDate = checkOut instanceof Date ? checkOut : new Date(checkOut);

  if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
    return [
      createViolation(
        'date_parse_error',
        'Could not parse check-in or check-out date',
        'critical',
        'Provide valid dates in YYYY-MM-DD format'
      ),
    ];
  }

  if (checkOutDate <= checkInDate) {
    return [
      createViolation(
        'invalid_date_range',
        `Check-out date (${formatDate(checkOutDate)}) must be after check-in date (${formatDate(checkInDate)})`,
        'critical',
        `Set check-out date to ${formatDate(new Date(checkInDate.getTime() + 86400000))} or later`
      ),
    ];
  }

  try {
    // Overlap logic: existing.check_in < new.check_out AND existing.check_out > new.check_in
    const result = await queryFn(
      `SELECT id, room_id, guest_phone, guest_name, check_in_date, check_out_date, status
       FROM room_reservations
       WHERE room_id = $1
         AND status != 'cancelled'
         AND check_in_date < $3
         AND check_out_date > $2`,
      [roomId.trim(), checkInDate.toISOString(), checkOutDate.toISOString()]
    );

    if (result.rows.length === 0) {
      return [];
    }

    // Build violations with details about each conflict
    const violations: Violation[] = [];

    for (const row of result.rows) {
      const existingCheckIn = row.check_in_date instanceof Date
        ? row.check_in_date
        : new Date(row.check_in_date);
      const existingCheckOut = row.check_out_date instanceof Date
        ? row.check_out_date
        : new Date(row.check_out_date);

      // Calculate requested stay duration in nights
      const nightsRequested = Math.max(
        1,
        Math.round((checkOutDate.getTime() - checkInDate.getTime()) / 86400000)
      );

      const alternativeDates = suggestAlternativeDates(existingCheckOut, nightsRequested);

      violations.push(
        createViolation(
          'booking_overlap',
          `Room "${roomId}" has an existing ${row.status || 'active'} booking from ${formatDate(existingCheckIn)} to ${formatDate(existingCheckOut)} (guest: ${row.guest_name || 'unknown'})`,
          'critical',
          `Select alternative dates: ${alternativeDates}`
        )
      );
    }

    return violations;
  } catch (error: any) {
    console.error('[DateBookingValidators] validateNoOverlapBookings query failed:', error.message);
    return [
      createViolation(
        'overlap_check_error',
        `Failed to check for booking conflicts: ${error.message}`,
        'warning',
        'Retry the validation or manually verify no conflicting bookings exist'
      ),
    ];
  }
}
