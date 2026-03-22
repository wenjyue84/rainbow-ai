import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isDateInPast,
  getNextAvailableDate,
  getDateOneMonthLater,
  validateBookingDates,
  formatDateValidationMessage,
  type DateValidationResult
} from '../date-validation.js';

describe('Date Validation', () => {
  beforeEach(() => {
    // Mock current date to 2026-03-23 for consistent testing
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isDateInPast', () => {
    it('should return true for dates before today', () => {
      expect(isDateInPast('2026-03-22')).toBe(true);
      expect(isDateInPast('2026-03-20')).toBe(true);
      expect(isDateInPast('2026-02-01')).toBe(true);
    });

    it('should return true for today (cannot check in today)', () => {
      expect(isDateInPast('2026-03-23')).toBe(true);
    });

    it('should return false for future dates', () => {
      expect(isDateInPast('2026-03-24')).toBe(false);
      expect(isDateInPast('2026-03-25')).toBe(false);
      expect(isDateInPast('2026-04-23')).toBe(false);
    });

    it('should return false for invalid dates', () => {
      expect(isDateInPast('invalid-date')).toBe(false);
      expect(isDateInPast('2026-13-01')).toBe(false);
    });
  });

  describe('getNextAvailableDate', () => {
    it('should return tomorrow', () => {
      const next = getNextAvailableDate();
      expect(next).toBe('2026-03-24');
    });

    it('should return consistent date across calls', () => {
      const next1 = getNextAvailableDate();
      const next2 = getNextAvailableDate();
      expect(next1).toBe(next2);
    });
  });

  describe('getDateOneMonthLater', () => {
    it('should return 1 month after a given date', () => {
      expect(getDateOneMonthLater('2026-03-24')).toBe('2026-04-24');
      expect(getDateOneMonthLater('2026-02-01')).toBe('2026-03-01');
    });

    it('should handle month-end edge cases', () => {
      // Jan 31 + 1 month = Feb 28 (or 29 in leap year) → March 3 (normalized)
      expect(getDateOneMonthLater('2026-01-31')).toBe('2026-02-28');
    });

    it('should handle year rollover', () => {
      expect(getDateOneMonthLater('2026-11-15')).toBe('2026-12-15');
      expect(getDateOneMonthLater('2026-12-15')).toBe('2027-01-15');
    });

    it('should handle invalid date with fallback to 1 month from tomorrow', () => {
      const result = getDateOneMonthLater('invalid-date');
      // Fallback: tomorrow (2026-03-24) + 1 month = 2026-04-24
      expect(result).toBe('2026-04-24');
    });
  });

  describe('validateBookingDates', () => {
    describe('Valid dates (future check-in and check-out after check-in)', () => {
      it('should accept valid future check-in and check-out', () => {
        const result = validateBookingDates('2026-03-25', '2026-03-27');
        expect(result.isValid).toBe(true);
        expect(result.checkInDate).toBe('2026-03-25');
        expect(result.checkOutDate).toBe('2026-03-27');
        expect(result.suggestedCheckIn).toBeUndefined();
        expect(result.suggestedCheckOut).toBeUndefined();
      });

      it('should accept dates several months in advance', () => {
        const result = validateBookingDates('2026-06-15', '2026-06-20');
        expect(result.isValid).toBe(true);
        expect(result.checkInDate).toBe('2026-06-15');
        expect(result.checkOutDate).toBe('2026-06-20');
      });
    });

    describe('Past check-in dates (must suggest tomorrow)', () => {
      it('should reject today as check-in and suggest tomorrow', () => {
        const result = validateBookingDates('2026-03-23', '2026-03-25');
        expect(result.isValid).toBe(false);
        expect(result.suggestedCheckIn).toBe('2026-03-24');
        expect(result.checkInDate).toBe('2026-03-24'); // Adjusted
        expect(result.checkOutDate).toBe('2026-03-25'); // OK as-is
      });

      it('should reject yesterday as check-in and suggest tomorrow', () => {
        const result = validateBookingDates('2026-03-22', '2026-03-25');
        expect(result.isValid).toBe(false);
        expect(result.suggestedCheckIn).toBe('2026-03-24');
        expect(result.checkInDate).toBe('2026-03-24');
      });

      it('should reject a week-old check-in and suggest tomorrow', () => {
        const result = validateBookingDates('2026-03-16', '2026-03-25');
        expect(result.isValid).toBe(false);
        expect(result.suggestedCheckIn).toBe('2026-03-24');
        expect(result.checkInDate).toBe('2026-03-24');
      });
    });

    describe('Invalid check-out dates (must be after check-in)', () => {
      it('should reject check-out on same day as check-in', () => {
        const result = validateBookingDates('2026-03-25', '2026-03-25');
        expect(result.isValid).toBe(false);
        expect(result.suggestedCheckOut).toBe('2026-04-25');
      });

      it('should reject check-out before check-in', () => {
        const result = validateBookingDates('2026-03-25', '2026-03-24');
        expect(result.isValid).toBe(false);
        expect(result.suggestedCheckOut).toBe('2026-04-25');
      });

      it('should adjust check-out when check-in is past', () => {
        const result = validateBookingDates('2026-03-22', '2026-03-23');
        expect(result.isValid).toBe(false);
        expect(result.suggestedCheckIn).toBe('2026-03-24');
        expect(result.suggestedCheckOut).toBe('2026-04-24'); // 1 month after adjusted check-in
      });
    });

    describe('Both dates invalid', () => {
      it('should reject when both check-in is past and check-out is before check-in', () => {
        const result = validateBookingDates('2026-03-20', '2026-03-19');
        expect(result.isValid).toBe(false);
        expect(result.suggestedCheckIn).toBe('2026-03-24');
        expect(result.suggestedCheckOut).toBe('2026-04-24');
      });
    });

    describe('Invalid date formats', () => {
      it('should return invalid for malformed dates', () => {
        const result = validateBookingDates('not-a-date', '2026-03-25');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Invalid date format');
      });

      it('should return invalid for out-of-range month', () => {
        const result = validateBookingDates('2026-13-01', '2026-03-25');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Invalid date format');
      });

      it('should return invalid for invalid day', () => {
        const result = validateBookingDates('2026-02-30', '2026-03-25');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Invalid date format');
      });
    });

    describe('Month and year rollover', () => {
      it('should handle end-of-month dates correctly', () => {
        const result = validateBookingDates('2026-03-31', '2026-04-05');
        expect(result.isValid).toBe(true);
        expect(result.checkInDate).toBe('2026-03-31');
        expect(result.checkOutDate).toBe('2026-04-05');
      });

      it('should handle year boundary correctly', () => {
        const result = validateBookingDates('2026-12-25', '2027-01-05');
        expect(result.isValid).toBe(true);
        expect(result.checkInDate).toBe('2026-12-25');
        expect(result.checkOutDate).toBe('2027-01-05');
      });
    });
  });

  describe('formatDateValidationMessage', () => {
    describe('Valid dates (no message)', () => {
      it('should return empty string for valid dates', () => {
        const result = validateBookingDates('2026-03-25', '2026-03-27');
        const message = formatDateValidationMessage(result);
        expect(message).toBe('');
      });
    });

    describe('Invalid dates with suggestions (English)', () => {
      it('should format message with suggested dates in English', () => {
        const result = validateBookingDates('2026-03-22', '2026-03-25');
        const message = formatDateValidationMessage(result, 'en');
        expect(message).toContain('check-in date cannot be today or earlier');
        expect(message).toContain('2026-03-24'); // Suggested check-in
        expect(message).toContain('2026-03-25'); // Suggested check-out
        expect(message).toContain('Would these dates work for you');
      });
    });

    describe('Invalid dates with suggestions (Malay)', () => {
      it('should format message with suggested dates in Malay', () => {
        const result = validateBookingDates('2026-03-22', '2026-03-25');
        const message = formatDateValidationMessage(result, 'ms');
        expect(message).toContain('check-in');
        expect(message).toContain('2026-03-24'); // Suggested check-in
      });
    });

    describe('Invalid dates with suggestions (Mandarin)', () => {
      it('should format message with suggested dates in Mandarin', () => {
        const result = validateBookingDates('2026-03-22', '2026-03-25');
        const message = formatDateValidationMessage(result, 'zh');
        expect(message).toContain('入住'); // Check-in in Chinese
        expect(message).toContain('2026-03-24');
      });
    });

    describe('Completely invalid dates', () => {
      it('should format error message for invalid dates', () => {
        const result = validateBookingDates('not-a-date', '2026-03-25');
        const message = formatDateValidationMessage(result, 'en');
        expect(message).toContain('dates you provided are invalid');
      });
    });
  });
});
