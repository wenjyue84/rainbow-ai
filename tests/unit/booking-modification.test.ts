/**
 * US-064: Booking modification workflow — unit tests
 *
 * Scenarios:
 * 1. Date conflict detected → suggest_alternatives  (conflicting bookings returned)
 * 2. Room type unavailable  → fallback_rooms        (room-type specific conflict)
 * 3. Successful modification → confirmation_message  (no conflicts, empty array)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findConflictingBookings } from '../../src/tools/bookings.js';
import type { DateRange } from '../../src/tools/bookings.js';

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

const proposedRange: DateRange = {
  checkIn: new Date('2026-04-10'),
  checkOut: new Date('2026-04-12'),
};

function makeRow(bookingId: string, arrivalDate: string, departureDate: string, roomType: string, guestName: string) {
  return {
    booking_id: bookingId,
    variables: JSON.stringify({ arrivalDate, departureDate, roomType, guestName }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('US-064: findConflictingBookings', () => {

  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── Scenario 1: Date conflict detected → suggest_alternatives ──────
  it('returns conflicting bookings when dates overlap (suggest_alternatives)', async () => {
    const mockedQuery = await getMockedQuery();
    // Existing booking: Apr 11 – Apr 13 overlaps with proposed Apr 10 – Apr 12
    mockedQuery.mockResolvedValueOnce({
      rows: [makeRow('BK-001', '2026-04-11', '2026-04-13', 'capsule', 'Ali Ahmad')],
    } as any);

    const conflicts = await findConflictingBookings(proposedRange, 'capsule', 'pelangi');

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].id).toBe('BK-001');
    expect(conflicts[0].guestName).toBe('Ali Ahmad');
    expect(conflicts[0].roomType).toBe('capsule');
    // Caller action: suggest_alternatives
    expect(conflicts.length).toBeGreaterThan(0);
  });

  // ── Scenario 2: Room type unavailable → fallback_rooms ─────────────
  it('returns conflict only for matching room type, not other types (fallback_rooms)', async () => {
    const mockedQuery = await getMockedQuery();
    // Two existing bookings: one capsule (overlapping), one private (overlapping)
    mockedQuery.mockResolvedValueOnce({
      rows: [
        makeRow('BK-002', '2026-04-10', '2026-04-12', 'capsule', 'Mei Lin'),
        makeRow('BK-003', '2026-04-10', '2026-04-12', 'private', 'Raj Kumar'),
      ],
    } as any);

    // Guest requests 'capsule' — only capsule conflict should be flagged
    const conflicts = await findConflictingBookings(proposedRange, 'capsule', 'pelangi');

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].roomType).toBe('capsule');
    // 'private' room is available — caller should offer it as fallback_rooms
    const conflictTypes = conflicts.map(c => c.roomType);
    expect(conflictTypes).not.toContain('private');
  });

  // ── Scenario 3: No conflicts → confirmation_message ─────────────────
  it('returns empty array when no overlapping bookings (confirmation_message)', async () => {
    const mockedQuery = await getMockedQuery();
    // Existing booking is far in the future — no overlap
    mockedQuery.mockResolvedValueOnce({
      rows: [makeRow('BK-004', '2026-05-01', '2026-05-03', 'capsule', 'David Wong')],
    } as any);

    const conflicts = await findConflictingBookings(proposedRange, 'capsule', 'pelangi');

    expect(conflicts).toHaveLength(0);
    // Caller action: proceed with confirmation_message
  });

  // ── Edge cases ────────────────────────────────────────────────────
  it('returns empty array when checkIn >= checkOut (invalid range)', async () => {
    const invalidRange: DateRange = {
      checkIn: new Date('2026-04-12'),
      checkOut: new Date('2026-04-10'),
    };

    const conflicts = await findConflictingBookings(invalidRange, 'capsule', 'pelangi');
    expect(conflicts).toHaveLength(0);
  });

  it('returns empty array on DB error (fail-open)', async () => {
    const mockedQuery = await getMockedQuery();
    mockedQuery.mockRejectedValueOnce(new Error('DB connection failed'));

    const conflicts = await findConflictingBookings(proposedRange, 'capsule', 'pelangi');
    expect(conflicts).toHaveLength(0);
  });

  it('matches all room types when roomType is empty string', async () => {
    const mockedQuery = await getMockedQuery();
    mockedQuery.mockResolvedValueOnce({
      rows: [
        makeRow('BK-005', '2026-04-10', '2026-04-12', 'capsule', 'Test Guest 1'),
        makeRow('BK-006', '2026-04-10', '2026-04-12', 'private', 'Test Guest 2'),
      ],
    } as any);

    // Empty roomType = match all
    const conflicts = await findConflictingBookings(proposedRange, '', 'pelangi');
    expect(conflicts).toHaveLength(2);
  });
});
