/**
 * US-228: Booking Workflow Step Pre-Execution Validation with Actionable Error Messages
 *
 * Validates preconditions before executing each booking workflow step.
 * Returns guest-friendly error messages with recovery suggestions instead of silent failures.
 */

import { pool } from '../lib/db.js';
import type { WorkflowState } from './workflow-executor.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface BookingContext {
  guestId?: string;
  guestPhone?: string;
  guestName?: string;
  roomType?: string;
  checkInDate?: string | Date;
  checkOutDate?: string | Date;
  profile?: string;
}

// ─── Validation Functions ────────────────────────────────────────────

/**
 * Parse a date string in various formats and return a Date object.
 * Handles: "15 Feb", "15 Feb 2026", "15/2/2026", "2026-02-15", etc.
 */
function parseDate(dateStr: string | Date | undefined): Date | null {
  if (!dateStr) return null;

  // If already a Date, use it directly
  if (dateStr instanceof Date) {
    return dateStr;
  }

  try {
    const normalized = dateStr.toLowerCase().trim();

    // Pattern: "15 Feb" or "15 Feb 2026"
    const monthRegex = /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*(?:\s+(\d{4}))?/i;
    const monthMatch = normalized.match(monthRegex);

    if (monthMatch) {
      const day = parseInt(monthMatch[1], 10);
      const monthStr = monthMatch[2].slice(0, 3).toLowerCase();
      const months: Record<string, number> = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
      };
      const month = months[monthStr];
      if (month === undefined) return null;

      let year: number;
      if (monthMatch[3]) {
        year = parseInt(monthMatch[3], 10);
      } else {
        const now = new Date();
        year = now.getFullYear();
        const testDate = new Date(year, month, day);
        if (testDate < now) {
          year += 1;
        }
      }

      return new Date(year, month, day);
    }

    // Pattern: "15/2/2026" or "15-2-2026" or "2026-02-15"
    const numericRegex = /(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
    const numericMatch = normalized.match(numericRegex);

    if (numericMatch) {
      if (numericMatch[1]) {
        // ISO format: 2026-02-15
        const year = parseInt(numericMatch[1], 10);
        const month = parseInt(numericMatch[2], 10) - 1;
        const day = parseInt(numericMatch[3], 10);
        return new Date(year, month, day);
      } else {
        // DD/MM/YYYY or DD-MM-YYYY format
        const day = parseInt(numericMatch[4], 10);
        const month = parseInt(numericMatch[5], 10) - 1;
        let year = parseInt(numericMatch[6], 10);
        if (year < 100) {
          year += 2000;
        }
        return new Date(year, month, day);
      }
    }

    // Try standard Date parsing as fallback
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a guest exists based on phone number or guest ID.
 * In a real implementation, this would query a guests table.
 * For now, we consider a guest to exist if we have collected guest data in workflow.
 */
function guestExists(context: BookingContext): boolean {
  // A guest exists if we have either a phone number or guest ID
  return !!(context.guestPhone || context.guestId);
}

/**
 * Query the database to check room availability for a given date range.
 * Returns list of available rooms or suggested alternatives.
 */
async function checkRoomAvailability(
  roomType: string | undefined,
  checkIn: Date,
  checkOut: Date,
  profile: string = 'pelangi'
): Promise<{ available: boolean; suggestedAlternatives: string[] }> {
  if (!roomType) {
    return { available: false, suggestedAlternatives: [] };
  }

  try {
    // Query for reservations that overlap with the requested date range
    const result = await pool.query<any>(
      `SELECT DISTINCT room_id FROM room_reservations
       WHERE profile = $1
         AND status IN ('confirmed', 'pending')
         AND check_in_date < $3
         AND check_out_date > $2
       ORDER BY room_id`,
      [profile, checkIn, checkOut]
    );

    const bookedRooms = result.rows.map(row => row.room_id);

    // For simplicity, we assume all room types follow a pattern like "Deluxe-1", "Standard-1", etc.
    // In a real system, you'd query a rooms table
    // For now, we suggest alternatives by checking common room types
    const commonRoomTypes = ['Deluxe', 'Standard', 'Budget', 'Twin', 'Single', 'Double'];

    const isBooked = bookedRooms.some(rid =>
      rid.toLowerCase().includes(roomType.toLowerCase())
    );

    if (!isBooked) {
      return { available: true, suggestedAlternatives: [] };
    }

    // Find alternative room types that aren't booked
    const alternatives = commonRoomTypes.filter(
      type =>
        type.toLowerCase() !== roomType.toLowerCase() &&
        !bookedRooms.some(rid => rid.toLowerCase().includes(type.toLowerCase()))
    );

    return { available: false, suggestedAlternatives: alternatives };
  } catch (err) {
    console.error('[BookingValidator] Error checking room availability:', err);
    // Fail-open: assume room is available if we can't query
    return { available: true, suggestedAlternatives: [] };
  }
}

/**
 * Check if there are overlapping bookings for the guest.
 */
async function checkOverlappingBookings(
  guestPhone: string | undefined,
  checkIn: Date,
  checkOut: Date,
  profile: string = 'pelangi'
): Promise<boolean> {
  if (!guestPhone) return false;

  try {
    const result = await pool.query<any>(
      `SELECT id FROM room_reservations
       WHERE guest_phone = $1
         AND profile = $2
         AND status IN ('confirmed', 'pending')
         AND check_in_date < $4
         AND check_out_date > $3
       LIMIT 1`,
      [guestPhone, profile, checkIn, checkOut]
    );

    return result.rows.length > 0;
  } catch (err) {
    console.error('[BookingValidator] Error checking overlapping bookings:', err);
    // Fail-open: allow booking if we can't verify
    return false;
  }
}

// ─── Main Validation Function ────────────────────────────────────────

/**
 * US-228: Validates booking preconditions before workflow step execution.
 *
 * Checks:
 * 1. guest_id exists in collected data
 * 2. requested room type available
 * 3. check-in date not in past
 * 4. no overlapping bookings for guest
 *
 * @param workflowState - Current workflow state with collected data
 * @param context - Booking context with guest, room, and date info
 * @returns ValidationResult with valid flag and list of error messages
 */
export async function validateBookingPreconditions(
  workflowState: WorkflowState,
  context: BookingContext
): Promise<ValidationResult> {
  const errors: string[] = [];
  const profile = context.profile || 'pelangi';

  // 1. Check guest exists
  if (!guestExists(context)) {
    errors.push(
      'Guest information is incomplete. Please provide your name or phone number to proceed with the booking.'
    );
  }

  // Parse dates
  const checkInDate = parseDate(context.checkInDate);
  const checkOutDate = parseDate(context.checkOutDate);

  // 2. Check check-in date is not in the past
  if (checkInDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (checkInDate < today) {
      errors.push(
        `Check-in date ${checkInDate.toDateString()} is in the past. Please provide a future date to proceed with the booking.`
      );
    }
  }

  // 3. Check room availability (if we have valid dates)
  if (checkInDate && checkOutDate && checkInDate < checkOutDate) {
    const { available, suggestedAlternatives } = await checkRoomAvailability(
      context.roomType,
      checkInDate,
      checkOutDate,
      profile
    );

    if (!available) {
      let msg = `Room "${context.roomType}" is not available for the requested dates (${checkInDate.toDateString()} to ${checkOutDate.toDateString()}).`;

      if (suggestedAlternatives.length > 0) {
        msg += ` Available alternatives: ${suggestedAlternatives.join(', ')}.`;
      } else {
        msg += ' Please check our available dates or contact staff for more options.';
      }

      errors.push(msg);
    }
  }

  // 4. Check for overlapping bookings
  if (context.guestPhone && checkInDate && checkOutDate && checkInDate < checkOutDate) {
    const hasOverlap = await checkOverlappingBookings(
      context.guestPhone,
      checkInDate,
      checkOutDate,
      profile
    );

    if (hasOverlap) {
      errors.push(
        `You already have a booking that overlaps with the requested dates (${checkInDate.toDateString()} to ${checkOutDate.toDateString()}). ` +
        `Please check your existing reservations or contact staff to modify your booking.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Helper function to extract booking context from workflow state and collected data.
 * Attempts to map workflow step IDs to booking context fields.
 */
export function extractBookingContext(
  workflowState: WorkflowState,
  profile?: string
): BookingContext {
  const { collectedData } = workflowState;

  // Map common workflow step IDs to booking context fields
  const checkInKeys = ['check_in_date', 'checkin_date', 'checkin', 'arrival_date', 'booking_dates'];
  const checkOutKeys = ['check_out_date', 'checkout_date', 'checkout', 'departure_date'];
  const roomKeys = ['capsule', 'unit', 'room', 'room_type', 'capsule_type'];
  const guestNameKeys = ['guest_name', 'name', 'full_name'];
  const guestPhoneKeys = ['guest_phone', 'phone', 'phone_number', 'contact'];

  let checkInDate: string | undefined;
  let checkOutDate: string | undefined;
  let roomType: string | undefined;
  let guestName: string | undefined;
  let guestPhone: string | undefined;

  // Extract values from collected data by checking all possible keys
  for (const [key, value] of Object.entries(collectedData)) {
    if (checkInKeys.some(k => key.toLowerCase().includes(k))) {
      checkInDate = value;
    }
    if (checkOutKeys.some(k => key.toLowerCase().includes(k))) {
      checkOutDate = value;
    }
    if (roomKeys.some(k => key.toLowerCase().includes(k))) {
      roomType = value;
    }
    if (guestNameKeys.some(k => key.toLowerCase().includes(k))) {
      guestName = value;
    }
    if (guestPhoneKeys.some(k => key.toLowerCase().includes(k))) {
      guestPhone = value;
    }
  }

  return {
    checkInDate,
    checkOutDate,
    roomType,
    guestName,
    guestPhone,
    profile
  };
}
