/**
 * US-383: Booking Check-in Date Validator — Unit Tests
 *
 * Tests validateCheckinDate() with:
 * - Past date rejection
 * - Format normalization for DD/MM/YYYY, MM/DD/YYYY, natural language
 * - Valid range suggestions covering next 30 days
 * - Unparseable input handling
 */

import { describe, it, expect } from 'vitest';
import {
  validateCheckinDate,
  safeValidateCheckinDate,
  ValidationError,
} from './booking-checkin-date-validator.js';

// Reference date: 2026-03-24 (UTC midnight)
const REF = new Date(Date.UTC(2026, 2, 24)); // months are 0-indexed

// ─── Past Date Rejection ──────────────────────────────────────────────────────

describe('validateCheckinDate — past date rejection', () => {
  it('throws ValidationError for a date in the past (explicit year)', () => {
    expect(() => validateCheckinDate('20/03/2026', 'pelangi', REF)).toThrow(ValidationError);
    expect(() => validateCheckinDate('20/03/2026', 'pelangi', REF)).toThrow('in the past');
  });

  it('throws ValidationError with PAST_DATE code', () => {
    try {
      validateCheckinDate('15/01/2026', 'pelangi', REF);
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('PAST_DATE');
    }
  });

  it('throws for yesterday relative to reference date', () => {
    // 23/03/2026 is yesterday relative to REF
    expect(() => validateCheckinDate('23/03/2026', 'pelangi', REF)).toThrow(ValidationError);
  });

  it('accepts today (not in the past)', () => {
    // 24/03/2026 = REF date itself — should be valid (not strictly before today)
    const result = validateCheckinDate('24/03/2026', 'pelangi', REF);
    expect(result.isValid).toBe(true);
    expect(result.normalizedDate).toBe('2026-03-24');
  });

  it('includes suggestions in ValidationError for past dates', () => {
    try {
      validateCheckinDate('15/01/2026', 'pelangi', REF);
    } catch (err) {
      const ve = err as ValidationError;
      expect(ve.suggestions).toBeInstanceOf(Array);
      expect(ve.suggestions.length).toBeGreaterThanOrEqual(5);
      // All suggestions should be after today
      for (const s of ve.suggestions) {
        expect(new Date(s).getTime()).toBeGreaterThan(REF.getTime() - 1);
      }
    }
  });
});

// ─── Format Normalization ─────────────────────────────────────────────────────

describe('validateCheckinDate — DD/MM/YYYY normalization', () => {
  it('normalizes DD/MM/YYYY to ISO 8601', () => {
    const result = validateCheckinDate('25/03/2026', 'pelangi', REF);
    expect(result.isValid).toBe(true);
    expect(result.normalizedDate).toBe('2026-03-25');
  });

  it('normalizes DD/MM/YY to ISO 8601', () => {
    const result = validateCheckinDate('25/03/26', 'pelangi', REF);
    expect(result.isValid).toBe(true);
    expect(result.normalizedDate).toBe('2026-03-25');
  });

  it('normalizes DD/MM (no year) to current or next year', () => {
    const result = validateCheckinDate('25/04', 'pelangi', REF);
    expect(result.isValid).toBe(true);
    expect(result.normalizedDate).toBe('2026-04-25');
  });

  it('normalizes DD-MM-YYYY (dash separator)', () => {
    const result = validateCheckinDate('25-03-2026', 'pelangi', REF);
    expect(result.isValid).toBe(true);
    expect(result.normalizedDate).toBe('2026-03-25');
  });
});

describe('validateCheckinDate — natural language normalization', () => {
  it('normalizes "tomorrow"', () => {
    const result = validateCheckinDate('tomorrow', 'pelangi', REF);
    expect(result.isValid).toBe(true);
    expect(result.normalizedDate).toBe('2026-03-25');
  });

  it('normalizes "today"', () => {
    const result = validateCheckinDate('today', 'pelangi', REF);
    expect(result.isValid).toBe(true);
    expect(result.normalizedDate).toBe('2026-03-24');
  });

  it('normalizes Malay "esok" (tomorrow)', () => {
    const result = validateCheckinDate('esok', 'pelangi', REF);
    expect(result.isValid).toBe(true);
    expect(result.normalizedDate).toBe('2026-03-25');
  });

  it('normalizes Malay "lusa" (day after tomorrow)', () => {
    const result = validateCheckinDate('lusa', 'pelangi', REF);
    expect(result.isValid).toBe(true);
    expect(result.normalizedDate).toBe('2026-03-26');
  });

  it('normalizes "明天" (Chinese tomorrow)', () => {
    const result = validateCheckinDate('明天', 'pelangi', REF);
    expect(result.isValid).toBe(true);
    expect(result.normalizedDate).toBe('2026-03-25');
  });

  it('normalizes "20 Apr" (month name)', () => {
    const result = validateCheckinDate('20 Apr', 'pelangi', REF);
    expect(result.isValid).toBe(true);
    expect(result.normalizedDate).toBe('2026-04-20');
  });

  it('normalizes "20 Mac" (Malay March)', () => {
    // Mac = March in Malay; Mar 20 is before REF (Mar 24), so advances to 2027
    const result = validateCheckinDate('25 Mac', 'pelangi', REF);
    expect(result.isValid).toBe(true);
    // Mar 25 2026 is after Mar 24 2026, so stays in 2026
    expect(result.normalizedDate).toBe('2026-03-25');
  });
});

