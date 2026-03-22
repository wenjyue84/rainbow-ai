/**
 * US-072: Booking cancellation workflow with automatic guest credit calculation
 *
 * Tests:
 * 1. Cancellation >48 hours before check-in returns '100% credit applied'
 * 2. Cancellation <48 hours before check-in returns '50% credit applied'
 * 3. Invalid check-in dates are handled gracefully
 * 4. Exact 48-hour boundary case returns 50% credit
 */

import { describe, it, expect } from 'vitest';
import { calculateCancellationCredit } from '../../tools/bookings.js';

describe('US-072: Booking cancellation credit calculation', () => {
  it('returns 100% credit for cancellation 72 hours before check-in', () => {
    const futureDate = new Date();
    futureDate.setHours(futureDate.getHours() + 72);

    const result = calculateCancellationCredit(futureDate);

    expect(result).toContain('100% credit applied');
  });

  it('returns 50% credit for cancellation 24 hours before check-in', () => {
    const futureDate = new Date();
    futureDate.setHours(futureDate.getHours() + 24);

    const result = calculateCancellationCredit(futureDate);

    expect(result).toContain('50% credit applied');
  });

  it('returns 50% credit at exact 48-hour boundary', () => {
    const futureDate = new Date();
    futureDate.setHours(futureDate.getHours() + 48);

    const result = calculateCancellationCredit(futureDate);

    expect(result).toContain('50% credit applied');
  });

  it('returns 100% credit slightly after 48-hour mark (49 hours)', () => {
    const futureDate = new Date();
    futureDate.setHours(futureDate.getHours() + 49);

    const result = calculateCancellationCredit(futureDate);

    expect(result).toContain('100% credit applied');
  });

  it('handles ISO string dates correctly', () => {
    const futureDate = new Date();
    futureDate.setHours(futureDate.getHours() + 72);
    const isoString = futureDate.toISOString();

    const result = calculateCancellationCredit(isoString);

    expect(result).toContain('100% credit applied');
  });

  it('gracefully handles invalid date formats', () => {
    const result = calculateCancellationCredit('invalid-date');

    expect(result).toContain('Error');
  });

  it('returns appropriate message for past check-in dates', () => {
    const pastDate = new Date();
    pastDate.setHours(pastDate.getHours() - 24);

    const result = calculateCancellationCredit(pastDate);

    // Past dates would have negative hours, which is <=48, so 50% credit
    expect(result).toContain('50% credit applied');
  });
});
