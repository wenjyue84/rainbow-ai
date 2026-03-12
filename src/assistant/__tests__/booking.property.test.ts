/**
 * Property-Based Tests for Booking System
 *
 * Formal verification of date parsing, guest count validation,
 * cancel detection, and booking stage transition invariants.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseDate, parseGuestCount, isCancelMessage, parseCheckInOut, toLocalDateStr } from '../booking.js';

describe('Booking — Property-Based Tests', () => {

  // P5: Date Parser Properties
  describe('P5: parseDate invariants', () => {
    it('should return null for random non-date strings', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[abxz!@#]{0,20}$/),
          (input) => {
            const result = parseDate(input);
            // Random gibberish should not parse as valid dates
            return result === null;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should parse valid ISO dates (YYYY-MM-DD)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2025, max: 2030 }),
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 28 }), // Use 28 to avoid month-length issues
          (year, month, day) => {
            const input = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const result = parseDate(input);
            return result !== null && result.includes(`${year}`);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should parse valid DD/MM/YYYY dates', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2025, max: 2030 }),
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 28 }),
          (year, month, day) => {
            const input = `${day}/${month}/${year}`;
            const result = parseDate(input);
            return result !== null;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('parsed dates should always be in YYYY-MM-DD format', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2025, max: 2030 }),
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 28 }),
          (year, month, day) => {
            const input = `${year}-${month}-${day}`;
            const result = parseDate(input);
            if (result === null) return true; // Skip if can't parse
            return /^\d{4}-\d{2}-\d{2}$/.test(result);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('toLocalDateStr output should always match YYYY-MM-DD', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2025, max: 2030 }),
          fc.integer({ min: 0, max: 11 }),
          fc.integer({ min: 1, max: 28 }),
          (year, month, day) => {
            const d = new Date(year, month, day);
            const result = toLocalDateStr(d);
            return /^\d{4}-\d{2}-\d{2}$/.test(result);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // P6: Guest Count Properties
  describe('P6: parseGuestCount invariants', () => {
    it('should accept integers 1-20', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          (n) => {
            const result = parseGuestCount(String(n));
            return result === n;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject 0 and numbers > 20', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(0),
            fc.integer({ min: 21, max: 1000 })
          ),
          (n) => {
            const result = parseGuestCount(String(n));
            return result === null;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should extract number from mixed text', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          fc.stringMatching(/^[abc ]{0,10}$/),
          (n, prefix) => {
            const result = parseGuestCount(`${prefix}${n} guests`);
            // The first number found should be extracted
            return result !== null;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return null for strings with no numbers', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[abcde !?]{0,20}$/),
          (input) => {
            return parseGuestCount(input) === null;
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // P7: Cancel Detection Properties
  describe('P7: isCancelMessage invariants', () => {
    it('should detect all cancel keywords regardless of case', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('cancel', 'batal', 'stop', 'nevermind', 'tak jadi', 'tak nak'),
          fc.boolean(), // uppercase or not
          (keyword, toUpper) => {
            const input = toUpper ? keyword.toUpperCase() : keyword;
            return isCancelMessage(input) === true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect Chinese cancel character', () => {
      expect(isCancelMessage('\u53D6\u6D88')).toBe(true);
      expect(isCancelMessage('\u6211\u60F3\u53D6\u6D88')).toBe(true);
    });

    it('should not flag normal booking messages as cancellation', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'I want to book', 'how much', 'price please',
            '3 guests', 'tomorrow', 'yes', 'March 15',
            'berapa harga', 'saya nak tempah'
          ),
          (input) => {
            return isCancelMessage(input) === false;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // P8: parseCheckInOut Properties
  describe('P8: parseCheckInOut invariants', () => {
    it('single date should set checkIn, checkOut null', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2025, max: 2030 }),
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 28 }),
          (year, month, day) => {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const result = parseCheckInOut(dateStr);
            return result.checkIn !== null && result.checkOut === null;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('two dates with separator should parse both', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('to', 'until', 'til', 'sampai'),
          (separator) => {
            const result = parseCheckInOut(`2026-03-15 ${separator} 2026-03-18`);
            return result.checkIn !== null && result.checkOut !== null;
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
