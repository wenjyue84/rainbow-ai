/**
 * US-027: Booking date input normalization for Malaysian date formats
 *
 * Tests all 15+ input format variants including:
 *   - Numeric: DD/MM, DD/MM/YY, DD/MM/YYYY
 *   - English month names (full + abbreviated)
 *   - Malay month abbreviations: Mac, Mei, Ogo, Okt, Dis
 *   - Relative terms: today, tomorrow, esok, lusa
 *   - Chinese relative terms: 今天, 明天, 后天
 *   - Labeled formats: Check-in: / Check-out:
 *   - Separator variants: to, hingga, dash
 *   - Error cases: past date, invalid sequence, unparseable
 */

import { describe, it, expect } from 'vitest';
import {
  parseSingleDate,
  normalizeDates,
  extractDateTokens,
  todayMYT,
} from '../lib/date-normalizer.js';

// ─── Reference date for deterministic tests ───────────────────────────────────
// Use 2026-03-17 (UTC midnight) as "today" throughout
const REF = new Date(Date.UTC(2026, 2, 17)); // 2026-03-17 (months are 0-indexed)

// ─── parseSingleDate ──────────────────────────────────────────────────────────

describe('parseSingleDate', () => {
  it('parses DD/MM (no year) — future date in current year', () => {
    const result = parseSingleDate('20/3', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-03-20');
  });

  it('parses DD/MM (no year) — advances to next year if past', () => {
    const result = parseSingleDate('15/1', REF); // Jan 15 is before Mar 17
    expect(result?.toISOString().slice(0, 10)).toBe('2027-01-15');
  });

  it('parses DD/MM/YY (2-digit year)', () => {
    const result = parseSingleDate('15/3/26', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('parses DD/MM/YYYY (4-digit year)', () => {
    const result = parseSingleDate('17/03/2026', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-03-17');
  });

  it('parses DD-MM-YYYY (dash separator)', () => {
    const result = parseSingleDate('17-03-2026', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-03-17');
  });

  it('parses DD MonthName (English abbreviated)', () => {
    const result = parseSingleDate('20 Apr', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-04-20');
  });

  it('parses DD MonthName (English full)', () => {
    const result = parseSingleDate('5 February', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2027-02-05'); // Feb 5 is in the past for 2026
  });

  it('parses MonthName DD format', () => {
    const result = parseSingleDate('Apr 20', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-04-20');
  });

  // ─── Malay month abbreviations ───────────────────────────────────────────

  it('parses Malay month Mac (= March)', () => {
    const result = parseSingleDate('20 Mac', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-03-20');
  });

  it('parses Malay month Mei (= May)', () => {
    const result = parseSingleDate('5 Mei', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-05-05');
  });

  it('parses Malay month Ogo (= August)', () => {
    const result = parseSingleDate('1 Ogo', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('parses Malay month Okt (= October)', () => {
    const result = parseSingleDate('10 Okt', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-10-10');
  });

  it('parses Malay month Dis (= December)', () => {
    const result = parseSingleDate('25 Dis', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-12-25');
  });

  // ─── Relative terms ──────────────────────────────────────────────────────

  it('parses relative term: today', () => {
    const result = parseSingleDate('today', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-03-17');
  });

  it('parses relative term: tomorrow', () => {
    const result = parseSingleDate('tomorrow', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-03-18');
  });

  it('parses Malay relative term: esok (tomorrow)', () => {
    const result = parseSingleDate('esok', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-03-18');
  });

  it('parses Malay relative term: lusa (day after tomorrow)', () => {
    const result = parseSingleDate('lusa', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-03-19');
  });

  it('parses Chinese relative term: 今天 (today)', () => {
    const result = parseSingleDate('\u4eca\u5929', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-03-17');
  });

  it('parses Chinese relative term: 明天 (tomorrow)', () => {
    const result = parseSingleDate('\u660e\u5929', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-03-18');
  });

  it('parses Chinese relative term: 后天 (simplified — day after tomorrow)', () => {
    const result = parseSingleDate('\u540e\u5929', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-03-19');
  });

  it('parses Chinese relative term: 後天 (traditional — day after tomorrow)', () => {
    const result = parseSingleDate('\u5f8c\u5929', REF);
    expect(result?.toISOString().slice(0, 10)).toBe('2026-03-19');
  });

  it('returns null for unrecognized token', () => {
    expect(parseSingleDate('next monday', REF)).toBeNull();
    expect(parseSingleDate('xyz', REF)).toBeNull();
  });
});

// ─── extractDateTokens ────────────────────────────────────────────────────────

describe('extractDateTokens', () => {
  it('splits on "to" keyword', () => {
    expect(extractDateTokens('15 Mac to 17 Mac')).toEqual(['15 Mac', '17 Mac']);
  });

  it('splits on "hingga" (Malay)', () => {
    expect(extractDateTokens('15 Mac hingga 17 Mac')).toEqual(['15 Mac', '17 Mac']);
  });

  it('splits on space-dash-space', () => {
    expect(extractDateTokens('15/3 - 17/3')).toEqual(['15/3', '17/3']);
  });

  it('splits on Check-in / Check-out labels', () => {
    const tokens = extractDateTokens('Check-in: 15 Feb, Check-out: 17 Feb');
    expect(tokens).toEqual(['15 Feb', '17 Feb']);
  });

  it('splits on comma (no labels)', () => {
    expect(extractDateTokens('15/3, 17/3')).toEqual(['15/3', '17/3']);
  });

  it('returns null for single date with no separator', () => {
    expect(extractDateTokens('15 Mac')).toBeNull();
  });
});

// ─── normalizeDates ───────────────────────────────────────────────────────────

describe('normalizeDates — success cases', () => {
  it('normalizes DD/MM to DD/MM format', () => {
    const r = normalizeDates('20/3 to 22/3', REF);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.checkIn).toBe('2026-03-20');
      expect(r.checkOut).toBe('2026-03-22');
    }
  });

  it('normalizes DD/MM/YY format', () => {
    const r = normalizeDates('20/3/26 to 22/3/26', REF);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.checkIn).toBe('2026-03-20');
      expect(r.checkOut).toBe('2026-03-22');
    }
  });

  it('normalizes DD/MM/YYYY format', () => {
    const r = normalizeDates('20/03/2026 to 22/03/2026', REF);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.checkIn).toBe('2026-03-20');
      expect(r.checkOut).toBe('2026-03-22');
    }
  });

  it('normalizes English month name', () => {
    const r = normalizeDates('20 Apr to 22 Apr', REF);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.checkIn).toBe('2026-04-20');
      expect(r.checkOut).toBe('2026-04-22');
    }
  });

  it('normalizes Malay month Mac (March)', () => {
    const r = normalizeDates('20 Mac to 22 Mac', REF);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.checkIn).toBe('2026-03-20');
      expect(r.checkOut).toBe('2026-03-22');
    }
  });

  it('normalizes Malay month Ogo (August)', () => {
    const r = normalizeDates('1 Ogo to 3 Ogo', REF);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.checkIn).toBe('2026-08-01');
      expect(r.checkOut).toBe('2026-08-03');
    }
  });

  it('normalizes Malay month Dis (December)', () => {
    const r = normalizeDates('20 Dis to 22 Dis', REF);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.checkIn).toBe('2026-12-20');
      expect(r.checkOut).toBe('2026-12-22');
    }
  });

  it('normalizes relative terms esok/lusa', () => {
    const r = normalizeDates('esok to lusa', REF);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.checkIn).toBe('2026-03-18');
      expect(r.checkOut).toBe('2026-03-19');
    }
  });

  it('normalizes Chinese relative terms 明天/后天', () => {
    const r = normalizeDates('\u660e\u5929 to \u540e\u5929', REF);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.checkIn).toBe('2026-03-18');
      expect(r.checkOut).toBe('2026-03-19');
    }
  });

  it('normalizes labeled Check-in / Check-out format', () => {
    const r = normalizeDates('Check-in: 15 Feb, Check-out: 17 Feb', REF);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.checkIn).toBe('2027-02-15'); // Feb 15 advances to 2027 since it's before REF
      expect(r.checkOut).toBe('2027-02-17');
    }
  });

  it('normalizes labeled format with Malay months', () => {
    const r = normalizeDates('Check-in: 20 Mac, Check-out: 22 Mac', REF);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.checkIn).toBe('2026-03-20');
      expect(r.checkOut).toBe('2026-03-22');
    }
  });

  it('normalizes dash-separated format', () => {
    const r = normalizeDates('20/4 - 22/4', REF);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.checkIn).toBe('2026-04-20');
      expect(r.checkOut).toBe('2026-04-22');
    }
  });

  it('preserves rawInput in result', () => {
    const input = '20 Mac to 22 Mac';
    const r = normalizeDates(input, REF);
    expect(r.rawInput).toBe(input);
  });
});

