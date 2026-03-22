/**
 * US-048: Past-date check-in validation tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  toLocalDateStr,
  isPastDate,
  getNextAvailableDate,
  validateCheckInDate,
  type DateValidationResult,
} from '../booking.js';

function mockDate(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  vi.useFakeTimers();
  vi.setSystemTime(date);
}

function restoreDate() {
  vi.useRealTimers();
}

describe('Booking Date Validation: toLocalDateStr', () => {
  it('converts Date to ISO format YYYY-MM-DD', () => {
    const date = new Date(2025, 2, 15);
    expect(toLocalDateStr(date)).toBe('2025-03-15');
  });

  it('zero-pads month and day', () => {
    const date = new Date(2025, 0, 5);
    expect(toLocalDateStr(date)).toBe('2025-01-05');
  });

  it('handles month boundary correctly', () => {
    const date = new Date(2025, 11, 31);
    expect(toLocalDateStr(date)).toBe('2025-12-31');
  });
});

describe('Booking Date Validation: isPastDate', () => {
  beforeEach(() => {
    mockDate(2025, 3, 15);
  });

  afterEach(() => {
    restoreDate();
  });

  it('returns true for dates before today', () => {
    expect(isPastDate('2025-03-14')).toBe(true);
    expect(isPastDate('2025-03-01')).toBe(true);
  });

  it('returns true for today', () => {
    expect(isPastDate('2025-03-15')).toBe(true);
  });

  it('returns false for dates after today', () => {
    expect(isPastDate('2025-03-16')).toBe(false);
    expect(isPastDate('2025-04-01')).toBe(false);
  });
});

describe('Booking Date Validation: getNextAvailableDate', () => {
  beforeEach(() => {
    mockDate(2025, 3, 15);
  });

  afterEach(() => {
    restoreDate();
  });

  it('returns tomorrow', () => {
    const result = getNextAvailableDate();
    expect(result).toBe('2025-03-16');
  });

  it('handles month rollover', () => {
    mockDate(2025, 3, 31);
    const result = getNextAvailableDate();
    expect(result).toBe('2025-04-01');
    restoreDate();
  });

  it('handles year rollover', () => {
    mockDate(2025, 12, 31);
    const result = getNextAvailableDate();
    expect(result).toBe('2026-01-01');
    restoreDate();
  });
});

describe('Booking Date Validation: validateCheckInDate', () => {
  beforeEach(() => {
    mockDate(2025, 3, 15);
  });

  afterEach(() => {
    restoreDate();
  });

  it('accepts future dates', () => {
    const result = validateCheckInDate('2025-03-16');
    expect(result.valid).toBe(true);
  });

  it('rejects past dates', () => {
    const result = validateCheckInDate('2025-03-14');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('past_date');
  });

  it('rejects today', () => {
    const result = validateCheckInDate('2025-03-15');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('past_date');
  });

  it('suggests tomorrow for past dates', () => {
    const result = validateCheckInDate('2025-03-14');
    expect(result.suggestedDate).toBe('2025-03-16');
  });

  it('suggests tomorrow for today', () => {
    const result = validateCheckInDate('2025-03-15');
    expect(result.suggestedDate).toBe('2025-03-16');
  });
});

describe('Booking Date Validation: Month/Year Rollover', () => {
  it('handles February month boundary (non-leap)', () => {
    mockDate(2025, 2, 28);
    expect(isPastDate('2025-02-28')).toBe(true);
    const result = validateCheckInDate('2025-02-28');
    expect(result.suggestedDate).toBe('2025-03-01');
    restoreDate();
  });

  it('handles December/January boundary', () => {
    mockDate(2025, 12, 31);
    const result = validateCheckInDate('2025-12-31');
    expect(result.suggestedDate).toBe('2026-01-01');
    restoreDate();
  });
});

describe('Booking Date Validation: Real Scenarios', () => {
  it('rejects same-day booking', () => {
    mockDate(2025, 3, 15);
    const result = validateCheckInDate('2025-03-15');
    expect(result.valid).toBe(false);
    expect(result.suggestedDate).toBe('2025-03-16');
    restoreDate();
  });

  it('accepts two weeks ahead', () => {
    mockDate(2025, 3, 15);
    const result = validateCheckInDate('2025-03-29');
    expect(result.valid).toBe(true);
    restoreDate();
  });
});
