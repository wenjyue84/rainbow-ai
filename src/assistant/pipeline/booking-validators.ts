/**
 * US-038: Booking workflow date conflict detection
 *
 * Validates booking dates against existing reservations to prevent double-bookings.
 * Queries the database for overlapping bookings in the same profile.
 */

import { pool } from '../../lib/db.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface DateRange {
  checkIn: Date;
  checkOut: Date;
}

export interface Booking {
  id: string;
  unit?: string;
  checkIn: Date;
  checkOut: Date;
  guestName: string;
}

export interface ConflictResult {
  hasConflict: boolean;
  conflictingBookings?: Booking[];
  message?: string;
}

// ─── Date Parsing ───────────────────────────────────────────────────

/**
 * Parse a booking date string in various formats:
 * - "15 Feb" → {checkIn: 2026-02-15, checkOut: 2026-02-16}
 * - "15 Feb, 17 Feb" → {checkIn: 2026-02-15, checkOut: 2026-02-17}
 * - "15/2/2026 to 17/2/2026" → {checkIn: 2026-02-15, checkOut: 2026-02-17}
 * - "15-2-2026" → {checkIn: 2026-02-15, checkOut: 2026-02-16}
 *
 * Returns object with {checkIn, checkOut} dates or null if parsing fails.
 */
function parseBookingDates(dateStr: string): DateRange | null {
  if (!dateStr) return null;

  try {
    const normalized = dateStr.toLowerCase().trim();

    // Pattern: "15 Feb, 17 Feb" or "15 Feb - 17 Feb"
    const monthRegex = /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/gi;
    const matches = [...normalized.matchAll(monthRegex)];

    if (matches.length >= 2) {
      const start = parseSingleDate(matches[0][0]);
      const end = parseSingleDate(matches[1][0]);
      if (start && end) return { checkIn: start, checkOut: end };
    } else if (matches.length === 1) {
      const date = parseSingleDate(matches[0][0]);
      if (date) {
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);
        return { checkIn: date, checkOut: nextDay };
      }
    }

    // Pattern: "15/2/2026" or "15-2-2026"
    const numericRegex = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
    const numericMatches = normalized.match(numericRegex);
    if (numericMatches) {
      const day = parseInt(numericMatches[1], 10);
      const month = parseInt(numericMatches[2], 10);
      const year = parseInt(numericMatches[3], 10);
      const start = new Date(year > 100 ? year : 2000 + year, month - 1, day);

      const secondDateMatch = normalized.substring(numericMatches[0].length).match(numericRegex);
      if (secondDateMatch) {
        const day2 = parseInt(secondDateMatch[1], 10);
        const month2 = parseInt(secondDateMatch[2], 10);
        const year2 = parseInt(secondDateMatch[3], 10);
        const end = new Date(year2 > 100 ? year2 : 2000 + year2, month2 - 1, day2);
        return { checkIn: start, checkOut: end };
      } else {
        const nextDay = new Date(start);
        nextDay.setDate(nextDay.getDate() + 1);
        return { checkIn: start, checkOut: nextDay };
      }
    }

    return null;
  } catch (err) {
    console.warn(`[BookingValidators] Failed to parse dates: "${dateStr}"`, err);
    return null;
  }
}

/**
 * Parse a single date string like "15 Feb" or "15 Feb 2026"
 */
function parseSingleDate(dateStr: string): Date | null {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  const match = dateStr.toLowerCase().match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = months[match[2].slice(0, 3)] ?? -1;
  if (month === -1) return null;

  const now = new Date();
  let year = now.getFullYear();
  const testDate = new Date(year, month, day);
  if (testDate < now) {
    year += 1;
  }

  return new Date(year, month, day);
}

/**
 * Check if two date ranges overlap.
 * Ranges overlap if: checkIn1 < checkOut2 AND checkIn2 < checkOut1
 */
function datesOverlap(
  checkIn1: Date, checkOut1: Date,
  checkIn2: Date, checkOut2: Date
): boolean {
  return checkIn1 < checkOut2 && checkIn2 < checkOut1;
}

// ─── Main Validator (queries database) ───────────────────────────────

/**
 * Checks if a proposed date range conflicts with any existing bookings.
 * Queries the scheduled_messages table for overlapping reservations.
 *
 * @param proposedDatesStr - Booking date string from workflow (e.g., "15 Feb, 17 Feb")
 * @param profileId - Profile/tenant ID (default: 'pelangi')
 * @returns ConflictResult with conflict status and details
 *
 * Acceptance Criteria (US-038):
 * - Add dateRangeConflict() function that queries existing reservations
 * - Returns conflict details if overlapping dates found
 * - Unit test verifies rejection of overlapping check-in dates
 */
export async function dateRangeConflict(
  proposedDatesStr: string,
  profileId: string = 'pelangi'
): Promise<ConflictResult> {
  const proposed = parseBookingDates(proposedDatesStr);
  if (!proposed) {
    return {
      hasConflict: false,
      message: 'Could not parse proposed booking dates'
    };
  }

  if (proposed.checkIn >= proposed.checkOut) {
    return {
      hasConflict: false,
      message: 'Check-in must be before check-out'
    };
  }

  try {
    // Query scheduled_messages for existing bookings in this profile
    const result = await pool.query<any>(
      `SELECT booking_id, variables
       FROM scheduled_messages
       WHERE profile_id = $1
         AND booking_id IS NOT NULL
         AND status IN ('pending', 'sent')
       ORDER BY created_at DESC
       LIMIT 100`,
      [profileId]
    );

    const conflicts: Booking[] = [];

    for (const row of result.rows) {
      if (!row.variables) continue;

      try {
        const vars = JSON.parse(row.variables);
        const existing = parseBookingDates(vars.arrivalDate);
        if (!existing) continue;

        // Check for date range overlap
        if (datesOverlap(proposed.checkIn, proposed.checkOut, existing.checkIn, existing.checkOut)) {
          conflicts.push({
            id: row.booking_id,
            checkIn: existing.checkIn,
            checkOut: existing.checkOut,
            guestName: vars.guestName || 'Unknown',
          });
        }
      } catch (err) {
        console.debug(`[BookingValidators] Skipped row ${row.booking_id}: parse error`);
      }
    }

    if (conflicts.length > 0) {
      const conflictDates = conflicts
        .map(b => `${b.guestName} (${b.checkIn.toDateString()} to ${b.checkOut.toDateString()})`)
        .join(', ');

      return {
        hasConflict: true,
        conflictingBookings: conflicts,
        message: `Dates conflict with existing booking(s): ${conflictDates}`
      };
    }

    return {
      hasConflict: false,
      message: 'No conflicts detected'
    };
  } catch (err: any) {
    console.error(`[BookingValidators] DB query error:`, err.message);
    // On error, allow booking to proceed (fail-open)
    return {
      hasConflict: false,
      message: 'Could not verify conflicts (database error)'
    };
  }
}

// ─── Export for testing ──────────────────────────────────────────────

export {
  parseBookingDates as _parseBookingDates,
  parseSingleDate as _parseSingleDate,
  datesOverlap as _datesOverlap,
};