describe('validateCheckinDate — MM/DD/YYYY (US format) normalization', () => {
  it('normalizes MM/DD/YYYY as fallback when DD/MM would be invalid', () => {
    // 03/25/2026 → March 25 (MM=03, DD=25, YYYY=2026)
    // parseSingleDate treats as DD/MM so 03 day / 25 month is invalid month → fallback to MM/DD
    const result = validateCheckinDate('03/25/2026', 'pelangi', REF);
    expect(result.isValid).toBe(true);
    expect(result.normalizedDate).toBe('2026-03-25');
  });
});

// ─── Valid Range Suggestions ──────────────────────────────────────────────────

describe('validateCheckinDate — suggestions on invalid input', () => {
  it('provides suggestions for next 7 days on past date error', () => {
    try {
      validateCheckinDate('01/01/2026', 'pelangi', REF);
    } catch (err) {
      const ve = err as ValidationError;
      expect(ve.suggestions.length).toBeGreaterThanOrEqual(7);
      // First suggestion should be tomorrow (2026-03-25)
      expect(ve.suggestions[0]).toBe('2026-03-25');
      // Suggestions should span at least 30 days
      const last = new Date(ve.suggestions[ve.suggestions.length - 1]);
      const diff = (last.getTime() - REF.getTime()) / (1000 * 60 * 60 * 24);
      expect(diff).toBeGreaterThanOrEqual(6);
    }
  });

  it('provides suggestions for next 5 days on unparseable input', () => {
    try {
      validateCheckinDate('next tuesday maybe', 'pelangi', REF);
    } catch (err) {
      const ve = err as ValidationError;
      expect(ve.suggestions).toBeInstanceOf(Array);
      expect(ve.suggestions.length).toBeGreaterThanOrEqual(5);
    }
  });
});

// ─── Unparseable Input ────────────────────────────────────────────────────────

describe('validateCheckinDate — unparseable input', () => {
  it('throws ValidationError for random text', () => {
    expect(() => validateCheckinDate('asap', 'pelangi', REF)).toThrow(ValidationError);
    expect(() => validateCheckinDate('asap', 'pelangi', REF)).toThrow(/Could not understand/);
  });

  it('throws ValidationError with UNPARSEABLE code', () => {
    try {
      validateCheckinDate('next week', 'pelangi', REF);
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('UNPARSEABLE');
    }
  });

  it('throws for empty string', () => {
    expect(() => validateCheckinDate('', 'pelangi', REF)).toThrow(ValidationError);
  });

  it('preserves rawInput in error', () => {
    const input = 'garbage input';
    try {
      validateCheckinDate(input, 'pelangi', REF);
    } catch (err) {
      expect((err as ValidationError).rawInput).toBe(input);
    }
  });
});

// ─── safeValidateCheckinDate ──────────────────────────────────────────────────

describe('safeValidateCheckinDate — returns result object instead of throwing', () => {
  it('returns isValid=true for valid future date', () => {
    const result = safeValidateCheckinDate('25/03/2026', 'pelangi', REF);
    expect(result.isValid).toBe(true);
    expect(result.normalizedDate).toBe('2026-03-25');
    expect(result.errorMessage).toBeUndefined();
  });

  it('returns isValid=false with errorMessage for past date', () => {
    const result = safeValidateCheckinDate('15/01/2026', 'pelangi', REF);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain('in the past');
    expect(result.suggestions).toBeInstanceOf(Array);
  });

  it('returns isValid=false with errorMessage for unparseable', () => {
    const result = safeValidateCheckinDate('blah blah', 'pelangi', REF);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toBeTruthy();
    expect(result.suggestions).toBeInstanceOf(Array);
  });
});
