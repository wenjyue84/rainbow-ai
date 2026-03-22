/**
 * US-064: Booking modification tool helpers
 *
 * Provides findConflictingBookings() for detecting overlapping reservations
 * before applying guest-initiated booking changes (date, room type, amenities).
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
