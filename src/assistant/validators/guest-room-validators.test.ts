/**
 * US-302: Guest and room validation checks — unit tests
 *
 * Tests:
 * 1. validateGuestExists — query database, return violation if not found
 * 2. validateRoomTypeValid — check profile supports room type
 * 3. validateGuestRestrictions — verify age/profile restrictions
 * 4. All functions return Violation[] (empty if valid)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  validateGuestExists,
  validateRoomTypeValid,
  validateGuestRestrictions,
  DEFAULT_ROOM_TYPES,
  type QueryFn,
  type RoomTypeConfig,
} from './guest-room-validators.js';
import type { Violation } from '../../lib/validation-helpers.js';

// ─── Mock Query Functions ────────────────────────────────────────────

/** Creates a mock query function that returns the given rows */
function mockQuery(rows: any[] = []): QueryFn {
  return vi.fn(async () => ({ rows }));
}

/** Creates a mock query function that throws an error */
function mockQueryError(message: string): QueryFn {
  return vi.fn(async () => { throw new Error(message); });
}

// ─── Guest record fixtures ──────────────────────────────────────────

const GUEST_PELANGI = {
  phone: '60123456789',
  push_name: 'John Doe',
  profile_id: 'pelangi',
  metadata: null,
  created_at: new Date('2026-01-15'),
};

const GUEST_SOUTHERN = {
  phone: '60198765432',
  push_name: 'Jane Smith',
  profile_id: 'southern',
  metadata: null,
  created_at: new Date('2026-02-01'),
};

const GUEST_WITH_AGE = {
  phone: '60111222333',
  push_name: 'Young Guest',
  profile_id: 'pelangi',
  metadata: JSON.stringify({ age: 16 }),
  created_at: new Date('2026-01-20'),
};

const GUEST_WITH_DOB = {
  phone: '60111333444',
  push_name: 'Adult Guest',
  profile_id: 'pelangi',
  metadata: JSON.stringify({ date_of_birth: '1990-05-15' }),
  created_at: new Date('2026-01-20'),
};

