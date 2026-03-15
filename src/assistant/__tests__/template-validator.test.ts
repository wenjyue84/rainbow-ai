/**
 * Template Category Auto-Validator Tests (US-906)
 *
 * Tests validateTemplate() for promotional keyword detection,
 * variable-at-boundary detection, and duplicate-body detection.
 */
import { describe, it, expect } from 'vitest';
import { validateTemplate, DEFAULT_PROMO_KEYWORDS } from '../../lib/template-validator.js';

// ─── Promotional keyword detection ───────────────────────────────────────────

describe('validateTemplate — promotional keywords', () => {
  it('flags a template with "discount"', () => {
    const warnings = validateTemplate('Get a 20% discount on your next stay!', []);
    const codes = warnings.map(w => w.code);
    expect(codes).toContain('PROMOTIONAL_KEYWORD');
  });

  it('flags a template with "buy now"', () => {
    const warnings = validateTemplate('Buy now and save!', []);
    expect(warnings.some(w => w.code === 'PROMOTIONAL_KEYWORD')).toBe(true);
  });

  it('flags multiple promotional keywords', () => {
    const warnings = validateTemplate('Limited time offer: buy now and get a discount!', []);
    const promo = warnings.find(w => w.code === 'PROMOTIONAL_KEYWORD');
    expect(promo).toBeDefined();
    // Message should mention multiple keywords
    expect(promo!.message).toContain('"offer"');
    expect(promo!.message).toContain('"buy now"');
  });

  it('does NOT flag a clean utility template', () => {
    const warnings = validateTemplate('Your booking at Pelangi is confirmed for {{1}}. Check-in: {{2}}.', []);
    expect(warnings.filter(w => w.code === 'PROMOTIONAL_KEYWORD')).toHaveLength(0);
  });

  it('is case-insensitive (DISCOUNT, Offer)', () => {
    const warnings = validateTemplate('DISCOUNT is available. See our Offer.', []);
    expect(warnings.some(w => w.code === 'PROMOTIONAL_KEYWORD')).toBe(true);
  });
});

// ─── Variable-at-boundary detection ──────────────────────────────────────────

describe('validateTemplate — variable at boundary', () => {
  it('flags template starting with {{variable}}', () => {
    const warnings = validateTemplate('{{1}} is your OTP code. Do not share it.', []);
    expect(warnings.some(w => w.code === 'STARTS_WITH_VARIABLE')).toBe(true);
  });

  it('flags template ending with {{variable}}', () => {
    const warnings = validateTemplate('Your room number is {{1}}', []);
    expect(warnings.some(w => w.code === 'ENDS_WITH_VARIABLE')).toBe(true);
  });

  it('does NOT flag variable in the middle of body', () => {
    const warnings = validateTemplate('Hello {{1}}, your booking is confirmed.', []);
    expect(warnings.some(w => w.code === 'STARTS_WITH_VARIABLE')).toBe(false);
    expect(warnings.some(w => w.code === 'ENDS_WITH_VARIABLE')).toBe(false);
  });
});

// ─── Duplicate body detection ─────────────────────────────────────────────────

describe('validateTemplate — duplicate body', () => {
  it('flags when body matches an existing template exactly', () => {
    const existingBody = 'Your booking is confirmed. Thank you!';
    const warnings = validateTemplate(existingBody, [existingBody]);
    expect(warnings.some(w => w.code === 'DUPLICATE_BODY')).toBe(true);
    expect(warnings.find(w => w.code === 'DUPLICATE_BODY')!.severity).toBe('error');
  });

  it('flags duplicate body with extra whitespace normalised', () => {
    const warnings = validateTemplate(
      'Your  booking  is  confirmed.',
      ['Your booking is confirmed.'],
    );
    expect(warnings.some(w => w.code === 'DUPLICATE_BODY')).toBe(true);
  });

  it('does NOT flag unique body', () => {
    const warnings = validateTemplate(
      'Your booking at Pelangi is confirmed.',
      ['Your booking at Southern is confirmed.'],
    );
    expect(warnings.some(w => w.code === 'DUPLICATE_BODY')).toBe(false);
  });
});

// ─── Combined: known-bad template (acceptance criteria check) ─────────────────

describe('validateTemplate — known-bad template (acceptance criteria)', () => {
  it('returns ≥2 warnings for a template starting with a variable AND containing a promotional keyword', () => {
    // Starts with variable, contains "discount" (promotional keyword)
    const knownBadBody = '{{1}}, get a 50% discount on your next booking! Buy now!';
    const warnings = validateTemplate(knownBadBody, []);

    expect(warnings.length).toBeGreaterThanOrEqual(2);
    expect(warnings.some(w => w.code === 'STARTS_WITH_VARIABLE')).toBe(true);
    expect(warnings.some(w => w.code === 'PROMOTIONAL_KEYWORD')).toBe(true);
  });
});

// ─── Edge cases ────────────────────────────────────────────────────────────────

describe('validateTemplate — edge cases', () => {
  it('returns empty array for empty body', () => {
    const warnings = validateTemplate('', []);
    expect(warnings).toHaveLength(0);
  });

  it('accepts custom promoKeywords override', () => {
    const warnings = validateTemplate('Hello guest, enjoy your stay!', [], ['enjoy']);
    expect(warnings.some(w => w.code === 'PROMOTIONAL_KEYWORD')).toBe(true);
  });

  it('returns empty array when promoKeywords is empty list', () => {
    const warnings = validateTemplate('Big discount sale offer!', [], []);
    expect(warnings.some(w => w.code === 'PROMOTIONAL_KEYWORD')).toBe(false);
  });
});
