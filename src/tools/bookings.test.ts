/**
 * Booking tools tests
 *
 * US-072: Tests for calculateCancellationCredit function
 * - Verifies 100% credit for cancellations >48 hours before check-in
 * - Verifies 50% credit for cancellations <=48 hours before check-in
 * - Handles invalid dates gracefully
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateCancellationCredit } from './bookings.js';

describe('calculateCancellationCredit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 100% credit when cancellation is 72 hours before check-in', () => {
    // Set current time to 2026-03-20 10:00 AM
    const now = new Date('2026-03-20T10:00:00Z');
    vi.setSystemTime(now);

    // Check-in is 2026-03-23 10:00 AM (72 hours later)
    const checkInDate = '2026-03-23T10:00:00Z';

    const result = calculateCancellationCredit(checkInDate);

    expect(result).toContain('100% credit applied');
  });

  it('returns 50% credit when cancellation is 24 hours before check-in', () => {
    // Set current time to 2026-03-22 10:00 AM
    const now = new Date('2026-03-22T10:00:00Z');
    vi.setSystemTime(now);

    // Check-in is 2026-03-23 10:00 AM (24 hours later)
    const checkInDate = '2026-03-23T10:00:00Z';

    const result = calculateCancellationCredit(checkInDate);

    expect(result).toContain('50% credit applied');
  });

  it('returns 100% credit when cancellation is exactly 48+ hours before check-in', () => {
    // Set current time to 2026-03-20 10:00 AM
    const now = new Date('2026-03-20T10:00:00Z');
    vi.setSystemTime(now);

    // Check-in is 2026-03-22 10:01 AM (48 hours and 1 minute later)
    const checkInDate = '2026-03-22T10:01:00Z';

    const result = calculateCancellationCredit(checkInDate);

    expect(result).toContain('100% credit applied');
  });

  it('returns 50% credit when cancellation is exactly 48 hours before check-in', () => {
    // Set current time to 2026-03-20 10:00 AM
    const now = new Date('2026-03-20T10:00:00Z');
    vi.setSystemTime(now);

    // Check-in is 2026-03-22 10:00 AM (exactly 48 hours later)
    const checkInDate = '2026-03-22T10:00:00Z';

    const result = calculateCancellationCredit(checkInDate);

    expect(result).toContain('50% credit applied');
  });

  it('handles date string formats (ISO 8601)', () => {
    // Set current time to 2026-03-20 10:00 AM
    const now = new Date('2026-03-20T10:00:00Z');
    vi.setSystemTime(now);

    // Test with ISO string
    const result = calculateCancellationCredit('2026-03-23T10:00:00Z');

    expect(result).toContain('100% credit applied');
  });

  it('handles Date object input', () => {
    // Set current time to 2026-03-20 10:00 AM
    const now = new Date('2026-03-20T10:00:00Z');
    vi.setSystemTime(now);

    // Test with Date object
    const checkInDate = new Date('2026-03-23T10:00:00Z');
    const result = calculateCancellationCredit(checkInDate);

    expect(result).toContain('100% credit applied');
  });

  it('returns error message for invalid date format', () => {
    const result = calculateCancellationCredit('invalid-date-format');

    expect(result).toContain('❌ Error');
    expect(result).toContain('Invalid check-in date format');
  });

  it('includes refund timeline in success messages', () => {
    // Set current time to 2026-03-20 10:00 AM
    const now = new Date('2026-03-20T10:00:00Z');
    vi.setSystemTime(now);

    const result = calculateCancellationCredit('2026-03-23T10:00:00Z');

    expect(result).toContain('3-5 business days');
  });

  it('handles dates in the past gracefully', () => {
    // Set current time to 2026-03-23 10:00 AM
    const now = new Date('2026-03-23T10:00:00Z');
    vi.setSystemTime(now);

    // Check-in is in the past (2026-03-20), 3 days ago
    const result = calculateCancellationCredit('2026-03-20T10:00:00Z');

    // Should calculate negative hours (already checked in), resulting in 50% credit (late cancellation)
    expect(result).toContain('50% credit applied');
  });
});
