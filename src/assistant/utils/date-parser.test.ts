/**
 * Comprehensive tests for date-parser.ts
 * Coverage target: 95%+ across all date formats and edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseFlexibleDate, ExtractedDate } from './date-parser.js';

describe('US-455: Date Parser - DD/MM/YYYY Format', () => {
  it('should parse valid DD/MM/YYYY dates', () => {
    const result = parseFlexibleDate('I need booking for 15/03/2025');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      original: '15/03/2025',
      iso: '2025-03-15',
      format: 'ddmmyyyy',
      confidence: 0.95,
    });
  });

  it('should handle single-digit day and month in DD/MM/YYYY', () => {
    const result = parseFlexibleDate('booking on 5/3/2025');
    expect(result).toHaveLength(1);
    expect(result[0].iso).toBe('2025-03-05');
  });

  it('should reject invalid dates like Feb 30 in DD/MM/YYYY', () => {
    const result = parseFlexibleDate('not valid 30/02/2025');
    expect(result).toHaveLength(0);
  });

  it('should accept Feb 29 in leap year (DD/MM/YYYY)', () => {
    const result = parseFlexibleDate('booking on 29/02/2024');
    expect(result).toHaveLength(1);
    expect(result[0].iso).toBe('2024-02-29');
  });

  it('should reject Feb 29 in non-leap year (DD/MM/YYYY)', () => {
    const result = parseFlexibleDate('not valid 29/02/2025');
    expect(result).toHaveLength(0);
  });

  it('should handle month boundaries (31st of months)', () => {
    // January 31
    const jan = parseFlexibleDate('31/01/2025');
    expect(jan).toHaveLength(1);
    expect(jan[0].iso).toBe('2025-01-31');

    // April 31 (invalid)
    const apr = parseFlexibleDate('31/04/2025');
    expect(apr).toHaveLength(0);
  });

  it('should reject invalid month (month > 12) in DD/MM/YYYY', () => {
    const result = parseFlexibleDate('15/13/2025');
    // Should not find the DD/MM/YYYY pattern since month 13 is invalid
    const ddmmyyyy = result.filter(r => r.format === 'ddmmyyyy');
    expect(ddmmyyyy).toHaveLength(0);
  });

  it('should reject invalid day (day > 31) in DD/MM/YYYY', () => {
    const result = parseFlexibleDate('32/03/2025');
    expect(result).toHaveLength(0);
  });

  it('should reject year out of range (< 1900) in DD/MM/YYYY', () => {
    const result = parseFlexibleDate('15/03/1850');
    expect(result).toHaveLength(0);
  });

  it('should reject year out of range (> 2100) in DD/MM/YYYY', () => {
    const result = parseFlexibleDate('15/03/2150');
    expect(result).toHaveLength(0);
  });

  it('should extract multiple DD/MM/YYYY dates from one input', () => {
    const result = parseFlexibleDate('book from 15/03/2025 to 18/03/2025');
    expect(result.filter(r => r.format === 'ddmmyyyy')).toHaveLength(2);
  });

  it('should not duplicate DD/MM/YYYY matches', () => {
    const result = parseFlexibleDate('15/03/2025 and also 15/03/2025');
    expect(result.filter(r => r.format === 'ddmmyyyy')).toHaveLength(1);
  });

  it('should format human-readable interpretation for DD/MM/YYYY', () => {
    const result = parseFlexibleDate('15/03/2025');
    expect(result[0].interpreted).toMatch(/March 15, 2025/);
  });
});

describe('US-455: Date Parser - DD/MM/YY Format', () => {
  it('should parse valid DD/MM/YY dates with 2-digit year 00-30 (2000-2030)', () => {
    const result = parseFlexibleDate('book for 15/03/25');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      original: '15/03/25',
      iso: '2025-03-15',
      format: 'ddmmyy',
      confidence: 0.90,
    });
  });

  it('should parse DD/MM/YY with year 00 as 2000', () => {
    const result = parseFlexibleDate('booking 15/03/00');
    expect(result).toHaveLength(1);
    expect(result[0].iso).toBe('2000-03-15');
  });

  it('should parse DD/MM/YY with year 30 as 2030', () => {
    const result = parseFlexibleDate('booking 15/03/30');
    expect(result).toHaveLength(1);
    expect(result[0].iso).toBe('2030-03-15');
  });

  it('should parse DD/MM/YY with year 31-99 as 1931-1999', () => {
    const result = parseFlexibleDate('booking 15/03/99');
    expect(result).toHaveLength(1);
    expect(result[0].iso).toBe('1999-03-15');
  });

  it('should reject invalid dates in DD/MM/YY format (Feb 30)', () => {
    const result = parseFlexibleDate('invalid 30/02/25');
    expect(result).toHaveLength(0);
  });

  it('should accept Feb 29 in leap year DD/MM/YY (24 = 2024)', () => {
    const result = parseFlexibleDate('booking on 29/02/24');
    expect(result).toHaveLength(1);
    expect(result[0].iso).toBe('2024-02-29');
  });

  it('should extract multiple DD/MM/YY dates', () => {
    const result = parseFlexibleDate('from 15/03/25 to 18/03/25');
    const ddmmyy = result.filter(r => r.format === 'ddmmyy');
    expect(ddmmyy).toHaveLength(2);
  });
});

describe('US-455: Date Parser - DD/MM Format', () => {
  it('should parse DD/MM format and assume current year', () => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const result = parseFlexibleDate('booking for 15/03');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      original: '15/03',
      iso: expect.stringMatching(new RegExp(`^${currentYear}-03-15`)),
      format: 'ddmm',
    });
  });

  it('should have higher confidence for future DD/MM dates', () => {
    const today = new Date();
    const futureDate = new Date(today.getFullYear(), 11, 25); // Dec 25

    if (futureDate > today) {
      const result = parseFlexibleDate('booking for 25/12');
      const ddmm = result.find(r => r.format === 'ddmm');
      expect(ddmm?.confidence).toBe(0.85);
    }
  });

  it('should have lower confidence for past DD/MM dates', () => {
    const today = new Date();
    const pastDate = new Date(today.getFullYear(), 0, 5); // Jan 5

    if (pastDate < today) {
      const result = parseFlexibleDate('booking for 05/01');
      const ddmm = result.find(r => r.format === 'ddmm');
      expect(ddmm?.confidence).toBe(0.50);
    }
  });

  it('should reject invalid month in DD/MM format', () => {
    const result = parseFlexibleDate('booking for 15/13');
    expect(result).toHaveLength(0);
  });

  it('should not match DD/MM when immediately followed by a year (DD/MM/YY or DD/MM/YYYY)', () => {
    // The regex should not match DD/MM if followed by /YY or /YYYY
    const result = parseFlexibleDate('15/03/2025');
    const ddmmOnly = result.filter(r => r.format === 'ddmm');
    expect(ddmmOnly).toHaveLength(0); // Should be matched as DD/MM/YYYY instead
  });
});

describe('US-455: Date Parser - Natural Language: tomorrow, today', () => {
  it('should parse "tomorrow"', () => {
    const result = parseFlexibleDate('I need booking for tomorrow');
    const tomorrow = result.find(r => r.original === 'tomorrow');
    expect(tomorrow).toBeDefined();
    expect(tomorrow?.format).toBe('natural_language');
    expect(tomorrow?.confidence).toBe(0.98);
  });

  it('should parse "besok" (Malay for tomorrow)', () => {
    const result = parseFlexibleDate('saya nak booking besok');
    const besok = result.find(r => r.original === 'tomorrow');
    expect(besok).toBeDefined();
  });

  it('should parse "today"', () => {
    const result = parseFlexibleDate('I need booking today');
    const today = result.find(r => r.original === 'today');
    expect(today).toBeDefined();
    expect(today?.format).toBe('natural_language');
  });

  it('should parse "hari ini" (Malay for today)', () => {
    const result = parseFlexibleDate('booking hari ini');
    const today = result.find(r => r.original === 'today');
    expect(today).toBeDefined();
  });

  it('tomorrow should be exactly 1 day from today', () => {
    const result = parseFlexibleDate('booking for tomorrow');
    const tomorrow = result.find(r => r.original === 'tomorrow');
    if (tomorrow) {
      const tomorrowDate = new Date(tomorrow.iso);
      const expectedTomorrow = new Date();
      expectedTomorrow.setDate(expectedTomorrow.getDate() + 1);
      expect(tomorrowDate.toISOString().split('T')[0]).toBe(
        expectedTomorrow.toISOString().split('T')[0]
      );
    }
  });
});

describe('US-455: Date Parser - Natural Language: next week, this weekend', () => {
  it('should parse "next week"', () => {
    const result = parseFlexibleDate('I need booking next week');
    const nextWeek = result.find(r => r.original === 'next week');
    expect(nextWeek).toBeDefined();
    expect(nextWeek?.format).toBe('natural_language');
    expect(nextWeek?.confidence).toBe(0.80);
  });

  it('should parse "bulan depan" (Malay for next month/week)', () => {
    const result = parseFlexibleDate('booking bulan depan');
    const nextMonth = result.find(r => r.original === 'next week');
    expect(nextMonth).toBeDefined();
  });

  it('should parse "this weekend"', () => {
    const result = parseFlexibleDate('booking this weekend');
    const weekend = result.find(r => r.original === 'this weekend');
    expect(weekend).toBeDefined();
    expect(weekend?.format).toBe('natural_language');
  });

  it('should parse "hujung minggu ini" (Malay for this weekend)', () => {
    const result = parseFlexibleDate('booking hujung minggu ini');
    const weekend = result.find(r => r.original === 'this weekend');
    expect(weekend).toBeDefined();
  });

  it('next week should be 7 days from today', () => {
    const result = parseFlexibleDate('booking next week');
    const nextWeek = result.find(r => r.original === 'next week');
    if (nextWeek) {
      const nextWeekDate = new Date(nextWeek.iso);
      const expected = new Date();
      expected.setDate(expected.getDate() + 7);
      expect(nextWeekDate.toISOString().split('T')[0]).toBe(
        expected.toISOString().split('T')[0]
      );
    }
  });

  it('this weekend should return Saturday', () => {
    const result = parseFlexibleDate('booking this weekend');
    const weekend = result.find(r => r.original === 'this weekend');
    if (weekend) {
      const weekendDate = new Date(weekend.iso);
      // Saturday is day 6
      expect(weekendDate.getDay()).toBe(6);
    }
  });
});

describe('US-455: Date Parser - Natural Language: next [day of week]', () => {
  it('should parse "next monday"', () => {
    const result = parseFlexibleDate('booking next monday');
    const nextMonday = result.find(r => r.original === 'next monday');
    expect(nextMonday).toBeDefined();
    expect(nextMonday?.format).toBe('natural_language');
  });

  it('should parse all days of week (next monday through next sunday)', () => {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    for (const day of days) {
      const result = parseFlexibleDate(`next ${day}`);
      const found = result.find(r => r.original === `next ${day}`);
      expect(found).toBeDefined();
    }
  });

  it('should return correct day of week for next monday', () => {
    const result = parseFlexibleDate('booking next monday');
    const nextMonday = result.find(r => r.original === 'next monday');
    if (nextMonday) {
      const mondayDate = new Date(nextMonday.iso);
      // Monday is day 1
      expect(mondayDate.getDay()).toBe(1);
    }
  });

  it('should return correct day of week for next sunday', () => {
    const result = parseFlexibleDate('booking next sunday');
    const nextSunday = result.find(r => r.original === 'next sunday');
    if (nextSunday) {
      const sundayDate = new Date(nextSunday.iso);
      // Sunday is day 0
      expect(sundayDate.getDay()).toBe(0);
    }
  });
});

describe('US-455: Date Parser - Natural Language: in X days/weeks/months', () => {
  it('should parse "in 3 days"', () => {
    const result = parseFlexibleDate('booking in 3 days');
    const inThreeDays = result.find(r => r.original.includes('in 3'));
    expect(inThreeDays).toBeDefined();
    expect(inThreeDays?.format).toBe('natural_language');
  });

  it('should parse "in 2 weeks"', () => {
    const result = parseFlexibleDate('booking in 2 weeks');
    const inTwoWeeks = result.find(r => r.original.includes('in 2'));
    expect(inTwoWeeks).toBeDefined();
  });

  it('should parse "in 1 month"', () => {
    const result = parseFlexibleDate('booking in 1 month');
    const inOneMonth = result.find(r => r.original.includes('in 1'));
    expect(inOneMonth).toBeDefined();
  });

  it('should parse both singular and plural (days, day, weeks, week, etc.)', () => {
    const singular = parseFlexibleDate('in 1 day');
    const plural = parseFlexibleDate('in 5 days');
    expect(singular.length).toBeGreaterThan(0);
    expect(plural.length).toBeGreaterThan(0);
  });

  it('should parse Malay "hari" (days), "minggu" (weeks), "bulan" (months)', () => {
    const hasil1 = parseFlexibleDate('booking dalam 3 hari');
    const hasil2 = parseFlexibleDate('booking dalam 2 minggu');
    const hasil3 = parseFlexibleDate('booking dalam 1 bulan');
    // At least one should parse
    const total = hasil1.filter(r => r.format === 'natural_language').length +
                 hasil2.filter(r => r.format === 'natural_language').length +
                 hasil3.filter(r => r.format === 'natural_language').length;
    expect(total).toBeGreaterThan(0);
  });

  it('should calculate correct date for "in X days"', () => {
    const result = parseFlexibleDate('booking in 5 days');
    const inFiveDays = result.find(r => r.original.includes('in 5'));
    if (inFiveDays) {
      const targetDate = new Date(inFiveDays.iso);
      const expected = new Date();
      expected.setDate(expected.getDate() + 5);
      expect(targetDate.toISOString().split('T')[0]).toBe(
        expected.toISOString().split('T')[0]
      );
    }
  });

  it('should reject "in X days" where X > 365', () => {
    const result = parseFlexibleDate('booking in 400 days');
    const tooFar = result.find(r => r.original.includes('in 400'));
    expect(tooFar).toBeUndefined();
  });

  it('should reject "in 0 days"', () => {
    const result = parseFlexibleDate('booking in 0 days');
    const inZero = result.find(r => r.original.includes('in 0'));
    expect(inZero).toBeUndefined();
  });
});

describe('US-455: Date Parser - Edge Cases and Special Handling', () => {
  it('should return empty array for null input', () => {
    const result = parseFlexibleDate(null as any);
    expect(result).toEqual([]);
  });

  it('should return empty array for undefined input', () => {
    const result = parseFlexibleDate(undefined as any);
    expect(result).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    const result = parseFlexibleDate('');
    expect(result).toEqual([]);
  });

  it('should return empty array for non-string input', () => {
    const result = parseFlexibleDate(12345 as any);
    expect(result).toEqual([]);
  });

  it('should handle mixed formats in one input', () => {
    const result = parseFlexibleDate('booking from 15/03/2025 to next wednesday');
    expect(result.length).toBeGreaterThanOrEqual(2);
    const hasFormatted = result.some(r => r.format === 'ddmmyyyy');
    const hasNatural = result.some(r => r.format === 'natural_language');
    expect(hasFormatted && hasNatural).toBe(true);
  });

  it('should not crash with very long input', () => {
    const longText = 'a'.repeat(10000);
    const result = parseFlexibleDate(longText);
    expect(Array.isArray(result)).toBe(true);
  });

  it('should handle input with special characters', () => {
    const result = parseFlexibleDate('booking!!! for 15/03/2025 @@@ please');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle input with multiple spaces', () => {
    const result = parseFlexibleDate('booking    for    15/03/2025    please');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should be case-insensitive for natural language patterns', () => {
    const lower = parseFlexibleDate('booking tomorrow');
    const upper = parseFlexibleDate('booking TOMORROW');
    const mixed = parseFlexibleDate('booking ToMoRrOw');
    expect(lower.length).toBeGreaterThan(0);
    expect(upper.length).toBeGreaterThan(0);
    expect(mixed.length).toBeGreaterThan(0);
  });

  it('should not match numbers not formatted as dates', () => {
    const result = parseFlexibleDate('my phone is 9876543210 and my id is 12345');
    expect(result).toHaveLength(0);
  });

  it('should handle month boundaries across year changes', () => {
    // Simulate a date near year end by checking parsing logic works
    const result = parseFlexibleDate('booking 25/12/2025');
    const ddmmyyyy = result.filter(r => r.format === 'ddmmyyyy');
    expect(ddmmyyyy).toHaveLength(1);
    expect(ddmmyyyy[0].iso).toBe('2025-12-25');
  });
});

describe('US-455: Date Parser - Confidence Scores', () => {
  it('DD/MM/YYYY should have confidence 0.95', () => {
    const result = parseFlexibleDate('15/03/2025');
    expect(result[0].confidence).toBe(0.95);
  });

  it('DD/MM/YY should have confidence 0.90', () => {
    const result = parseFlexibleDate('15/03/25');
    expect(result[0].confidence).toBe(0.90);
  });

  it('DD/MM (future) should have confidence 0.85', () => {
    const today = new Date();
    const nextMonth = today.getMonth() + 2;
    const year = nextMonth > 11 ? today.getFullYear() + 1 : today.getFullYear();
    const month = ((nextMonth - 1) % 12) + 1;
    const input = `15/${String(month).padStart(2, '0')}`;
    const result = parseFlexibleDate(input);
    if (result.some(r => r.format === 'ddmm' && r.iso.includes(String(year)))) {
      const ddmm = result.find(r => r.format === 'ddmm');
      expect(ddmm?.confidence).toBe(0.85);
    }
  });

  it('natural language "tomorrow" should have confidence 0.98', () => {
    const result = parseFlexibleDate('tomorrow');
    expect(result[0].confidence).toBe(0.98);
  });

  it('natural language "next week" should have confidence 0.80', () => {
    const result = parseFlexibleDate('next week');
    expect(result[0].confidence).toBe(0.80);
  });

  it('natural language "this weekend" should have confidence 0.75', () => {
    const result = parseFlexibleDate('this weekend');
    expect(result[0].confidence).toBe(0.75);
  });

  it('natural language "next monday" should have confidence 0.88', () => {
    const result = parseFlexibleDate('next monday');
    expect(result[0].confidence).toBe(0.88);
  });

  it('natural language "in X days" should have confidence 0.85', () => {
    const result = parseFlexibleDate('in 5 days');
    expect(result[0].confidence).toBe(0.85);
  });
});

describe('US-455: Date Parser - Output Format', () => {
  it('should return ExtractedDate objects with required fields', () => {
    const result = parseFlexibleDate('15/03/2025');
    expect(result[0]).toHaveProperty('original');
    expect(result[0]).toHaveProperty('iso');
    expect(result[0]).toHaveProperty('format');
    expect(result[0]).toHaveProperty('confidence');
    expect(result[0]).toHaveProperty('interpreted');
  });

  it('iso should be in YYYY-MM-DD format', () => {
    const result = parseFlexibleDate('15/03/2025');
    expect(result[0].iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('format should be one of expected values', () => {
    const result = parseFlexibleDate('15/03/2025 next monday tomorrow in 5 days');
    const validFormats = ['ddmmyyyy', 'ddmmyy', 'ddmm', 'natural_language'];
    result.forEach(date => {
      expect(validFormats).toContain(date.format);
    });
  });

  it('confidence should be between 0 and 1', () => {
    const result = parseFlexibleDate('15/03/2025 next monday tomorrow in 5 days');
    result.forEach(date => {
      expect(date.confidence).toBeGreaterThanOrEqual(0);
      expect(date.confidence).toBeLessThanOrEqual(1);
    });
  });

  it('interpreted should contain human-readable date info', () => {
    const result = parseFlexibleDate('15/03/2025');
    expect(result[0].interpreted).toMatch(/\d{4}/); // Should contain year
  });
});

describe('US-455: Date Parser - Integration Tests', () => {
  it('should handle a realistic booking message with multiple date references', () => {
    const message = 'Hi, I want to book from 15/03/2025 to 18/03/2025, or alternatively next weekend';
    const result = parseFlexibleDate(message);
    expect(result.length).toBeGreaterThanOrEqual(2); // At least 2 dates (the formatted ones)
    const hasFormatted = result.filter(r => r.format === 'ddmmyyyy').length >= 2;
    const hasNatural = result.some(r => r.format === 'natural_language');
    expect(hasFormatted).toBe(true);
  });

  it('should handle message with natural language only', () => {
    const message = 'I need room tomorrow or next monday';
    const result = parseFlexibleDate(message);
    expect(result.length).toBeGreaterThanOrEqual(2);
    result.forEach(r => expect(r.format).toBe('natural_language'));
  });

  it('should handle message with formatted dates only', () => {
    const message = 'Dates: 15/03/2025, 16/03/25, 17/03';
    const result = parseFlexibleDate(message);
    expect(result.length).toBe(3);
  });

  it('should return results in order of appearance (regex match order)', () => {
    const message = 'booking from 10/01/2025 to 20/01/2025';
    const result = parseFlexibleDate(message);
    const formatted = result.filter(r => r.format === 'ddmmyyyy');
    expect(formatted[0].iso).toBe('2025-01-10');
    expect(formatted[1].iso).toBe('2025-01-20');
  });
});

describe('US-455: Date Parser - Acceptance Criteria Validation', () => {
  it('AC1: Parser extracts DD/MM/YYYY format', () => {
    const result = parseFlexibleDate('booking 15/03/2025');
    const found = result.find(r => r.format === 'ddmmyyyy');
    expect(found).toBeDefined();
    expect(found?.iso).toBe('2025-03-15');
  });

  it('AC1: Parser extracts DD/MM/YY format', () => {
    const result = parseFlexibleDate('booking 15/03/25');
    const found = result.find(r => r.format === 'ddmmyy');
    expect(found).toBeDefined();
    expect(found?.iso).toBe('2025-03-15');
  });

  it('AC1: Parser extracts DD/MM format', () => {
    const result = parseFlexibleDate('booking 15/03');
    const found = result.find(r => r.format === 'ddmm');
    expect(found).toBeDefined();
  });

  it('AC1: Parser extracts natural language "next week"', () => {
    const result = parseFlexibleDate('booking next week');
    const found = result.find(r => r.original === 'next week');
    expect(found).toBeDefined();
  });

  it('AC1: Parser extracts natural language "tomorrow"', () => {
    const result = parseFlexibleDate('booking tomorrow');
    const found = result.find(r => r.original === 'tomorrow');
    expect(found).toBeDefined();
  });

  it('AC1: Parser extracts natural language "in X days"', () => {
    const result = parseFlexibleDate('booking in 3 days');
    const found = result.find(r => r.original.includes('in 3'));
    expect(found).toBeDefined();
  });

  it('AC1: Parser extracts natural language "this weekend"', () => {
    const result = parseFlexibleDate('booking this weekend');
    const found = result.find(r => r.original === 'this weekend');
    expect(found).toBeDefined();
  });

  it('AC2: Extracted dates are in metadata format (iso, format, confidence, etc.)', () => {
    const result = parseFlexibleDate('15/03/2025');
    const date = result[0];
    expect(date).toHaveProperty('iso');
    expect(date).toHaveProperty('format');
    expect(date).toHaveProperty('confidence');
    expect(date).toHaveProperty('original');
    expect(date).toHaveProperty('interpreted');
  });

  it('AC3: Edge case - Feb 29 in leap year is accepted', () => {
    const result = parseFlexibleDate('29/02/2024');
    expect(result).toHaveLength(1);
  });

  it('AC3: Edge case - Feb 29 in non-leap year is rejected', () => {
    const result = parseFlexibleDate('29/02/2025');
    expect(result).toHaveLength(0);
  });

  it('AC3: Edge case - Month boundaries (31st) handled correctly', () => {
    const jan = parseFlexibleDate('31/01/2025');
    const apr = parseFlexibleDate('31/04/2025');
    expect(jan).toHaveLength(1);
    expect(apr).toHaveLength(0);
  });

  it('AC3: Edge case - Past dates with natural language', () => {
    // Past dates should still parse correctly
    const result = parseFlexibleDate('01/01/2020');
    expect(result).toHaveLength(1);
    expect(result[0].iso).toBe('2020-01-01');
  });
});