const GUEST_ADULT_AGE = {
  phone: '60111444555',
  push_name: 'Adult Guest',
  profile_id: 'pelangi',
  metadata: JSON.stringify({ age: 25 }),
  created_at: new Date('2026-01-20'),
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('US-302: Guest and Room Validation Checks', () => {

  // ── validateGuestExists ──────────────────────────────────────────

  describe('validateGuestExists', () => {
    it('should return empty violations when guest exists', async () => {
      const query = mockQuery([GUEST_PELANGI]);
      const violations = await validateGuestExists('60123456789', query);

      expect(violations).toHaveLength(0);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('rainbow_conversations'),
        ['60123456789']
      );
    });

    it('should return critical violation when guest not found', async () => {
      const query = mockQuery([]);
      const violations = await validateGuestExists('60199999999', query);

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('guest_not_found');
      expect(violations[0].impact_level).toBe('critical');
      expect(violations[0].description).toContain('60199999999');
      expect(violations[0].suggested_fix).toBeTruthy();
    });

    it('should return critical violation when guest_id is empty', async () => {
      const query = mockQuery([]);
      const violations = await validateGuestExists('', query);

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('guest_id_missing');
      expect(violations[0].impact_level).toBe('critical');
    });

    it('should return critical violation when guest_id is whitespace only', async () => {
      const query = mockQuery([]);
      const violations = await validateGuestExists('   ', query);

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('guest_id_missing');
    });

    it('should return warning violation on database error (fail-open)', async () => {
      const query = mockQueryError('Connection refused');
      const violations = await validateGuestExists('60123456789', query);

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('guest_lookup_error');
      expect(violations[0].impact_level).toBe('warning');
      expect(violations[0].description).toContain('Connection refused');
    });

    it('should trim guest_id before querying', async () => {
      const query = mockQuery([GUEST_PELANGI]);
      await validateGuestExists('  60123456789  ', query);

      expect(query).toHaveBeenCalledWith(
        expect.any(String),
        ['60123456789']
      );
    });
  });

  // ── validateRoomTypeValid ────────────────────────────────────────

  describe('validateRoomTypeValid', () => {
    it('should return empty violations when room type is valid for profile', async () => {
      const query = mockQuery([{ profile_id: 'pelangi' }]);
      const violations = await validateRoomTypeValid('60123456789', '2-bed', DEFAULT_ROOM_TYPES, query);

      expect(violations).toHaveLength(0);
    });

    it('should return critical violation when room type does not exist', async () => {
      const query = mockQuery([{ profile_id: 'pelangi' }]);
      const violations = await validateRoomTypeValid('60123456789', 'penthouse', DEFAULT_ROOM_TYPES, query);

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('invalid_room_type');
      expect(violations[0].impact_level).toBe('critical');
      expect(violations[0].description).toContain('penthouse');
      expect(violations[0].suggested_fix).toContain('2-bed');
    });

    it('should return critical violation when room type is empty', async () => {
      const query = mockQuery([{ profile_id: 'pelangi' }]);
      const violations = await validateRoomTypeValid('60123456789', '', DEFAULT_ROOM_TYPES, query);

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('room_type_missing');
      expect(violations[0].impact_level).toBe('critical');
    });

    it('should return critical violation when room type is not allowed for guest profile', async () => {
      // Southern guest trying to book a dorm (pelangi only)
      const query = mockQuery([{ profile_id: 'southern' }]);
      const violations = await validateRoomTypeValid('60198765432', 'dorm', DEFAULT_ROOM_TYPES, query);

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('room_type_profile_mismatch');
      expect(violations[0].impact_level).toBe('critical');
      expect(violations[0].description).toContain('dorm');
      expect(violations[0].description).toContain('southern');
      expect(violations[0].suggested_fix).toContain('family'); // family is available for southern
    });

    it('should handle room type case-insensitively', async () => {
      const query = mockQuery([{ profile_id: 'pelangi' }]);
      const violations = await validateRoomTypeValid('60123456789', '4-BED', DEFAULT_ROOM_TYPES, query);

      expect(violations).toHaveLength(0);
    });

    it('should return empty violations when guest not found (delegated to validateGuestExists)', async () => {
      const query = mockQuery([]);
      const violations = await validateRoomTypeValid('60199999999', '2-bed', DEFAULT_ROOM_TYPES, query);

      // Should not add profile mismatch when guest doesn't exist
      expect(violations).toHaveLength(0);
    });

    it('should return warning on database error', async () => {
      const query = mockQueryError('Timeout');
      const violations = await validateRoomTypeValid('60123456789', '2-bed', DEFAULT_ROOM_TYPES, query);

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('room_type_validation_error');
      expect(violations[0].impact_level).toBe('warning');
    });

    it('should default to pelangi profile when profile_id is null', async () => {
      const query = mockQuery([{ profile_id: null }]);
      const violations = await validateRoomTypeValid('60123456789', '2-bed', DEFAULT_ROOM_TYPES, query);

      expect(violations).toHaveLength(0); // 2-bed is valid for pelangi (default)
    });

    it('should suggest valid room types for the guest profile in suggested_fix', async () => {
      // Southern guest trying to book 4-bed (pelangi only)
      const query = mockQuery([{ profile_id: 'southern' }]);
      const violations = await validateRoomTypeValid('60198765432', '4-bed', DEFAULT_ROOM_TYPES, query);

      expect(violations).toHaveLength(1);
      const fix = violations[0].suggested_fix;
      // Should suggest rooms available for southern
      expect(fix).toContain('private');
      expect(fix).toContain('family');
      expect(fix).toContain('deluxe');
    });

    it('should accept custom room type configurations', async () => {
      const customTypes: RoomTypeConfig[] = [
        { name: 'suite', min_age: 21, allowed_profiles: ['vip'], max_guests: 2 },
      ];
      const query = mockQuery([{ profile_id: 'vip' }]);
      const violations = await validateRoomTypeValid('60123456789', 'suite', customTypes, query);

      expect(violations).toHaveLength(0);
    });
  });

  // ── validateGuestRestrictions ────────────────────────────────────

  describe('validateGuestRestrictions', () => {
    it('should return empty violations when room has no age restriction', async () => {
      const query = mockQuery([GUEST_PELANGI]);
      const violations = await validateGuestRestrictions('60123456789', '2-bed', DEFAULT_ROOM_TYPES, query);

      expect(violations).toHaveLength(0);
    });

    it('should return critical violation when guest is underage for room type', async () => {
      const query = mockQuery([GUEST_WITH_AGE]); // age: 16
      const violations = await validateGuestRestrictions('60111222333', 'private', DEFAULT_ROOM_TYPES, query);

      // private requires min_age: 18
      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('age_restriction');
      expect(violations[0].impact_level).toBe('critical');
      expect(violations[0].description).toContain('16');
      expect(violations[0].description).toContain('18');
      expect(violations[0].suggested_fix).toContain('2-bed'); // no age restriction room
    });

    it('should return empty violations when guest meets age requirement', async () => {
      const query = mockQuery([GUEST_ADULT_AGE]); // age: 25
      const violations = await validateGuestRestrictions('60111444555', 'private', DEFAULT_ROOM_TYPES, query);

      expect(violations).toHaveLength(0); // 25 >= 18
    });

    it('should calculate age from date_of_birth in metadata', async () => {
      const query = mockQuery([GUEST_WITH_DOB]); // dob: 1990-05-15
      const violations = await validateGuestRestrictions('60111333444', 'private', DEFAULT_ROOM_TYPES, query);

      // 1990-05-15 -> age ~35-36 in 2026, meets min_age 18
      expect(violations).toHaveLength(0);
    });

    it('should return warning when age is unknown and room has age restriction', async () => {
      const query = mockQuery([GUEST_PELANGI]); // no metadata
      const violations = await validateGuestRestrictions('60123456789', 'private', DEFAULT_ROOM_TYPES, query);

      // private requires min_age: 18 but age is not on file
      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('age_unknown');
      expect(violations[0].impact_level).toBe('warning');
      expect(violations[0].description).toContain('18');
      expect(violations[0].suggested_fix).toContain('Verify guest age');
    });

    it('should return empty violations when room type is empty', async () => {
      const query = mockQuery([GUEST_PELANGI]);
      const violations = await validateGuestRestrictions('60123456789', '', DEFAULT_ROOM_TYPES, query);

      expect(violations).toHaveLength(0);
    });

    it('should return empty violations when room type not found in config', async () => {
      const query = mockQuery([GUEST_PELANGI]);
      const violations = await validateGuestRestrictions('60123456789', 'nonexistent', DEFAULT_ROOM_TYPES, query);

      expect(violations).toHaveLength(0); // delegated to validateRoomTypeValid
    });

    it('should return empty violations when guest not found', async () => {
      const query = mockQuery([]);
      const violations = await validateGuestRestrictions('60199999999', 'private', DEFAULT_ROOM_TYPES, query);

      expect(violations).toHaveLength(0); // delegated to validateGuestExists
    });

    it('should return warning on database error', async () => {
      const query = mockQueryError('Connection reset');
      const violations = await validateGuestRestrictions('60123456789', 'dorm', DEFAULT_ROOM_TYPES, query);

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('restriction_check_error');
      expect(violations[0].impact_level).toBe('warning');
    });

    it('should handle malformed metadata JSON gracefully', async () => {
      const guestBadMeta = {
        ...GUEST_PELANGI,
        metadata: '{invalid json',
      };
      const query = mockQuery([guestBadMeta]);
      const violations = await validateGuestRestrictions('60123456789', 'dorm', DEFAULT_ROOM_TYPES, query);

      // dorm requires min_age 18, metadata is malformed -> age unknown -> warning
      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('age_unknown');
      expect(violations[0].impact_level).toBe('warning');
    });
  });

  // ── Return type conformance ──────────────────────────────────────

  describe('Violation[] return type conformance', () => {
    it('all validation functions return arrays with proper Violation shape', async () => {
      const query = mockQuery([]);
      const results = await Promise.all([
        validateGuestExists('60199999999', query),
        validateRoomTypeValid('60199999999', 'penthouse', DEFAULT_ROOM_TYPES, query),
        validateGuestRestrictions('60199999999', 'private', DEFAULT_ROOM_TYPES, query),
      ]);

      for (const violations of results) {
        expect(Array.isArray(violations)).toBe(true);
        for (const v of violations) {
          expect(v).toHaveProperty('violation_type');
          expect(v).toHaveProperty('description');
          expect(v).toHaveProperty('impact_level');
          expect(v).toHaveProperty('suggested_fix');
          expect(['critical', 'warning']).toContain(v.impact_level);
          expect(typeof v.violation_type).toBe('string');
          expect(typeof v.description).toBe('string');
          expect(typeof v.suggested_fix).toBe('string');
        }
      }
    });

    it('all functions return empty array when everything is valid', async () => {
      const query = mockQuery([GUEST_PELANGI]);
      const [guestViolations, roomViolations, restrictionViolations] = await Promise.all([
        validateGuestExists('60123456789', query),
        validateRoomTypeValid('60123456789', '2-bed', DEFAULT_ROOM_TYPES, query),
        validateGuestRestrictions('60123456789', '2-bed', DEFAULT_ROOM_TYPES, query),
      ]);

      expect(guestViolations).toHaveLength(0);
      expect(roomViolations).toHaveLength(0);
      expect(restrictionViolations).toHaveLength(0);
    });
  });

  // ── Integration scenario ─────────────────────────────────────────

  describe('Combined validation scenario', () => {
    it('should collect violations from all three validators', async () => {
      // Guest not found, invalid room type, restrictions won't add (no guest)
      const queryEmpty = mockQuery([]);
      const allViolations: Violation[] = [];

      const guestV = await validateGuestExists('60199999999', queryEmpty);
      allViolations.push(...guestV);

      const roomV = await validateRoomTypeValid('60199999999', 'penthouse', DEFAULT_ROOM_TYPES, queryEmpty);
      allViolations.push(...roomV);

      const restrictV = await validateGuestRestrictions('60199999999', '2-bed', DEFAULT_ROOM_TYPES, queryEmpty);
      allViolations.push(...restrictV);

      // guest_not_found + invalid_room_type = 2 violations minimum
      expect(allViolations.length).toBeGreaterThanOrEqual(2);
      expect(allViolations.some(v => v.violation_type === 'guest_not_found')).toBe(true);
      expect(allViolations.some(v => v.violation_type === 'invalid_room_type')).toBe(true);
    });
  });
});
