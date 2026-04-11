/**
 * US-470: Booking Unit Preflight Check
 *
 * Validates that booking units exist in profile-specific data and are available
 * for requested dates before workflow execution.
 *
 * Integrates with the booking flow to catch invalid bookings early.
 */

import { pool } from '../lib/db.js';

export interface BookingUnitPreflightResult {
  valid: boolean;
  errors: string[];
  escalationReason?: string; // Set to 'unit_unavailable' if invalid
}

// ─── Default Units Per Profile ─────────────────────────────────────
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

/**
 * Get available units for a profile
 */
async function getUnitsForProfile(profile: string): Promise<string[]> {
  try {
    const result = await pool.query(
      `SELECT unit_id FROM booking_units WHERE profile = $1 AND active = true`,
      [profile]
    );
    if (result.rows && result.rows.length > 0) {
      return result.rows.map((row: any) => row.unit_id);
    }
  } catch (error) {
    console.debug(`[preflight] Could not query units for profile ${profile}, using defaults`);
  }

  return DEFAULT_UNITS_BY_PROFILE[profile] || DEFAULT_UNITS_BY_PROFILE.pelangi;
}

/**
 * Check if dates conflict with existing reservations
 */
async function hasDateConflict(
  unitId: string,
  checkInDate: Date,
  checkOutDate: Date,
  profile: string
): Promise<boolean> {
  try {
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
    console.debug(`[preflight] Could not check date conflicts: ${error}`);
    return false;
  }
}

/**
 * Parse ISO date format (YYYY-MM-DD)
 */
function parseISODate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;

  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);

  // Check if the date is valid
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

/**
 * Perform preflight check on a booking unit request
 *
 * @param unitId - The unit ID to validate
 * @param profile - The profile (pelangi, southern, etc.)
 * @param checkInDate - ISO format YYYY-MM-DD
 * @param checkOutDate - ISO format YYYY-MM-DD
 * @returns PreflightResult with valid flag and optional escalation reason
 */
export async function preFlightUnitCheck(
  unitId: string | undefined,
  profile: string | undefined,
  checkInDate: string | undefined,
  checkOutDate: string | undefined
): Promise<BookingUnitPreflightResult> {
  const errors: string[] = [];

  // Normalize profile
  const normalizedProfile = profile || 'pelangi';

  // Check if unit_id is provided
  if (!unitId) {
    errors.push('unit_id is required for booking');
  }

  // Parse and validate dates
  const ciDate = parseISODate(checkInDate);
  const coDate = parseISODate(checkOutDate);

  if (checkInDate && !ciDate) {
    errors.push(`Invalid check_in_date format: ${checkInDate} (expected YYYY-MM-DD)`);
  }
  if (checkOutDate && !coDate) {
    errors.push(`Invalid check_out_date format: ${checkOutDate} (expected YYYY-MM-DD)`);
  }

  // Check date logic
  if (ciDate && coDate && coDate <= ciDate) {
    errors.push('check_out_date must be after check_in_date');
  }

  // If there are errors, return early
  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      escalationReason: 'unit_unavailable',
    };
  }

  // Check if unit exists in profile
  if (unitId) {
    const profileUnits = await getUnitsForProfile(normalizedProfile);
    if (!profileUnits.includes(unitId)) {
      errors.push(
        `Unit ${unitId} not found in profile ${normalizedProfile}`
      );
    } else if (ciDate && coDate && coDate > ciDate) {
      // Check for date conflicts only if dates are valid and unit exists
      const hasConflict = await hasDateConflict(unitId, ciDate, coDate, normalizedProfile);
      if (hasConflict) {
        errors.push(`Unit ${unitId} has existing bookings for the requested date range`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    escalationReason: errors.length > 0 ? 'unit_unavailable' : undefined,
  };
}
