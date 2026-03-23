/**
 * US-274: Booking Workflow Room Availability Race Condition Tester
 *
 * Integration tests that simulate concurrent booking requests for the
 * same room and validate isolation:
 * - 5 concurrent booking requests for the same room
 * - Only 1 booking succeeds
 * - Others receive 'room unavailable' error
 * - Audit log captures all 5 booking attempts with timestamps
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  simulateConcurrentBookings,
  clearRoomLocks,
} from '../../src/tools/booking-validator.js';

// ─── Setup ──────────────────────────────────────────────────────────

describe('US-274: Booking Race Condition Tester', () => {
  beforeEach(() => {
    clearRoomLocks();
  });

  // ── Test 1: Exactly 1 booking succeeds out of 5 concurrent requests ──
  it('only 1 booking succeeds when 5 concurrent requests target the same room', async () => {
    const result = await simulateConcurrentBookings('ROOM-101', 5);

    expect(result.totalAttempts).toBe(5);
    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(4);
  });

  // ── Test 2: Failed attempts receive 'room unavailable' error ─────────
  it('failed attempts receive "room unavailable" error', async () => {
    const result = await simulateConcurrentBookings('ROOM-101', 5);

    const failedAttempts = result.attempts.filter((a) => a.status === 'failed');
    expect(failedAttempts).toHaveLength(4);

    for (const attempt of failedAttempts) {
      expect(attempt.error).toBe('room unavailable');
    }
  });

  // ── Test 3: Successful booking has a valid bookingId ─────────────────
  it('successful booking has a valid bookingId', async () => {
    const result = await simulateConcurrentBookings('ROOM-101', 5);

    const successAttempts = result.attempts.filter((a) => a.status === 'success');
    expect(successAttempts).toHaveLength(1);
    expect(successAttempts[0].bookingId).toBeDefined();
    expect(typeof successAttempts[0].bookingId).toBe('string');
    expect(successAttempts[0].bookingId!.startsWith('BK-')).toBe(true);
  });

  // ── Test 4: Audit log captures all 5 booking attempts with timestamps ─
  it('audit log captures all 5 booking attempts with timestamps', async () => {
    const result = await simulateConcurrentBookings('ROOM-101', 5);

    // There should be at least 5 BOOKING_ATTEMPT entries (one per attempt)
    const attemptEntries = result.auditLog.filter(
      (entry) => entry.action === 'BOOKING_ATTEMPT'
    );
    expect(attemptEntries).toHaveLength(5);

    // Every audit entry should have a valid ISO timestamp
    for (const entry of result.auditLog) {
      expect(entry.timestamp).toBeDefined();
      const parsed = new Date(entry.timestamp);
      expect(isNaN(parsed.getTime())).toBe(false);
    }

    // Verify attempt IDs 1 through 5 are present
    const attemptIds = attemptEntries.map((e) => e.attemptId).sort();
    expect(attemptIds).toEqual([1, 2, 3, 4, 5]);
  });

  // ── Test 5: Audit log has exactly 1 BOOKING_SUCCESS and 4 BOOKING_REJECTED ──
  it('audit log records 1 success and 4 rejections', async () => {
    const result = await simulateConcurrentBookings('ROOM-101', 5);

    const successEntries = result.auditLog.filter(
      (entry) => entry.action === 'BOOKING_SUCCESS'
    );
    const rejectedEntries = result.auditLog.filter(
      (entry) => entry.action === 'BOOKING_REJECTED'
    );

    expect(successEntries).toHaveLength(1);
    expect(rejectedEntries).toHaveLength(4);
  });

  // ── Test 6: Room ID is consistent across all attempts ────────────────
  it('all attempts reference the correct roomId', async () => {
    const roomId = 'CAPSULE-A3';
    const result = await simulateConcurrentBookings(roomId, 5);

    expect(result.roomId).toBe(roomId);
    for (const attempt of result.attempts) {
      expect(attempt.roomId).toBe(roomId);
    }
  });

  // ── Test 7: Different rooms can be booked independently ──────────────
  it('different rooms can be booked concurrently without interference', async () => {
    const [result1, result2] = await Promise.all([
      simulateConcurrentBookings('ROOM-A', 3),
      simulateConcurrentBookings('ROOM-B', 3),
    ]);

    // Each room should have exactly 1 success
    expect(result1.successCount).toBe(1);
    expect(result2.successCount).toBe(1);
  });

  // ── Test 8: Audit log entries contain room ID in detail ──────────────
  it('audit log entries include room ID in detail', async () => {
    const result = await simulateConcurrentBookings('ROOM-X7', 5);

    for (const entry of result.auditLog) {
      expect(entry.roomId).toBe('ROOM-X7');
      expect(entry.detail).toContain('ROOM-X7');
    }
  });
});
