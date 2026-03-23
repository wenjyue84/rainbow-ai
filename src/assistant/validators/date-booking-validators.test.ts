/**
 * US-303: Date and booking conflict checks — unit tests
 *
 * Tests:
 * 1. validateCheckInDate — reject dates in past, return violation if invalid
 * 2. validateNoOverlapBookings — query bookings table for conflicts
 * 3. Return detailed violation with suggested alternative dates when overlap detected
 * 4. All functions return Violation[] (empty if valid)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  validateCheckInDate,
  validateNoOverlapBookings,
  type QueryFn,
  type OverlappingBooking,
} from './date-booking-validators.js';
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

// ─── Date helpers ────────────────────────────────────────────────────

function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return formatDate(d);
}

function pastDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return formatDate(d);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayDate(): string {
  return formatDate(new Date());
}

// ─── Reservation fixtures ────────────────────────────────────────────

function makeReservation(overrides: Partial<OverlappingBooking> = {}): OverlappingBooking {
  return {
    id: 'res-001',
    room_id: 'room-101',
    guest_phone: '60123456789',
    guest_name: 'John Doe',
    check_in_date: futureDate(2),
    check_out_date: futureDate(5),
    status: 'confirmed',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('US-303: Date and Booking Conflict Checks', () => {

  // ── validateCheckInDate ────────────────────────────────────────────

  describe('validateCheckInDate', () => {
    it('should return empty violations for a future date', () => {
      const violations = validateCheckInDate(futureDate(5));
      expect(violations).toHaveLength(0);
    });

    it('should return empty violations for today', () => {
      const violations = validateCheckInDate(todayDate());
      expect(violations).toHaveLength(0);
    });

    it('should return critical violation for a past date', () => {
      const yesterday = pastDate(1);
      const violations = validateCheckInDate(yesterday);

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('past_date');
      expect(violations[0].impact_level).toBe('critical');
      expect(violations[0].description).toContain('in the past');
      expect(violations[0].suggested_fix).toContain('or later');
    });

    it('should return critical violation when date is missing', () => {
      const violations = validateCheckInDate('');

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('check_in_date_missing');
      expect(violations[0].impact_level).toBe('critical');
    });

    it('should return critical violation for invalid date format', () => {
      const violations = validateCheckInDate('not-a-date');

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('check_in_date_invalid_format');
      expect(violations[0].impact_level).toBe('critical');
      expect(violations[0].description).toContain('not-a-date');
    });

    it('should return critical violation for date in wrong format (DD-MM-YYYY)', () => {
      const violations = validateCheckInDate('25-03-2026');

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('check_in_date_invalid_format');
    });

    it('should accept Date objects for future dates', () => {
      const future = new Date();
      future.setDate(future.getDate() + 3);
      const violations = validateCheckInDate(future);

      expect(violations).toHaveLength(0);
    });

    it('should reject Date objects for past dates', () => {
      const past = new Date();
      past.setDate(past.getDate() - 2);
      const violations = validateCheckInDate(past);

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('past_date');
    });

    it('should suggest tomorrow or later when date is in the past', () => {
      const now = new Date(2026, 2, 23); // March 23, 2026
      const violations = validateCheckInDate('2026-03-20', now);

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('past_date');
      expect(violations[0].description).toContain('2026-03-20');
      expect(violations[0].suggested_fix).toContain('2026-03-24');
    });

    it('should accept check-in date that equals current date (via now parameter)', () => {
      const now = new Date(2026, 2, 23, 14, 30, 0); // March 23, 2026 at 2:30 PM
      const violations = validateCheckInDate('2026-03-23', now);

      expect(violations).toHaveLength(0);
    });

    it('should return violations array (not null or undefined) for all paths', () => {
      const results = [
        validateCheckInDate(''),
        validateCheckInDate('invalid'),
        validateCheckInDate(futureDate(1)),
        validateCheckInDate(pastDate(1)),
      ];

      for (const violations of results) {
        expect(Array.isArray(violations)).toBe(true);
      }
    });
  });

  // ── validateNoOverlapBookings ──────────────────────────────────────

  describe('validateNoOverlapBookings', () => {
    it('should return empty violations when no overlapping bookings exist', async () => {
      const query = mockQuery([]);
      const violations = await validateNoOverlapBookings(
        'room-101',
        futureDate(1),
        futureDate(3),
        query
      );

      expect(violations).toHaveLength(0);
      expect(query).toHaveBeenCalled();
    });

    it('should return critical violation when overlapping booking exists', async () => {
      const reservation = makeReservation({
        check_in_date: futureDate(2),
        check_out_date: futureDate(5),
        guest_name: 'Jane Smith',
        status: 'confirmed',
      });
      const query = mockQuery([reservation]);

      const violations = await validateNoOverlapBookings(
        'room-101',
        futureDate(1),
        futureDate(4),
        query
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('booking_overlap');
      expect(violations[0].impact_level).toBe('critical');
      expect(violations[0].description).toContain('room-101');
      expect(violations[0].description).toContain('Jane Smith');
      expect(violations[0].description).toContain('confirmed');
    });

    it('should return detailed violation with suggested alternative dates', async () => {
      const reservation = makeReservation({
        check_in_date: futureDate(2),
        check_out_date: futureDate(5),
      });
      const query = mockQuery([reservation]);

      const violations = await validateNoOverlapBookings(
        'room-101',
        futureDate(1),
        futureDate(4),
        query
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].suggested_fix).toContain('Select alternative dates');
      // Should contain date suggestions
      expect(violations[0].suggested_fix).toMatch(/\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
    });

    it('should detect multiple overlapping bookings', async () => {
      const res1 = makeReservation({
        id: 'res-001',
        check_in_date: futureDate(1),
        check_out_date: futureDate(3),
        guest_name: 'Guest A',
      });
      const res2 = makeReservation({
        id: 'res-002',
        check_in_date: futureDate(4),
        check_out_date: futureDate(6),
        guest_name: 'Guest B',
      });
      const query = mockQuery([res1, res2]);

      const violations = await validateNoOverlapBookings(
        'room-101',
        futureDate(1),
        futureDate(6),
        query
      );

      expect(violations).toHaveLength(2);
      expect(violations[0].description).toContain('Guest A');
      expect(violations[1].description).toContain('Guest B');
    });

    it('should use correct overlap logic in SQL query', async () => {
      const query = mockQuery([]);
      const checkIn = futureDate(3);
      const checkOut = futureDate(6);

      await validateNoOverlapBookings('room-101', checkIn, checkOut, query);

      // Verify the query was called with the right SQL pattern
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('room_reservations'),
        expect.arrayContaining(['room-101'])
      );
      // Verify overlap conditions are in the SQL
      const sql = (query as any).mock.calls[0][0];
      expect(sql).toContain('check_in_date <');
      expect(sql).toContain('check_out_date >');
      expect(sql).toContain("status != 'cancelled'");
    });

    it('should return critical violation when room_id is missing', async () => {
      const query = mockQuery([]);
      const violations = await validateNoOverlapBookings(
        '',
        futureDate(1),
        futureDate(3),
        query
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('room_id_missing');
      expect(violations[0].impact_level).toBe('critical');
    });

    it('should return critical violation when check_in is missing', async () => {
      const query = mockQuery([]);
      const violations = await validateNoOverlapBookings(
        'room-101',
        '',
        futureDate(3),
        query
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('check_in_missing');
      expect(violations[0].impact_level).toBe('critical');
    });

    it('should return critical violation when check_out is missing', async () => {
      const query = mockQuery([]);
      const violations = await validateNoOverlapBookings(
        'room-101',
        futureDate(1),
        '',
        query
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('check_out_missing');
      expect(violations[0].impact_level).toBe('critical');
    });

    it('should return critical violation when check_out is before check_in', async () => {
      const query = mockQuery([]);
      const violations = await validateNoOverlapBookings(
        'room-101',
        futureDate(5),
        futureDate(3),
        query
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('invalid_date_range');
      expect(violations[0].impact_level).toBe('critical');
      expect(violations[0].description).toContain('must be after');
    });

    it('should return critical violation when check_out equals check_in', async () => {
      const query = mockQuery([]);
      const sameDay = futureDate(3);
      const violations = await validateNoOverlapBookings(
        'room-101',
        sameDay,
        sameDay,
        query
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('invalid_date_range');
    });

    it('should return warning violation on database error (fail-open)', async () => {
      const query = mockQueryError('Connection timeout');
      const violations = await validateNoOverlapBookings(
        'room-101',
        futureDate(1),
        futureDate(3),
        query
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe('overlap_check_error');
      expect(violations[0].impact_level).toBe('warning');
      expect(violations[0].description).toContain('Connection timeout');
    });

    it('should accept Date objects as well as strings', async () => {
      const query = mockQuery([]);
      const checkIn = new Date();
      checkIn.setDate(checkIn.getDate() + 1);
      const checkOut = new Date();
      checkOut.setDate(checkOut.getDate() + 3);

      const violations = await validateNoOverlapBookings(
        'room-101',
        checkIn,
        checkOut,
        query
      );

      expect(violations).toHaveLength(0);
      expect(query).toHaveBeenCalled();
    });

    it('should trim room_id before querying', async () => {
      const query = mockQuery([]);
      await validateNoOverlapBookings(
        '  room-101  ',
        futureDate(1),
        futureDate(3),
        query
      );

      expect(query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['room-101'])
      );
    });

    it('should handle reservation rows with Date objects in check_in_date/check_out_date', async () => {
      const reservation = makeReservation({
        check_in_date: new Date(futureDate(2)),
        check_out_date: new Date(futureDate(5)),
        guest_name: 'Date Object Guest',
      });
      const query = mockQuery([reservation]);

      const violations = await validateNoOverlapBookings(
        'room-101',
        futureDate(1),
        futureDate(4),
        query
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].description).toContain('Date Object Guest');
    });
  });

  // ── Return type conformance ────────────────────────────────────────

  describe('Violation[] return type conformance', () => {
    it('all validation functions return arrays with proper Violation shape', async () => {
      const query = mockQuery([makeReservation()]);

      const results = [
        validateCheckInDate(pastDate(1)),
        await validateNoOverlapBookings('room-101', futureDate(1), futureDate(4), query),
      ];

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
      const query = mockQuery([]);

      const dateViolations = validateCheckInDate(futureDate(5));
      const overlapViolations = await validateNoOverlapBookings(
        'room-101',
        futureDate(1),
        futureDate(3),
        query
      );

      expect(dateViolations).toHaveLength(0);
      expect(overlapViolations).toHaveLength(0);
    });
  });

  // ── Integration scenario ───────────────────────────────────────────

  describe('Combined validation scenario', () => {
    it('should collect violations from both validators when all fail', async () => {
      const reservation = makeReservation();
      const query = mockQuery([reservation]);
      const allViolations: Violation[] = [];

      // Past date
      const dateV = validateCheckInDate(pastDate(3));
      allViolations.push(...dateV);

      // Overlapping booking
      const overlapV = await validateNoOverlapBookings(
        'room-101',
        futureDate(1),
        futureDate(4),
        query
      );
      allViolations.push(...overlapV);

      expect(allViolations.length).toBeGreaterThanOrEqual(2);
      expect(allViolations.some(v => v.violation_type === 'past_date')).toBe(true);
      expect(allViolations.some(v => v.violation_type === 'booking_overlap')).toBe(true);
    });

    it('should return empty violations when date is valid and no overlaps', async () => {
      const query = mockQuery([]);
      const allViolations: Violation[] = [];

      const dateV = validateCheckInDate(futureDate(5));
      allViolations.push(...dateV);

      const overlapV = await validateNoOverlapBookings(
        'room-101',
        futureDate(5),
        futureDate(8),
        query
      );
      allViolations.push(...overlapV);

      expect(allViolations).toHaveLength(0);
    });
  });
});
