/**
 * US-302: Guest and room validation checks
 *
 * Validation functions to verify guest existence, validate room type
 * for a guest's profile, and check age/profile restrictions against
 * room requirements.
 *
 * All functions return Violation[] (empty if valid).
 * Exported for use in US-304 preflight endpoint integration.
 */

import { createViolation, type Violation } from '../../lib/validation-helpers.js';
import { pool } from '../../lib/db.js';

// ─── Room Type Definitions ──────────────────────────────────────────

/** Room types and their profile/age requirements */
export interface RoomTypeConfig {
  name: string;
  /** Minimum age required to book this room type (0 = no restriction) */
  min_age: number;
  /** Which profiles support this room type */
  allowed_profiles: string[];
  /** Maximum guests per room (0 = unlimited) */
  max_guests: number;
}

/**
 * Default room type configuration.
 * In production this would be loaded from DB or config,
 * but we provide sensible defaults for Pelangi hostel.
 */
export const DEFAULT_ROOM_TYPES: RoomTypeConfig[] = [
  { name: '2-bed', min_age: 0, allowed_profiles: ['pelangi'], max_guests: 2 },
  { name: '4-bed', min_age: 0, allowed_profiles: ['pelangi'], max_guests: 4 },
  { name: 'private', min_age: 18, allowed_profiles: ['pelangi', 'southern'], max_guests: 2 },
  { name: 'dorm', min_age: 18, allowed_profiles: ['pelangi'], max_guests: 8 },
  { name: 'family', min_age: 0, allowed_profiles: ['southern'], max_guests: 6 },
  { name: 'deluxe', min_age: 18, allowed_profiles: ['southern'], max_guests: 2 },
];

// ─── Database Abstraction ────────────────────────────────────────────

/** Guest record shape from rainbow_conversations */
export interface GuestRecord {
  phone: string;
  push_name: string;
  profile_id: string;
  metadata: string | null;
  created_at: Date;
}

/**
 * Query function abstraction — allows dependency injection for testing.
 * In production, this defaults to the pool.query from db.ts.
 */
export type QueryFn = (sql: string, params: any[]) => Promise<{ rows: any[] }>;

/** Default query function using the pool from db.ts */
const defaultQuery: QueryFn = (sql, params) => pool.query(sql, params);

// ─── Validation Functions ────────────────────────────────────────────

/**
 * Validate that a guest exists in the database.
 *
 * Queries rainbow_conversations by guest_id (phone number).
 * Returns a critical violation if the guest is not found.
 *
 * @param guestId - Guest identifier (phone number)
 * @param queryFn - Optional query function for testing
 * @returns Violation[] - empty if guest exists
 */
export async function validateGuestExists(
  guestId: string,
  queryFn: QueryFn = defaultQuery
): Promise<Violation[]> {
  if (!guestId || guestId.trim() === '') {
    return [
      createViolation(
        'guest_id_missing',
        'Guest ID (phone number) is required but was not provided',
        'critical',
        'Provide a valid guest phone number to proceed with booking'
      ),
    ];
  }

  try {
    const result = await queryFn(
      `SELECT phone, push_name, profile_id, metadata, created_at
       FROM rainbow_conversations
       WHERE phone = $1 LIMIT 1`,
      [guestId.trim()]
    );

    if (result.rows.length === 0) {
      return [
        createViolation(
          'guest_not_found',
          `Guest with ID "${guestId}" was not found in the database`,
          'critical',
          'Verify the guest phone number or register the guest before booking'
        ),
      ];
    }

    return [];
  } catch (error: any) {
    // Fail-open: log error but don't block booking on DB errors
    console.error('[GuestRoomValidators] validateGuestExists query failed:', error.message);
    return [
      createViolation(
        'guest_lookup_error',
        `Failed to verify guest existence: ${error.message}`,
        'warning',
        'Retry the validation or manually verify guest exists'
      ),
    ];
  }
}

/**
 * Validate that a room type is valid for the guest's profile.
 *
 * Looks up the guest's profile_id and checks the requested room type
 * against the list of room types allowed for that profile.
 *
 * @param guestId - Guest identifier (phone number)
 * @param roomType - Requested room type (e.g., "2-bed", "private")
 * @param roomTypes - Room type configuration (defaults to DEFAULT_ROOM_TYPES)
 * @param queryFn - Optional query function for testing
 * @returns Violation[] - empty if room type is valid for profile
 */
