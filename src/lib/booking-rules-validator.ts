/**
 * US-547: Profile-Specific Booking Rules Validator for Pre-Flight Validation
 *
 * Validates booking requests against business rules (guest capacity, date conflicts,
 * pricing) before workflow execution, returning actionable validation errors.
 */

import { pool } from './db.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ─── Types ───────────────────────────────────────────────────────────

export interface BookingRequest {
  guestCount?: number;
  guestPhone?: string;
  checkInDate?: string | Date;
  checkOutDate?: string | Date;
  unitType?: string;
  price?: number;
  profile?: string;
}

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

interface BookingConstraint {
  profile: string;
  maxGuests: number;
  minGuests: number;
  allowedUnitTypes: string[];
  minCheckInDaysAdvance: number;
  maxCheckInDaysAdvance: number;
  minStayNights: number;
  maxStayNights: number;
  allowedLanguages: string[];
  specialAmenities: string[];
  description: string;
}

interface BookingConstraints {
  profiles: Record<string, BookingConstraint>;
}

// ─── Utilities ───────────────────────────────────────────────────────

/**
 * Load booking constraints from JSON file
 */
function loadBookingConstraints(): BookingConstraints {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const constraintsPath = join(__dirname, '../assistant/data/booking-constraints.json');
    const content = readFileSync(constraintsPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('[BookingRulesValidator] Error loading booking constraints:', err);
    // Return empty constraints so validation can still proceed
    return { profiles: {} };
  }
}

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
 * Check if there are overlapping bookings for the given date range
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
    console.error('[BookingRulesValidator] Error checking overlapping bookings:', err);
    // Fail-open: allow booking if we can't verify
    return false;
  }
}

// ─── BookingValidator Class ──────────────────────────────────────────

/**
 * US-547: Profile-specific validator for booking requests.
 * Validates against constraints from booking-constraints.json.
 */
export class BookingValidator {
  private profile: string;
  private constraints: BookingConstraint | null;
  private allConstraints: BookingConstraints;

  constructor(profile: string = 'pelangi') {
    this.profile = profile;
    this.allConstraints = loadBookingConstraints();
    this.constraints = this.allConstraints.profiles[profile] || null;

    if (!this.constraints) {
      console.warn(`[BookingRulesValidator] No constraints found for profile "${profile}"`);
    }
  }

  /**
   * Validate a booking request against profile-specific rules
   * Returns {isValid: boolean, errors: ValidationError[]}
   */
  async validate(request: BookingRequest): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    if (!this.constraints) {
      return {
        isValid: false,
        errors: [{
          code: 'profile_not_found',
          message: `Profile "${this.profile}" not found in booking constraints`
        }]
      };
    }

    // Parse dates early for use in multiple checks
    const checkInDate = request.checkInDate ? parseDate(request.checkInDate) : null;
    const checkOutDate = request.checkOutDate ? parseDate(request.checkOutDate) : null;

    // 1. Check guest count <= unit capacity
    if (request.guestCount !== undefined) {
      if (request.guestCount < this.constraints.minGuests) {
        errors.push({
          code: 'guest_count_too_low',
          field: 'guestCount',
          message: `Minimum ${this.constraints.minGuests} guest required for ${this.profile}. You requested ${request.guestCount}.`
        });
      } else if (request.guestCount > this.constraints.maxGuests) {
        errors.push({
          code: 'guest_count_exceeds_capacity',
          field: 'guestCount',
          message: `Unit capacity is ${this.constraints.maxGuests} guests, you requested ${request.guestCount}.`
        });
      }
    }

    // 2. Check unit type is allowed
    if (request.unitType && !this.constraints.allowedUnitTypes.includes(request.unitType)) {
      errors.push({
        code: 'unit_type_not_allowed',
        field: 'unitType',
        message: `Unit type "${request.unitType}" is not available. Allowed types: ${this.constraints.allowedUnitTypes.join(', ')}.`
      });
    }

    // 3. Check check_out_date > check_in_date
    if (checkInDate && checkOutDate) {
      if (checkOutDate <= checkInDate) {
        errors.push({
          code: 'invalid_date_range',
          field: 'checkOutDate',
          message: `Check-out date (${checkOutDate.toDateString()}) must be after check-in date (${checkInDate.toDateString()}).`
        });
      } else {
        // Check stay duration
        const stayNights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));

        if (stayNights < this.constraints.minStayNights) {
          errors.push({
            code: 'stay_too_short',
            field: 'checkOutDate',
            message: `Minimum stay is ${this.constraints.minStayNights} night(s). Your stay is ${stayNights} night(s).`
          });
        } else if (stayNights > this.constraints.maxStayNights) {
          errors.push({
            code: 'stay_too_long',
            field: 'checkOutDate',
            message: `Maximum stay is ${this.constraints.maxStayNights} night(s). Your stay is ${stayNights} night(s).`
          });
        }
      }

      // Check check-in date is not in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (checkInDate < today) {
        errors.push({
          code: 'checkin_date_in_past',
          field: 'checkInDate',
          message: `Check-in date (${checkInDate.toDateString()}) is in the past.`
        });
      }
    }

    // 4. Check no overlapping existing bookings
    if (request.guestPhone && checkInDate && checkOutDate && checkOutDate > checkInDate) {
      const hasOverlap = await checkOverlappingBookings(
        request.guestPhone,
        checkInDate,
        checkOutDate,
        this.profile
      );

      if (hasOverlap) {
        errors.push({
          code: 'booking_overlap_detected',
          field: 'checkInDate',
          message: `You already have a booking that overlaps with the requested dates (${checkInDate.toDateString()} to ${checkOutDate.toDateString()}).`
        });
      }
    }

    // 5. Price validation (if price is provided and matches booking-constraints structure)
    // Note: This is a placeholder as no rate card is defined in booking-constraints.json yet
    // Future enhancement: add rate cards per profile to booking-constraints.json
    // if (request.price !== undefined) {
    //   // Validate against active rate card for profile
    // }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

/**
 * Create a validator for the given profile and validate a booking request
 */
export async function validateBookingRules(
  bookingRequest: BookingRequest,
  profile: string = 'pelangi'
): Promise<ValidationResult> {
  const validator = new BookingValidator(profile);
  return validator.validate(bookingRequest);
}
