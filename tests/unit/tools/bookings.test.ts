/**
 * US-556: Booking Availability Validation Tests
 *
 * Tests for checkAvailability() function:
 * - Available unit passes
 * - Booked unit fails
 * - Date overlap edge cases (same check-in date)
 * - Alternative date suggestions generated correctly
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkAvailability, type AvailabilityResult } from '../../../src/tools/bookings.js';

// Mock the database pool
vi.mock('../../../src/lib/db.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from '../../../src/lib/db.js';

describe('checkAvailability()', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('happy path: unit is available', () => {
    it('should return available=true when no conflicting bookings exist', async () => {
      const mockQuery = vi.mocked(pool.query);
      mockQuery.mockResolvedValue({ rows: [] } as any);

      const result = await checkAvailability(
        'pelangi',
        'capsule-01',
        '2026-05-01',
        '2026-05-03'
      );

      expect(result.available).toBe(true);
      expect(result.alternatives).toBeUndefined();
    });

    it('should query with correct profile and unit ID', async () => {
      const mockQuery = vi.mocked(pool.query);
      mockQuery.mockResolvedValue({ rows: [] } as any);

      await checkAvailability(
        'southern',
        'room-42',
        '2026-05-10',
        '2026-05-12'
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('guest_bookings'),
        expect.arrayContaining(['southern', 'room-42'])
      );
    });
  });

  describe('unit is booked: date conflicts', () => {
    it('should return available=false when booking overlaps entire requested period', async () => {
      const mockQuery = vi.mocked(pool.query);
      mockQuery.mockResolvedValue({
        rows: [
          {
            check_in: '2026-05-01T00:00:00Z',
            check_out: '2026-05-05T00:00:00Z',
          },
        ],
      } as any);

      const result = await checkAvailability(
        'pelangi',
        'capsule-01',
        '2026-05-02',
        '2026-05-04'
      );

      expect(result.available).toBe(false);
      expect(Array.isArray(result.alternatives)).toBe(true);
      expect((result.alternatives as any[]).length).toBeGreaterThan(0);
    });

    it('should allow same-day turnover (check-in = existing check-out)', async () => {
      const mockQuery = vi.mocked(pool.query);
      // SQL: check_out > checkIn AND check_in < checkOut
      // For existing booking ending 2026-05-03 and new booking starting 2026-05-03:
      // 2026-05-03 > 2026-05-03 = FALSE, so no conflict (empty rows)
      mockQuery.mockResolvedValue({ rows: [] } as any);

      const result = await checkAvailability(
        'pelangi',
        'capsule-01',
        '2026-05-03',
        '2026-05-05'
      );

      expect(result.available).toBe(true);
    });

    it('should handle multiple overlapping bookings', async () => {
      const mockQuery = vi.mocked(pool.query);
      mockQuery.mockResolvedValue({
        rows: [
          {
            check_in: '2026-05-01T00:00:00Z',
            check_out: '2026-05-03T00:00:00Z',
          },
          {
            check_in: '2026-05-05T00:00:00Z',
            check_out: '2026-05-07T00:00:00Z',
          },
        ],
      } as any);

      const result = await checkAvailability(
        'pelangi',
        'capsule-01',
        '2026-05-02',
        '2026-05-06'
      );

      expect(result.available).toBe(false);
      expect((result.alternatives as any[]).length).toBe(3);
    });
  });

  describe('alternative date suggestions', () => {
    it('should provide 3 alternative date ranges when booking unavailable', async () => {
      const mockQuery = vi.mocked(pool.query);
      mockQuery.mockResolvedValue({
        rows: [
          {
            check_in: '2026-05-05T00:00:00Z',
            check_out: '2026-05-10T00:00:00Z',
          },
        ],
      } as any);

      const result = await checkAvailability(
        'pelangi',
        'capsule-01',
        '2026-05-01',
        '2026-05-03'
      );

      expect(result.available).toBe(false);
      expect((result.alternatives as any[]).length).toBe(3);

      // Alternatives should be ISO date strings
      (result.alternatives as any[]).forEach((alt) => {
        expect(typeof alt.checkIn).toBe('string');
        expect(typeof alt.checkOut).toBe('string');
        expect(typeof alt.daysCount).toBe('number');
        expect(alt.daysCount).toBeGreaterThan(0);
        // Check format is YYYY-MM-DD
        expect(alt.checkIn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(alt.checkOut).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });

    it('should suggest dates after conflicting booking ends', async () => {
      const mockQuery = vi.mocked(pool.query);
      mockQuery.mockResolvedValue({
        rows: [
          {
            check_in: '2026-05-05T00:00:00Z',
            check_out: '2026-05-10T00:00:00Z',
          },
        ],
      } as any);

      const result = await checkAvailability(
        'pelangi',
        'capsule-01',
        '2026-05-06',
        '2026-05-08'
      );

      if (result.available === false && result.alternatives) {
        // First alternative should start at or after conflicting booking's check-out
        const firstAlt = new Date(result.alternatives[0]!.checkIn);
        const conflictEnd = new Date('2026-05-10');
        expect(firstAlt.getTime()).toBeGreaterThanOrEqual(conflictEnd.getTime());
      }
    });
  });

  describe('error handling', () => {
    it('should return available=false for invalid check-in date', async () => {
      const result = await checkAvailability(
        'pelangi',
        'capsule-01',
        'invalid-date',
        '2026-05-03'
      );

      expect(result.available).toBe(false);
    });

    it('should return available=false for invalid check-out date', async () => {
      const result = await checkAvailability(
        'pelangi',
        'capsule-01',
        '2026-05-01',
        'not-a-date'
      );

      expect(result.available).toBe(false);
    });

    it('should return available=false when check-in >= check-out', async () => {
      const result = await checkAvailability(
        'pelangi',
        'capsule-01',
        '2026-05-05',
        '2026-05-03'
      );

      expect(result.available).toBe(false);
    });

    it('should fail open (available=true) on database error', async () => {
      const mockQuery = vi.mocked(pool.query);
      mockQuery.mockRejectedValue(new Error('DB connection failed'));

      const result = await checkAvailability(
        'pelangi',
        'capsule-01',
        '2026-05-01',
        '2026-05-03'
      );

      // Fail open: allow booking if DB fails
      expect(result.available).toBe(true);
    });
  });

  describe('date input formats', () => {
    it('should accept ISO string dates', async () => {
      const mockQuery = vi.mocked(pool.query);
      mockQuery.mockResolvedValue({ rows: [] } as any);

      const result = await checkAvailability(
        'pelangi',
        'capsule-01',
        '2026-05-01T00:00:00Z',
        '2026-05-03T00:00:00Z'
      );

      expect(result.available).toBe(true);
    });

    it('should accept Date objects', async () => {
      const mockQuery = vi.mocked(pool.query);
      mockQuery.mockResolvedValue({ rows: [] } as any);

      const checkIn = new Date('2026-05-01');
      const checkOut = new Date('2026-05-03');

      const result = await checkAvailability(
        'pelangi',
        'capsule-01',
        checkIn,
        checkOut
      );

      expect(result.available).toBe(true);
    });
  });

  describe('profile normalization', () => {
    it('should query with exact profile string passed', async () => {
      const mockQuery = vi.mocked(pool.query);
      mockQuery.mockResolvedValue({ rows: [] } as any);

      await checkAvailability(
        'southern',
        'room-01',
        '2026-05-01',
        '2026-05-03'
      );

      const args = mockQuery.mock.calls[0]![1] as any[];
      expect(args[0]).toBe('southern');
    });
  });
});
