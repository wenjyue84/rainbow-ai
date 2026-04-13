/**
 * US-556: Booking Availability Validation Before Workflow Confirmation
 *
 * Tests for checkAvailability function:
 * 1. Available unit passes - returns {available: true}
 * 2. Booked unit fails - returns {available: false, alternatives: [{checkIn, checkOut, daysCount}]}
 * 3. Date overlap edge cases (same check-in date as existing booking)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkAvailability } from '../../src/tools/bookings.js';
import * as db from '../../src/lib/db.js';

// Mock the database pool
vi.mock('../../src/lib/db.js', () => ({
  pool: {
    query: vi.fn()
  }
}));

describe('US-556: Booking Availability Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns available: true when no conflicting bookings exist', async () => {
    const mockPool = db.pool as any;
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await checkAvailability(
      'pelangi',
      'unit-001',
      new Date('2026-04-20'),
      new Date('2026-04-22')
    );

    expect(result.available).toBe(true);
    expect(result.alternatives).toBeUndefined();
  });

  it('returns available: false with alternatives when unit is booked', async () => {
    const mockPool = db.pool as any;

    // Existing booking from 2026-04-21 to 2026-04-23
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          check_in: '2026-04-21T00:00:00.000Z',
          check_out: '2026-04-23T00:00:00.000Z'
        }
      ]
    });

    const result = await checkAvailability(
      'pelangi',
      'unit-001',
      new Date('2026-04-20'),
      new Date('2026-04-22')
    );

    expect(result.available).toBe(false);
    expect(result.alternatives).toBeDefined();
    expect(Array.isArray(result.alternatives)).toBe(true);
    expect(result.alternatives!.length).toBeGreaterThan(0);
  });

  it('generates 3 alternative date suggestions when booking is unavailable', async () => {
    const mockPool = db.pool as any;

    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          check_in: '2026-04-21T00:00:00.000Z',
          check_out: '2026-04-23T00:00:00.000Z'
        }
      ]
    });

    const result = await checkAvailability(
      'pelangi',
      'unit-001',
      new Date('2026-04-20'),
      new Date('2026-04-22')
    );

    expect(result.alternatives!.length).toBe(3);
    result.alternatives!.forEach((alt) => {
      expect(alt).toHaveProperty('checkIn');
      expect(alt).toHaveProperty('checkOut');
      expect(alt).toHaveProperty('daysCount');
      expect(typeof alt.checkIn).toBe('string');
      expect(typeof alt.checkOut).toBe('string');
      expect(typeof alt.daysCount).toBe('number');
    });
  });

  it('handles date overlap edge case: same check-in date as existing booking', async () => {
    const mockPool = db.pool as any;

    // Existing booking starts on 2026-04-20
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          check_in: '2026-04-20T00:00:00.000Z',
          check_out: '2026-04-22T00:00:00.000Z'
        }
      ]
    });

    const result = await checkAvailability(
      'pelangi',
      'unit-001',
      new Date('2026-04-20'),
      new Date('2026-04-23')
    );

    expect(result.available).toBe(false);
    expect(result.alternatives).toBeDefined();
  });

  it('returns available: true when dates are after all existing bookings', async () => {
    const mockPool = db.pool as any;

    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          check_in: '2026-04-20T00:00:00.000Z',
          check_out: '2026-04-22T00:00:00.000Z'
        }
      ]
    });

    const result = await checkAvailability(
      'pelangi',
      'unit-001',
      new Date('2026-04-25'),
      new Date('2026-04-27')
    );

    expect(result.available).toBe(true);
  });

  it('returns available: false when requested dates overlap with multiple bookings', async () => {
    const mockPool = db.pool as any;

    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          check_in: '2026-04-20T00:00:00.000Z',
          check_out: '2026-04-22T00:00:00.000Z'
        },
        {
          check_in: '2026-04-24T00:00:00.000Z',
          check_out: '2026-04-26T00:00:00.000Z'
        }
      ]
    });

    const result = await checkAvailability(
      'pelangi',
      'unit-001',
      new Date('2026-04-20'),
      new Date('2026-04-27')
    );

    expect(result.available).toBe(false);
  });

  it('fails gracefully when database query fails', async () => {
    const mockPool = db.pool as any;
    mockPool.query.mockRejectedValueOnce(new Error('Database error'));

    const result = await checkAvailability(
      'pelangi',
      'unit-001',
      new Date('2026-04-20'),
      new Date('2026-04-22')
    );

    // Fail-open: allow booking if DB query fails
    expect(result.available).toBe(true);
  });

  it('handles invalid date formats gracefully', async () => {
    const mockPool = db.pool as any;

    const result = await checkAvailability(
      'pelangi',
      'unit-001',
      'invalid-date',
      'also-invalid'
    );

    expect(result.available).toBe(false);
  });

  it('rejects when check-in >= check-out', async () => {
    const mockPool = db.pool as any;

    const result = await checkAvailability(
      'pelangi',
      'unit-001',
      new Date('2026-04-22'),
      new Date('2026-04-20')
    );

    expect(result.available).toBe(false);
  });

  it('queries guest_bookings table with correct profile and unit filters', async () => {
    const mockPool = db.pool as any;
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const checkInDate = new Date('2026-04-20');
    const checkOutDate = new Date('2026-04-22');

    await checkAvailability('southern', 'room-5', checkInDate, checkOutDate);

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('guest_bookings'),
      expect.arrayContaining(['southern', 'room-5'])
    );
  });

  it('alternative date ranges do not overlap with existing bookings', async () => {
    const mockPool = db.pool as any;

    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          check_in: '2026-04-20T00:00:00.000Z',
          check_out: '2026-04-24T00:00:00.000Z'
        }
      ]
    });

    const result = await checkAvailability(
      'pelangi',
      'unit-001',
      new Date('2026-04-20'),
      new Date('2026-04-22')
    );

    if (result.alternatives) {
      const existingBookings = [
        {
          checkIn: new Date('2026-04-20'),
          checkOut: new Date('2026-04-24')
        }
      ];

      result.alternatives.forEach((alt) => {
        const altCheckIn = new Date(alt.checkIn);
        const altCheckOut = new Date(alt.checkOut);

        existingBookings.forEach((booking) => {
          // Check for no overlap: altCheckOut <= booking.checkIn OR altCheckIn >= booking.checkOut
          const noOverlap =
            altCheckOut <= booking.checkIn || altCheckIn >= booking.checkOut;
          expect(noOverlap).toBe(true);
        });
      });
    }
  });
});
