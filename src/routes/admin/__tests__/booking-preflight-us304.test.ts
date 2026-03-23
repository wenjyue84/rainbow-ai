/**
 * US-304: Booking Preflight Endpoint — Integration Tests
 *
 * Tests:
 * 1. POST /admin/bookings/preflight?booking_id= endpoint exists
 * 2. Calls all validation functions from US-302 and US-303
 * 3. Queries rate card and calculates estimated_revenue
 * 4. Separates violations (critical) from warnings
 * 5. Returns { passed, violations, warnings, estimated_revenue } with passed=true only if violations is empty
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runPreflightChecks,
  calculateEstimatedRevenue,
  getRateForRoom,
} from '../booking-preflight.js';
import type { Violation, PreflightResult } from '../../../lib/validation-helpers.js';
import type { QueryFn } from '../../../assistant/validators/guest-room-validators.js';

// ─── Mock Query Factories ───────────────────────────────────────────

/**
 * Build a mock query function that routes SQL patterns to different results.
 * This simulates the database without needing a real connection.
 */
function buildMockQuery(options: {
  guestExists?: boolean;
  guestProfile?: string;
  guestMetadata?: string | null;
  overlappingBookings?: any[];
  rateCardRate?: number | null;
} = {}): QueryFn {
  const {
    guestExists = true,
    guestProfile = 'pelangi',
    guestMetadata = null,
    overlappingBookings = [],
    rateCardRate = null,
  } = options;

  return vi.fn(async (sql: string, _params: any[]) => {
    const lowerSql = sql.toLowerCase();

    // Guest existence / profile lookup (US-302)
    if (lowerSql.includes('rainbow_conversations')) {
      if (!guestExists) {
        return { rows: [] };
      }
      return {
        rows: [{
          phone: '60123456789',
          push_name: 'Test Guest',
          profile_id: guestProfile,
          metadata: guestMetadata,
          created_at: new Date('2026-01-01'),
        }],
      };
    }

    // Overlap check (US-303)
    if (lowerSql.includes('room_reservations')) {
      return { rows: overlappingBookings };
    }

    // Rate card lookup
    if (lowerSql.includes('rate_cards')) {
      if (rateCardRate != null) {
        return { rows: [{ nightly_rate: rateCardRate }] };
      }
      return { rows: [] };
    }

    // Default: empty results
    return { rows: [] };
  });
}

// ─── Helper Dates ───────────────────────────────────────────────────

