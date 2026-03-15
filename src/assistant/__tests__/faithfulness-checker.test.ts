/**
 * Faithfulness Checker Tests (US-899)
 *
 * Validates that the lightweight faithfulness checker correctly:
 * - Flags responses that contradict KB content
 * - Accepts responses that are grounded in KB content
 * - Handles edge cases (short responses, no claims, etc.)
 */
import { describe, it, expect } from 'vitest';
import {
  checkFaithfulness,
  extractClaims,
  FAITHFULNESS_THRESHOLD,
  getFaithfulnessFallback,
} from '../faithfulness-checker.js';

describe('extractClaims', () => {
  it('extracts time expressions', () => {
    const claims = extractClaims('Check-in is at 2pm and checkout by 12pm.');
    expect(claims).toContain('2pm');
    expect(claims).toContain('12pm');
  });

  it('extracts 24h time expressions', () => {
    const claims = extractClaims('Office hours are 08:30 to 17:00.');
    expect(claims.some(c => c.includes('08:30') || c.includes('17:00'))).toBe(true);
  });

  it('extracts prices with currency', () => {
    const claims = extractClaims('The rate is RM50 per night and RM120 for a private room.');
    expect(claims.some(c => c.includes('RM50') || c.includes('RM 50'))).toBe(true);
    expect(claims.some(c => c.includes('RM120') || c.includes('RM 120'))).toBe(true);
  });

  it('extracts quantities with units', () => {
    const claims = extractClaims('We have 20 rooms and 6 beds per dorm.');
    expect(claims.some(c => c.includes('20 rooms'))).toBe(true);
    expect(claims.some(c => c.includes('6 beds'))).toBe(true);
  });

  it('extracts email addresses', () => {
    const claims = extractClaims('Contact us at info@pelangi.com for inquiries.');
    expect(claims).toContain('info@pelangi.com');
  });

  it('extracts phone numbers', () => {
    const claims = extractClaims('Call us at +60 10-308 4289.');
    expect(claims.length).toBeGreaterThan(0);
  });

  it('returns empty for greetings', () => {
    const claims = extractClaims('Hello! How can I help you today?');
    expect(claims.length).toBe(0);
  });
});

describe('checkFaithfulness', () => {
  const KB_CONTENT = `
# Pelangi Capsule Hostel

## Check-in / Check-out
- Check-in time: 2pm
- Check-out time: 12pm (noon)
- Early check-in available from 10am (subject to availability)
- Late checkout until 2pm: RM20 surcharge

## Rates
- Dorm bed: RM35 per night
- Private capsule: RM85 per night
- Family room (4 pax): RM180 per night

## Facilities
- 24-hour reception
- Free Wi-Fi
- Shared kitchen
- 20 capsule beds
- 6 private rooms

## Contact
- Phone: +60 10-308 4289
- Email: info@pelangicapsule.com
- Address: 123 Jalan Tun Razak, Johor Bahru
`;

  it('flags response with wrong check-in time (AC requirement)', () => {
    // Must have 2+ claims to trigger checking; both 3pm and 11am are wrong (KB says 2pm and 12pm)
    const response = 'Our check-in time is at 3pm and checkout is at 11am. You can arrive anytime after that!';
    const result = checkFaithfulness(response, KB_CONTENT);
    expect(result.flagged).toBe(true);
    expect(result.score).toBeLessThan(FAITHFULNESS_THRESHOLD);
    expect(result.unmatchedClaims.some(c => c.includes('3pm') || c.includes('11am'))).toBe(true);
  });

  it('accepts response with correct check-in time', () => {
    const response = 'Check-in is at 2pm and checkout is at 12pm. Welcome to Pelangi!';
    const result = checkFaithfulness(response, KB_CONTENT);
    expect(result.flagged).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(FAITHFULNESS_THRESHOLD);
  });

  it('flags response with wrong price', () => {
    const response = 'Our dorm bed costs RM50 per night and private capsule is RM100 per night.';
    const result = checkFaithfulness(response, KB_CONTENT);
    // RM50 and RM100 are not in KB (KB says RM35 and RM85)
    expect(result.unmatchedClaims.length).toBeGreaterThan(0);
    expect(result.flagged).toBe(true);
  });

  it('accepts response with correct prices', () => {
    const response = 'Our dorm bed is RM35 per night, and a private capsule is RM85 per night.';
    const result = checkFaithfulness(response, KB_CONTENT);
    expect(result.flagged).toBe(false);
  });

  it('accepts response with correct facilities', () => {
    const response = 'We have 20 capsule beds and 6 private rooms available. Free Wi-Fi is included!';
    const result = checkFaithfulness(response, KB_CONTENT);
    expect(result.flagged).toBe(false);
  });

  it('returns score 1.0 for short greeting responses', () => {
    const response = 'Hello! Welcome!';
    const result = checkFaithfulness(response, KB_CONTENT);
    expect(result.score).toBe(1.0);
    expect(result.flagged).toBe(false);
    expect(result.totalClaims).toBe(0);
  });

  it('returns score 1.0 when no KB content provided', () => {
    const response = 'Check-in is at 3pm.';
    const result = checkFaithfulness(response, '');
    expect(result.score).toBe(1.0);
    expect(result.flagged).toBe(false);
  });

  it('returns score 1.0 for responses with only 1 claim (below minimum)', () => {
    const response = 'Sure, check-in is at 3pm. Let me know if you need anything else.';
    const result = checkFaithfulness(response, KB_CONTENT);
    // Only 1 claim (3pm), below MIN_CLAIMS_FOR_CHECK = 2
    expect(result.score).toBe(1.0);
    expect(result.flagged).toBe(false);
  });

  it('handles mixed correct and incorrect claims', () => {
    const response = 'Check-in is at 2pm. The dorm costs RM45 per night. We have 20 capsule beds.';
    const result = checkFaithfulness(response, KB_CONTENT);
    // 2pm and 20 capsule beds match; RM45 does not
    expect(result.matchedClaims).toBeGreaterThanOrEqual(2);
    expect(result.unmatchedClaims.length).toBeGreaterThanOrEqual(1);
  });

  it('flags response with fabricated contact info', () => {
    const response = 'You can reach us at info@fakehotel.com or call +60 12-345 6789. Our rates start at RM35.';
    const result = checkFaithfulness(response, KB_CONTENT);
    expect(result.unmatchedClaims.some(c => c.includes('info@fakehotel.com'))).toBe(true);
  });
});

describe('getFaithfulnessFallback', () => {
  it('returns English fallback', () => {
    const msg = getFaithfulnessFallback('en');
    expect(msg).toContain('connect you with our team');
  });

  it('returns Malay fallback', () => {
    const msg = getFaithfulnessFallback('ms');
    expect(msg).toContain('pasukan kami');
  });

  it('returns Chinese fallback', () => {
    const msg = getFaithfulnessFallback('zh');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('falls back to English for unknown language', () => {
    const msg = getFaithfulnessFallback('ta');
    expect(msg.length).toBeGreaterThan(0);
  });
});
