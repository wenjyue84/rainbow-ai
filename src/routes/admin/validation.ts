/**
 * US-470: Profile-Aware Booking Unit Availability Check
 *
 * POST /admin/validation/booking-units
 * Validates that booking units exist in profile-specific data and are available for requested dates.
 *
 * Request: { unit_id, profile, check_in_date, check_out_date }
 * Response: { valid: bool, issues: string[] }
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, badRequest, serverError, validateRequired } from './http-utils.js';
import { pool } from '../../lib/db.js';

const router = Router();

// ─── Types ───────────────────────────────────────────────────────────

export interface BookingUnitValidationRequest {
  unit_id: string;
  profile: string;
  check_in_date: string; // ISO date: YYYY-MM-DD
  check_out_date: string; // ISO date: YYYY-MM-DD
}

export interface BookingUnitValidationResponse {
  valid: boolean;
  issues: string[];
}

// ─── Default Units Per Profile ─────────────────────────────────────
// This is a fallback configuration. In production, units should be stored in the database.
const DEFAULT_UNITS_BY_PROFILE: Record<string, string[]> = {
  pelangi: [
    'capsule-01', 'capsule-02', 'capsule-03', 'capsule-04', 'capsule-05',
    'capsule-06', 'capsule-07', 'capsule-08', 'capsule-09', 'capsule-10',
    'private-01', 'private-02', 'private-03', 'private-04',
    'family-01', 'family-02',
  ],
  southern: [
    'room-101', 'room-102', 'room-103', 'room-104', 'room-105',
    'room-201', 'room-202', 'room-203', 'room-204', 'room-205',
    'suite-01', 'suite-02', 'suite-03',
  ],
  'makan-moments': [
    'table-01', 'table-02', 'table-03', 'table-04', 'table-05',
  ],
};

// ─── Helper Functions ───────────────────────────────────────────────

/**
 * Get available units for a profile.
 * Tries to query the database first, falls back to defaults.
 */
async function getUnitsForProfile(profile: string): Promise<string[]> {
  try {
    // Try to query from database (if a units/rooms table exists)
    const result = await pool.query(
      `SELECT unit_id FROM booking_units WHERE profile = $1 AND active = true`,
      [profile]
    );
    if (result.rows && result.rows.length > 0) {
      return result.rows.map((row: any) => row.unit_id);
    }
  } catch (error) {
    // Table doesn't exist or query failed, fall back to defaults
    console.debug(`[validation] Could not query units for profile ${profile}, using defaults`);
  }

  return DEFAULT_UNITS_BY_PROFILE[profile] || DEFAULT_UNITS_BY_PROFILE.pelangi;
}

/**
 * Check if dates conflict with existing reservations.
 */
async function hasDateConflict(
  unitId: string,
  checkInDate: Date,
  checkOutDate: Date,
  profile: string
): Promise<boolean> {
  try {
    // Query for overlapping reservations
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM room_reservations
       WHERE room_id = $1
       AND profile = $2
       AND status IN ('pending', 'confirmed')
       AND check_in_date < $4
       AND check_out_date > $3`,
      [unitId, profile, checkInDate.toISOString(), checkOutDate.toISOString()]
    );

    return result.rows && result.rows[0]?.count > 0;
  } catch (error) {
    console.debug(`[validation] Could not check date conflicts: ${error}`);
    return false; // Allow booking if we can't verify
  }
}

/**
 * Validate ISO date format (YYYY-MM-DD)
 */
function parseISODate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);

  // Check if the date is valid (e.g., not Feb 30)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

// ─── POST /admin/validation/booking-units ───────────────────────────

router.post('/booking-units', async (req: Request, res: Response) => {
  try {
    // Validate required fields
    const err = validateRequired(req.body, ['unit_id', 'profile', 'check_in_date', 'check_out_date']);
    if (err) {
      badRequest(res, err);
      return;
    }

    const {
      unit_id,
      profile,
      check_in_date,
      check_out_date,
    } = req.body as BookingUnitValidationRequest;

    const issues: string[] = [];

    // Parse and validate dates
    const checkInDate = parseISODate(check_in_date);
    const checkOutDate = parseISODate(check_out_date);

    if (!checkInDate) {
      issues.push(`Invalid check_in_date format: ${check_in_date} (expected YYYY-MM-DD)`);
    }
    if (!checkOutDate) {
      issues.push(`Invalid check_out_date format: ${check_out_date} (expected YYYY-MM-DD)`);
    }

    // Date logic checks
    if (checkInDate && checkOutDate && checkOutDate <= checkInDate) {
      issues.push('check_out_date must be after check_in_date');
    }

    // Check if unit exists in profile
    const profileUnits = await getUnitsForProfile(profile);
    if (!profileUnits.includes(unit_id)) {
      issues.push(
        `Unit ${unit_id} not found in profile ${profile}. Available units: ${profileUnits.slice(0, 5).join(', ')}${profileUnits.length > 5 ? ', ...' : ''}`
      );
    }

    // Check for date conflicts (only if dates are valid and unit exists)
    if (checkInDate && checkOutDate && profileUnits.includes(unit_id) && checkOutDate > checkInDate) {
      const hasConflict = await hasDateConflict(unit_id, checkInDate, checkOutDate, profile);
      if (hasConflict) {
        issues.push(`Unit ${unit_id} has existing bookings for the requested date range`);
      }
    }

    const response: BookingUnitValidationResponse = {
      valid: issues.length === 0,
      issues,
    };

    ok(res, response);
  } catch (error: any) {
    console.error('[validation] POST /booking-units failed:', error.message);
    serverError(res, error);
  }
});

export default router;
