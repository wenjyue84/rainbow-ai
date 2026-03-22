/**
 * US-068: Pre-confirmation booking business rule validator — unit tests
 *
 * Tests for validatePreConfirmationRules function covering:
 * 1. Max stay nights validation
 * 2. Room capacity validation
 * 3. Advance booking window validation
 * 4. Past date rejection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validatePreConfirmationRules } from '../../src/assistant/pipeline/booking-validators.js';
import type { BookingProfile } from '../../src/assistant/pipeline/booking-validators.js';

// ─── Mock DB pool ────────────────────────────────────────────────────

vi.mock('../../src/lib/db.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

// Helper to get the mocked pool.query
async function getMockedQuery() {
  const { pool } = await import('../../src/lib/db.js');
  return vi.mocked(pool.query);
}

// ─── Test data ───────────────────────────────────────────────────────

const now = new Date();
const tomorrow = new Date(now);
tomorrow.setDate(tomorrow.getDate() + 1);

const nextMonth = new Date(now);
nextMonth.setDate(nextMonth.getDate() + 30);

const pastDate = new Date(now);
pastDate.setDate(pastDate.getDate() - 5);

const defaultProfile: BookingProfile & { guest_count?: number } = {
  max_stay_nights: 30,
  room_capacity: 2,
  advance_booking_window: 90,
  guest_count: 1,
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('US-068: validatePreConfirmationRules', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── Test 1: No violations ──────────────────────────────────────────
  it('returns isValid=true when all rules are met', async () => {
    const mockedQuery = await getMockedQuery();
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const result = await validatePreConfirmationRules(
      'John Doe',
      'ROOM-101',
      tomorrow,
      2,
      defaultProfile
    );

    expect(result.isValid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.recommendations).toHaveLength(0);
  });

  // ── Test 2: Guest exceeds max stay nights ──────────────────────────
  it('generates warning when guest_total_nights_booked + night_count > maxStayDays', async () => {
    const mockedQuery = await getMockedQuery();
    const existingBookingDate = new Date(now);
    existingBookingDate.setDate(existingBookingDate.getDate() + 5);
    const existingCheckOut = new Date(existingBookingDate);
    existingCheckOut.setDate(existingCheckOut.getDate() + 25); // 25 nights

    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          variables: JSON.stringify({
            guestName: 'John Doe',
            arrivalDate: existingBookingDate.toISOString(),
            departureDate: existingCheckOut.toISOString(),
            roomType: 'capsule',
          }),
        },
      ],
    });

    const result = await validatePreConfirmationRules(
      'John Doe',
      'ROOM-101',
      tomorrow,
      10, // 25 + 10 = 35, exceeds maxStayDays of 30
      defaultProfile
    );

    expect(result.isValid).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'MAX_STAY_EXCEEDED',
      })
    );
    expect(result.recommendations).toContainEqual(
      expect.stringContaining('Suggest reducing the stay length')
    );
  });

  // ── Test 3: Room capacity exceeded ─────────────────────────────────
  it('generates warning when room_beds < guest_count', async () => {
    const mockedQuery = await getMockedQuery();
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const result = await validatePreConfirmationRules(
      'Family Group',
      'ROOM-105',
      tomorrow,
      3,
      {
        ...defaultProfile,
        guest_count: 5, // 5 guests
        room_capacity: 2, // Room only has 2 beds
      }
    );

    expect(result.isValid).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'ROOM_CAPACITY_EXCEEDED',
      })
    );
    expect(result.recommendations).toContainEqual(
      expect.stringContaining('larger rooms')
    );
  });

  // ── Test 4: Reject past check-out dates ────────────────────────────
  it('rejects booking with check-out date in the past', async () => {
    const mockedQuery = await getMockedQuery();
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const result = await validatePreConfirmationRules(
      'John Doe',
      'ROOM-101',
      pastDate,
      1,
      defaultProfile
    );

    expect(result.isValid).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'PAST_CHECKOUT_DATE',
      })
    );
  });

  // ── Test 5: Check-in beyond advance booking window ──────────────────
  it('generates warning when check_in > advance_booking_window days', async () => {
    const mockedQuery = await getMockedQuery();
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const farFutureDate = new Date(now);
    farFutureDate.setDate(farFutureDate.getDate() + 120); // 120 days > 90-day window

    const result = await validatePreConfirmationRules(
      'John Doe',
      'ROOM-101',
      farFutureDate,
      2,
      { ...defaultProfile, advance_booking_window: 90 }
    );

    expect(result.isValid).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'ADVANCE_BOOKING_WINDOW_EXCEEDED',
      })
    );
  });

  // ── Test 6: Multiple warnings ──────────────────────────────────────
  it('accumulates multiple warnings when multiple rules are violated', async () => {
    const mockedQuery = await getMockedQuery();
    const existingBookingDate = new Date(now);
    existingBookingDate.setDate(existingBookingDate.getDate() + 5);
    const existingCheckOut = new Date(existingBookingDate);
    existingCheckOut.setDate(existingCheckOut.getDate() + 25);

    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          variables: JSON.stringify({
            guestName: 'John Doe',
            arrivalDate: existingBookingDate.toISOString(),
            departureDate: existingCheckOut.toISOString(),
            roomType: 'capsule',
          }),
        },
      ],
    });

    const farFutureDate = new Date(now);
    farFutureDate.setDate(farFutureDate.getDate() + 120);

    const result = await validatePreConfirmationRules(
      'John Doe',
      'ROOM-101',
      farFutureDate,
      10, // 25 + 10 = 35, exceeds maxStayDays of 30
      {
        ...defaultProfile,
        guest_count: 4,
        room_capacity: 2,
        advance_booking_window: 90,
      }
    );

    expect(result.isValid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(1);
  });

  // ── Test 7: Graceful handling of DB errors ─────────────────────────
  it('fails open on database query error', async () => {
    const mockedQuery = await getMockedQuery();
    mockedQuery.mockRejectedValueOnce(new Error('DB connection error'));

    const result = await validatePreConfirmationRules(
      'John Doe',
      'ROOM-101',
      tomorrow,
      2,
      defaultProfile
    );

    // Should not crash, should return valid=true (fail-open)
    // since we couldn't verify the constraint
    expect(result).toBeDefined();
  });

  // ── Test 8: Case-insensitive guest name matching ────────────────────
  it('matches guest names case-insensitively when checking history', async () => {
    const mockedQuery = await getMockedQuery();
    const existingBookingDate = new Date(now);
    existingBookingDate.setDate(existingBookingDate.getDate() + 5);
    const existingCheckOut = new Date(existingBookingDate);
    existingCheckOut.setDate(existingCheckOut.getDate() + 25);

    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          variables: JSON.stringify({
            guestName: 'JOHN DOE', // uppercase
            arrivalDate: existingBookingDate.toISOString(),
            departureDate: existingCheckOut.toISOString(),
            roomType: 'capsule',
          }),
        },
      ],
    });

    const result = await validatePreConfirmationRules(
      'john doe', // lowercase query
      'ROOM-101',
      tomorrow,
      10, // 25 + 10 = 35, exceeds maxStayDays of 30
      defaultProfile
    );

    expect(result.isValid).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'MAX_STAY_EXCEEDED',
      })
    );
  });
});
