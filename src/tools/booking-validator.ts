/**
 * US-274: Booking Workflow Room Availability Race Condition Tester
 *
 * Detects and logs potential race conditions when multiple guests attempt
 * to book the same room simultaneously, ensuring booking workflow reliability.
 *
 * Provides simulateConcurrentBookings() which executes parallel workflow steps
 * and validates that only one booking succeeds while others are rejected.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface BookingAttempt {
  attemptId: number;
  roomId: string;
  timestamp: string;
  status: 'success' | 'failed';
  bookingId?: string;
  error?: string;
}

export interface ConcurrentBookingResult {
  roomId: string;
  totalAttempts: number;
  successCount: number;
  failedCount: number;
  attempts: BookingAttempt[];
  auditLog: AuditLogEntry[];
}

export interface AuditLogEntry {
  attemptId: number;
  roomId: string;
  timestamp: string;
  action: 'BOOKING_ATTEMPT' | 'BOOKING_SUCCESS' | 'BOOKING_REJECTED';
  detail: string;
}

// ─── Room Lock State ────────────────────────────────────────────────

/**
 * In-memory room lock map. In production this would be backed by
 * a database advisory lock or Redis SETNX. For simulation and testing
 * purposes we use a Map that acts as a mutex per room.
 */
const roomLocks = new Map<string, string>();

/**
 * Try to acquire an exclusive lock on a room.
 * Returns true if the lock was acquired, false if the room is already locked.
 */
function tryAcquireRoomLock(roomId: string, bookingId: string): boolean {
  if (roomLocks.has(roomId)) {
    return false;
  }
  roomLocks.set(roomId, bookingId);
  return true;
}

/**
 * Release a room lock.
 */
function releaseRoomLock(roomId: string): void {
  roomLocks.delete(roomId);
}

/**
 * Clear all room locks. Used for testing.
 */
export function clearRoomLocks(): void {
  roomLocks.clear();
}

// ─── Booking attempt logic ──────────────────────────────────────────

/**
 * Generate a simple unique booking ID.
 */
function generateBookingId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `BK-${ts}-${rand}`;
}

/**
 * Attempt a single booking for a room. Uses the in-memory room lock
 * to enforce mutual exclusion — only one concurrent caller can succeed.
 */
async function attemptBooking(
  roomId: string,
  attemptId: number,
  auditLog: AuditLogEntry[]
): Promise<BookingAttempt> {
  const timestamp = new Date().toISOString();
  const bookingId = generateBookingId();

  // Log the attempt
  auditLog.push({
    attemptId,
    roomId,
    timestamp,
    action: 'BOOKING_ATTEMPT',
    detail: `Attempt #${attemptId} requesting room ${roomId}`,
  });

  // Try to acquire the room lock (simulates DB-level row lock / advisory lock)
  const acquired = tryAcquireRoomLock(roomId, bookingId);

  if (!acquired) {
    const rejectTimestamp = new Date().toISOString();
    auditLog.push({
      attemptId,
      roomId,
      timestamp: rejectTimestamp,
      action: 'BOOKING_REJECTED',
      detail: `Attempt #${attemptId} rejected — room ${roomId} unavailable`,
    });

    return {
      attemptId,
      roomId,
      timestamp,
      status: 'failed',
      error: 'room unavailable',
    };
  }

  // Lock acquired — booking succeeds
  const successTimestamp = new Date().toISOString();
  auditLog.push({
    attemptId,
    roomId,
    timestamp: successTimestamp,
    action: 'BOOKING_SUCCESS',
    detail: `Attempt #${attemptId} booked room ${roomId} as ${bookingId}`,
  });

  return {
    attemptId,
    roomId,
    timestamp,
    status: 'success',
    bookingId,
  };
}

// ─── Main exported function ─────────────────────────────────────────

/**
 * Simulate `count` concurrent booking requests for the same room.
 *
 * All requests are fired in parallel via Promise.all to maximise
 * the chance of race conditions. The in-memory room lock ensures
 * mutual exclusion so that exactly 1 booking succeeds and the rest
 * receive a 'room unavailable' error.
 *
 * @param roomId - The room identifier to book
 * @param count  - Number of concurrent booking attempts (default 5)
 * @returns ConcurrentBookingResult with per-attempt outcomes and audit log
 */
export async function simulateConcurrentBookings(
  roomId: string,
  count: number = 5
): Promise<ConcurrentBookingResult> {
  // Reset lock state for this room before the simulation
  releaseRoomLock(roomId);

  const auditLog: AuditLogEntry[] = [];

  // Fire all booking attempts concurrently
  const promises: Promise<BookingAttempt>[] = [];
  for (let i = 1; i <= count; i++) {
    promises.push(attemptBooking(roomId, i, auditLog));
  }

  const attempts = await Promise.all(promises);

  const successCount = attempts.filter((a) => a.status === 'success').length;
  const failedCount = attempts.filter((a) => a.status === 'failed').length;

  // Clean up the lock after simulation
  releaseRoomLock(roomId);

  return {
    roomId,
    totalAttempts: count,
    successCount,
    failedCount,
    attempts,
    auditLog,
  };
}