describe('normalizeDates — error cases', () => {
  it('returns past_date error for check-in in the past', () => {
    const r = normalizeDates('15/1 to 17/1', new Date(Date.UTC(2026, 2, 17))); // Jan 15 < Mar 17
    // Jan 15 with no year: since it's before 2026-03-17, it advances to 2027-01-15
    // So this should actually succeed — test with explicit past year
    const rPast = normalizeDates('15/1/2026 to 17/1/2026', REF);
    expect(rPast.ok).toBe(false);
    if (!rPast.ok) {
      expect(rPast.error).toBe('past_date');
    }
  });

  it('returns invalid_sequence error when checkout <= checkin', () => {
    const r = normalizeDates('22/4 to 20/4', REF);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('invalid_sequence');
      expect(r.message).toContain('Check-out');
    }
  });

  it('returns invalid_sequence error for same-day dates', () => {
    const r = normalizeDates('20/4 to 20/4', REF);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('invalid_sequence');
    }
  });

  it('returns unparseable for random text', () => {
    const r = normalizeDates('next monday or so', REF);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('unparseable');
    }
  });

  it('returns unparseable when no separator is found', () => {
    const r = normalizeDates('20 Mac', REF);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('unparseable');
    }
  });
});

// ─── todayMYT ─────────────────────────────────────────────────────────────────

describe('todayMYT', () => {
  it('returns UTC midnight for today in MYT timezone', () => {
    // At UTC 16:00 on 2026-03-17, MYT = 00:00 on 2026-03-18
    const utc16 = new Date(Date.UTC(2026, 2, 17, 16, 0, 0));
    const myt = todayMYT(utc16);
    expect(myt.toISOString().slice(0, 10)).toBe('2026-03-18');
  });

  it('returns same UTC day when UTC time is before MYT midnight crossover', () => {
    // At UTC 08:00 on 2026-03-17, MYT = 16:00 on 2026-03-17
    const utc8 = new Date(Date.UTC(2026, 2, 17, 8, 0, 0));
    const myt = todayMYT(utc8);
    expect(myt.toISOString().slice(0, 10)).toBe('2026-03-17');
  });
});
