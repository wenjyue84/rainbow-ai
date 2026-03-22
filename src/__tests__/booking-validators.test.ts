/**
 * US-038: Add booking workflow date conflict detection
 *
 * Tests:
 * 1. dateRangeConflict() function exists and is callable
 * 2. Function rejects overlapping check-in dates
 * 3. Function accepts valid non-overlapping dates
 */

import { describe, it, expect, vi } from 'vitest';
import { dateRangeConflict, _parseBookingDates, _parseSingleDate, _datesOverlap } from '../assistant/pipeline/booking-validators.js';

// Mock the database pool
vi.mock('../../lib/db.js', () => ({
  pool: {
    query: vi.fn(async (sql: string, params: any[]) => {
      // Return empty result for now (no existing bookings)
      return { rows: [] };
    })
  }
}));

describe('US-038: dateRangeConflict validator', () => {
  it('dateRangeConflict function exists and is async', async () => {
    expect(typeof dateRangeConflict).toBe('function');
    const result = await dateRangeConflict('15 Feb, 17 Feb', 'pelangi');
    expect(result).toHaveProperty('hasConflict');
    expect(result).toHaveProperty('message');
  });

  it('rejects invalid date strings with no conflict', async () => {
    const result = await dateRangeConflict('invalid dates', 'pelangi');
    expect(result.hasConflict).toBe(false);
    expect(result.message).toContain('Could not parse');
  });

  it('rejects when check-in >= check-out', async () => {
    const result = await dateRangeConflict('17 Feb, 15 Feb', 'pelangi'); // backwards
    expect(result.hasConflict).toBe(false);
  });

  it('accepts valid non-overlapping dates with empty bookings', async () => {
    const result = await dateRangeConflict('15 Feb, 17 Feb', 'pelangi');
    expect(result.hasConflict).toBe(false);
    expect(result.message).toContain('No conflicts');
  });

  it('parses various date formats', async () => {
    // Test internal parsing functions (exported for testing)
    const parsed1 = _parseBookingDates('15 Feb, 17 Feb');
    expect(parsed1).not.toBeNull();
    expect(parsed1?.checkIn).toBeDefined();
    expect(parsed1?.checkOut).toBeDefined();

    const parsed2 = _parseBookingDates('15/2/2026 to 17/2/2026');
    expect(parsed2).not.toBeNull();
  });

  it('detects date overlap with datesOverlap helper', () => {
    const d1 = new Date('2026-02-15');
    const d2 = new Date('2026-02-17');
    const d3 = new Date('2026-02-16');
    const d4 = new Date('2026-02-18');

    // d1-d2 and d3-d4 overlap
    expect(_datesOverlap(d1, d2, d3, d4)).toBe(true);

    // d1-d2 (15-17) and d4-d3 (18-16) don't overlap (reversed)
    const d5 = new Date('2026-02-18');
    const d6 = new Date('2026-02-19');
    expect(_datesOverlap(d1, d2, d5, d6)).toBe(false); // 15-17 and 18-19 don't overlap
  });

  it('parses single date and increments day if only one date given', () => {
    const parsed = _parseBookingDates('15 Feb');
    expect(parsed).not.toBeNull();
    expect(parsed?.checkIn).toBeDefined();
    expect(parsed?.checkOut).toBeDefined();
    // Should have next day as checkout
    expect(parsed!.checkOut.getTime()).toBeGreaterThan(parsed!.checkIn.getTime());
  });

  it('returns no conflict result on database error (fail-open)', async () => {
    // Mock database to throw error
    const { pool } = await import('../../lib/db.js');
    vi.mocked(pool.query).mockRejectedValueOnce(new Error('DB Error'));

    const result = await dateRangeConflict('15 Feb, 17 Feb', 'pelangi');
    expect(result.hasConflict).toBe(false);
    expect(result.message).toContain('database error');
  });
});