export async function validateRoomTypeValid(
  guestId: string,
  roomType: string,
  roomTypes: RoomTypeConfig[] = DEFAULT_ROOM_TYPES,
  queryFn: QueryFn = defaultQuery
): Promise<Violation[]> {
  if (!roomType || roomType.trim() === '') {
    return [
      createViolation(
        'room_type_missing',
        'Room type is required but was not provided',
        'critical',
        `Select a room type from: ${roomTypes.map(r => r.name).join(', ')}`
      ),
    ];
  }

  const normalizedRoom = roomType.toLowerCase().trim();

  // Check if room type exists at all
  const roomConfig = roomTypes.find(r => r.name.toLowerCase() === normalizedRoom);
  if (!roomConfig) {
    const available = roomTypes.map(r => r.name).join(', ');
    return [
      createViolation(
        'invalid_room_type',
        `Room type "${roomType}" does not exist in the system`,
        'critical',
        `Select a valid room type from: ${available}`
      ),
    ];
  }

  // Look up guest's profile
  try {
    const result = await queryFn(
      `SELECT profile_id FROM rainbow_conversations WHERE phone = $1 LIMIT 1`,
      [guestId.trim()]
    );

    if (result.rows.length === 0) {
      // Guest doesn't exist — validateGuestExists will catch this separately
      return [];
    }

    const guestProfile = (result.rows[0].profile_id || 'pelangi').toLowerCase();

    // Check if room type is allowed for the guest's profile
    const allowedProfiles = roomConfig.allowed_profiles.map(p => p.toLowerCase());
    if (!allowedProfiles.includes(guestProfile)) {
      const validRooms = roomTypes
        .filter(r => r.allowed_profiles.some(p => p.toLowerCase() === guestProfile))
        .map(r => r.name);

      return [
        createViolation(
          'room_type_profile_mismatch',
          `Room type "${roomType}" is not available for profile "${guestProfile}"`,
          'critical',
          `Select a room type available for ${guestProfile}: ${validRooms.join(', ')}`
        ),
      ];
    }

    return [];
  } catch (error: any) {
    console.error('[GuestRoomValidators] validateRoomTypeValid query failed:', error.message);
    return [
      createViolation(
        'room_type_validation_error',
        `Failed to validate room type against profile: ${error.message}`,
        'warning',
        'Retry the validation or manually verify room type is valid for guest profile'
      ),
    ];
  }
}

/**
 * Validate guest restrictions against room requirements.
 *
 * Checks age/profile restrictions:
 * - Minimum age requirement for the room type
 * - Profile-specific restrictions (e.g., some rooms only for certain profiles)
 *
 * @param guestId - Guest identifier (phone number)
 * @param roomType - Requested room type
 * @param roomTypes - Room type configuration (defaults to DEFAULT_ROOM_TYPES)
 * @param queryFn - Optional query function for testing
 * @returns Violation[] - empty if all restrictions pass
 */
export async function validateGuestRestrictions(
  guestId: string,
  roomType: string,
  roomTypes: RoomTypeConfig[] = DEFAULT_ROOM_TYPES,
  queryFn: QueryFn = defaultQuery
): Promise<Violation[]> {
  const violations: Violation[] = [];

  if (!roomType || roomType.trim() === '') {
    return violations; // No room type to check restrictions against
  }

  const normalizedRoom = roomType.toLowerCase().trim();
  const roomConfig = roomTypes.find(r => r.name.toLowerCase() === normalizedRoom);

  if (!roomConfig) {
    return violations; // Room type validation handled by validateRoomTypeValid
  }

  // No age restriction needed
  if (roomConfig.min_age === 0) {
    return violations;
  }

  // Look up guest metadata for age
  try {
    const result = await queryFn(
      `SELECT metadata, push_name FROM rainbow_conversations WHERE phone = $1 LIMIT 1`,
      [guestId.trim()]
    );

    if (result.rows.length === 0) {
      return violations; // Guest doesn't exist — validateGuestExists will catch this
    }

    const guest = result.rows[0];
    let guestAge: number | null = null;

    // Try to parse age from metadata JSON
    if (guest.metadata) {
      try {
        const metadata = typeof guest.metadata === 'string'
          ? JSON.parse(guest.metadata)
          : guest.metadata;
        if (metadata.age && typeof metadata.age === 'number') {
          guestAge = metadata.age;
        } else if (metadata.date_of_birth) {
          const dob = new Date(metadata.date_of_birth);
          if (!isNaN(dob.getTime())) {
            const today = new Date();
            guestAge = today.getFullYear() - dob.getFullYear();
            const monthDiff = today.getMonth() - dob.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
              guestAge--;
            }
          }
        }
      } catch {
        // Metadata parsing failed — treat as unknown age
      }
    }

    // If we know the guest's age and it's below the minimum
    if (guestAge !== null && guestAge < roomConfig.min_age) {
      violations.push(
        createViolation(
          'age_restriction',
          `Guest age (${guestAge}) does not meet minimum age requirement (${roomConfig.min_age}) for room type "${roomType}"`,
          'critical',
          `Select a room type with no age restriction, such as: ${roomTypes.filter(r => r.min_age === 0).map(r => r.name).join(', ')}`
        )
      );
    }

    // If age is unknown and room has a restriction, add a warning
    if (guestAge === null && roomConfig.min_age > 0) {
      violations.push(
        createViolation(
          'age_unknown',
          `Room type "${roomType}" requires minimum age ${roomConfig.min_age}, but guest age is not on file`,
          'warning',
          'Verify guest age before confirming booking for this room type'
        )
      );
    }

    return violations;
  } catch (error: any) {
    console.error('[GuestRoomValidators] validateGuestRestrictions query failed:', error.message);
    violations.push(
      createViolation(
        'restriction_check_error',
        `Failed to check guest restrictions: ${error.message}`,
        'warning',
        'Retry the validation or manually verify guest meets room requirements'
      )
    );
    return violations;
  }
}