function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function pastDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('US-304: Preflight Endpoint Integration', () => {

  // ── AC1: Endpoint calls all validation functions ──────────────────

  describe('runPreflightChecks orchestration', () => {
    it('should return passed=true when all validations pass', async () => {
      const mockQuery = buildMockQuery({ guestExists: true });
      const checkIn = futureDate(3);
      const checkOut = futureDate(5);

      const result = await runPreflightChecks(
        '60123456789', '2-bed', checkIn, checkOut, 'pelangi', mockQuery
      );

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('estimated_revenue');
    });

    it('should return passed=false when guest does not exist', async () => {
      const mockQuery = buildMockQuery({ guestExists: false });
      const checkIn = futureDate(3);
      const checkOut = futureDate(5);

      const result = await runPreflightChecks(
        '60000000000', '2-bed', checkIn, checkOut, 'pelangi', mockQuery
      );

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations.some(v => v.violation_type === 'guest_not_found')).toBe(true);
    });

    it('should return passed=false when check-in date is in the past', async () => {
      const mockQuery = buildMockQuery({ guestExists: true });
      const checkIn = pastDate(3);
      const checkOut = futureDate(2);

      const result = await runPreflightChecks(
        '60123456789', '2-bed', checkIn, checkOut, 'pelangi', mockQuery
      );

      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.violation_type === 'past_date')).toBe(true);
    });

    it('should return passed=false when room type is invalid', async () => {
      const mockQuery = buildMockQuery({ guestExists: true });
      const checkIn = futureDate(3);
      const checkOut = futureDate(5);

      const result = await runPreflightChecks(
        '60123456789', 'luxury-penthouse', checkIn, checkOut, 'pelangi', mockQuery
      );

      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.violation_type === 'invalid_room_type')).toBe(true);
    });

    it('should return passed=false when overlapping bookings exist', async () => {
      const checkIn = futureDate(3);
      const checkOut = futureDate(5);
      const mockQuery = buildMockQuery({
        guestExists: true,
        overlappingBookings: [{
          id: 'booking-1',
          room_id: '2-bed',
          guest_phone: '60111222333',
          guest_name: 'Other Guest',
          check_in_date: futureDate(2),
          check_out_date: futureDate(6),
          status: 'confirmed',
        }],
      });

      const result = await runPreflightChecks(
        '60123456789', '2-bed', checkIn, checkOut, 'pelangi', mockQuery
      );

      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.violation_type === 'booking_overlap')).toBe(true);
    });
  });

  // ── AC2: Separates violations from warnings ──────────────────────

  describe('violation/warning separation', () => {
    it('should place critical issues in violations and non-critical in warnings', async () => {
      // Guest with unknown age booking a room that requires min_age 18
      const mockQuery = buildMockQuery({
        guestExists: true,
        guestProfile: 'pelangi',
        guestMetadata: null, // no age data => produces warning
      });
      const checkIn = futureDate(3);
      const checkOut = futureDate(5);

      const result = await runPreflightChecks(
        '60123456789', 'private', checkIn, checkOut, 'pelangi', mockQuery
      );

      // age_unknown is a warning, not a violation
      const ageWarning = result.warnings.find(w => w.violation_type === 'age_unknown');
      const ageViolation = result.violations.find(v => v.violation_type === 'age_unknown');

      expect(ageWarning).toBeDefined();
      expect(ageViolation).toBeUndefined();
    });

    it('should have all violations with impact_level=critical', async () => {
      const mockQuery = buildMockQuery({ guestExists: false });
      const checkIn = pastDate(1);
      const checkOut = futureDate(2);

      const result = await runPreflightChecks(
        '', '2-bed', checkIn, checkOut, 'pelangi', mockQuery
      );

      for (const v of result.violations) {
        expect(v.impact_level).toBe('critical');
      }
    });

    it('should have all warnings with impact_level=warning', async () => {
      const mockQuery = buildMockQuery({
        guestExists: true,
        guestMetadata: null,
      });
      const checkIn = futureDate(3);
      const checkOut = futureDate(5);

      const result = await runPreflightChecks(
        '60123456789', 'private', checkIn, checkOut, 'pelangi', mockQuery
      );

      for (const w of result.warnings) {
        expect(w.impact_level).toBe('warning');
      }
    });
  });

  // ── AC3: Estimated revenue calculation ────────────────────────────

  describe('estimated_revenue calculation', () => {
    it('should calculate revenue from rate card', async () => {
      const mockQuery = buildMockQuery({
        guestExists: true,
        rateCardRate: 50,
      });
      const checkIn = futureDate(3);
      const checkOut = futureDate(5); // 2 nights

      const result = await runPreflightChecks(
        '60123456789', '2-bed', checkIn, checkOut, 'pelangi', mockQuery
      );

      // 2 nights * 50 = 100
      expect(result.estimated_revenue).toBe(100);
    });

    it('should use default rate when rate card query fails', async () => {
      const errorQuery: QueryFn = vi.fn(async (sql: string, params: any[]) => {
        if (sql.toLowerCase().includes('rate_cards')) {
          throw new Error('Table does not exist');
        }
        // Guest exists
        if (sql.toLowerCase().includes('rainbow_conversations')) {
          return {
            rows: [{
              phone: '60123456789',
              push_name: 'Test',
              profile_id: 'pelangi',
              metadata: null,
              created_at: new Date(),
            }],
          };
        }
        return { rows: [] };
      });

      const checkIn = futureDate(3);
      const checkOut = futureDate(6); // 3 nights

      const result = await runPreflightChecks(
        '60123456789', '2-bed', checkIn, checkOut, 'pelangi', errorQuery
      );

      // Default rate for 2-bed = 45, 3 nights = 135
      expect(result.estimated_revenue).toBe(135);
    });

    it('should return 0 revenue for unknown room types', async () => {
      const mockQuery = buildMockQuery({
        guestExists: true,
        rateCardRate: null,
      });
      const checkIn = futureDate(3);
      const checkOut = futureDate(5);

      // 'luxury-penthouse' has no default rate
      const revenue = await calculateEstimatedRevenue(
        'luxury-penthouse', checkIn, checkOut, mockQuery
      );

      expect(revenue).toBe(0);
    });
  });

  // ── AC4: getRateForRoom ───────────────────────────────────────────

  describe('getRateForRoom', () => {
    it('should return rate from database when available', async () => {
      const mockQuery: QueryFn = vi.fn(async () => ({
        rows: [{ nightly_rate: 75 }],
      }));

      const rate = await getRateForRoom('private', mockQuery);
      expect(rate).toBe(75);
    });

    it('should return default rate when database has no record', async () => {
      const mockQuery: QueryFn = vi.fn(async () => ({ rows: [] }));

      const rate = await getRateForRoom('dorm', mockQuery);
      expect(rate).toBe(30); // default for 'dorm'
    });

    it('should return default rate when query throws', async () => {
      const mockQuery: QueryFn = vi.fn(async () => {
        throw new Error('connection refused');
      });

      const rate = await getRateForRoom('4-bed', mockQuery);
      expect(rate).toBe(35); // default for '4-bed'
    });
  });

  // ── AC5: calculateEstimatedRevenue ────────────────────────────────

  describe('calculateEstimatedRevenue', () => {
    it('should calculate correctly for multi-night stay', async () => {
      const mockQuery: QueryFn = vi.fn(async () => ({
        rows: [{ nightly_rate: 100 }],
      }));

      const checkIn = futureDate(1);
      const checkOut = futureDate(4); // 3 nights

      const revenue = await calculateEstimatedRevenue(checkIn.length > 0 ? '2-bed' : '', checkIn, checkOut, mockQuery);
      // Actually should call with room type
      const rev = await calculateEstimatedRevenue('private', checkIn, checkOut, mockQuery);
      expect(rev).toBe(300);
    });

    it('should return at least 1 night for same-day or invalid range', async () => {
      const mockQuery: QueryFn = vi.fn(async () => ({
        rows: [{ nightly_rate: 50 }],
      }));

      const sameDate = futureDate(3);
      const revenue = await calculateEstimatedRevenue('2-bed', sameDate, sameDate, mockQuery);
      // Math.ceil(0 / ...) = 0, but Math.max(1, 0) = 1
      expect(revenue).toBe(50); // 1 night * 50
    });

    it('should return 0 for invalid dates', async () => {
      const mockQuery: QueryFn = vi.fn(async () => ({
        rows: [{ nightly_rate: 50 }],
      }));

      const revenue = await calculateEstimatedRevenue('2-bed', 'not-a-date', 'also-bad', mockQuery);
      expect(revenue).toBe(0);
    });
  });

  // ── AC6: Result shape ─────────────────────────────────────────────

  describe('result shape conformance', () => {
    it('should return all required fields in result', async () => {
      const mockQuery = buildMockQuery({ guestExists: true });
      const checkIn = futureDate(3);
      const checkOut = futureDate(5);

      const result = await runPreflightChecks(
        '60123456789', '2-bed', checkIn, checkOut, 'pelangi', mockQuery
      );

      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('violations');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('estimated_revenue');
      expect(typeof result.passed).toBe('boolean');
      expect(Array.isArray(result.violations)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(typeof result.estimated_revenue).toBe('number');
    });

    it('should have violation objects with required fields', async () => {
      const mockQuery = buildMockQuery({ guestExists: false });
      const checkIn = futureDate(3);
      const checkOut = futureDate(5);

      const result = await runPreflightChecks(
        '60000000000', '2-bed', checkIn, checkOut, 'pelangi', mockQuery
      );

      expect(result.violations.length).toBeGreaterThan(0);
      for (const v of result.violations) {
        expect(v).toHaveProperty('violation_type');
        expect(v).toHaveProperty('description');
        expect(v).toHaveProperty('impact_level');
        expect(v).toHaveProperty('suggested_fix');
      }
    });

    it('should set passed=true only when violations is empty', async () => {
      // Good booking
      const goodQuery = buildMockQuery({ guestExists: true });
      const checkIn = futureDate(3);
      const checkOut = futureDate(5);

      const goodResult = await runPreflightChecks(
        '60123456789', '2-bed', checkIn, checkOut, 'pelangi', goodQuery
      );
      expect(goodResult.passed).toBe(true);
      expect(goodResult.violations).toHaveLength(0);

      // Bad booking
      const badQuery = buildMockQuery({ guestExists: false });
      const badResult = await runPreflightChecks(
        '60000000000', '2-bed', checkIn, checkOut, 'pelangi', badQuery
      );
      expect(badResult.passed).toBe(false);
      expect(badResult.violations.length).toBeGreaterThan(0);
    });
  });

  // ── AC7: Multiple violations accumulate ───────────────────────────

  describe('multiple validation failures', () => {
    it('should accumulate violations from all validators', async () => {
      const mockQuery = buildMockQuery({
        guestExists: false,
        overlappingBookings: [{
          id: 'b-1',
          room_id: '2-bed',
          guest_phone: '60111222333',
          guest_name: 'Other',
          check_in_date: pastDate(5),
          check_out_date: futureDate(10),
          status: 'confirmed',
        }],
      });

      // past check-in + guest not found + overlap
      const checkIn = pastDate(2);
      const checkOut = futureDate(3);

      const result = await runPreflightChecks(
        '', '2-bed', checkIn, checkOut, 'pelangi', mockQuery
      );

      expect(result.passed).toBe(false);
      // Should have at least guest_id_missing + past_date + booking_overlap
      expect(result.violations.length).toBeGreaterThanOrEqual(3);

      const types = result.violations.map(v => v.violation_type);
      expect(types).toContain('guest_id_missing');
      expect(types).toContain('past_date');
      expect(types).toContain('booking_overlap');
    });
  });
});
