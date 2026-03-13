/**
 * Unit tests for PII redaction (US-421).
 *
 * Tests 10+ sample messages with PII and asserts correct redaction.
 * Also asserts that safe messages are not altered.
 */
import { describe, test, expect } from 'vitest';
import { redactPii } from '../pii-redactor.js';

describe('redactPii', () => {
  // ─── Credit Card Numbers ──────────────────────────────────────────

  test('redacts a Luhn-valid 16-digit credit card (no separators)', () => {
    // 4532015112830366 — valid Luhn
    const result = redactPii('My card is 4532015112830366, please charge it');
    expect(result.redacted).toContain('[CREDIT_CARD_REDACTED]');
    expect(result.redacted).not.toContain('4532015112830366');
    expect(result.hadPii).toBe(true);
    expect(result.types).toContain('CREDIT_CARD');
  });

  test('redacts a credit card with dashes', () => {
    const result = redactPii('Card: 4532-0151-1283-0366');
    expect(result.redacted).toContain('[CREDIT_CARD_REDACTED]');
    expect(result.hadPii).toBe(true);
  });

  test('redacts a credit card with spaces', () => {
    const result = redactPii('Card number 4532 0151 1283 0366 for the booking');
    expect(result.redacted).toContain('[CREDIT_CARD_REDACTED]');
    expect(result.hadPii).toBe(true);
  });

  test('does NOT redact a 16-digit sequence that fails Luhn', () => {
    // 1234567890123456 — fails Luhn
    const result = redactPii('test 1234567890123456 here');
    // Will be caught by BANK_ACCOUNT pattern instead (16 digits)
    // The important thing is CC label is not applied for Luhn-invalid numbers
    expect(result.types).not.toContain('CREDIT_CARD');
  });

  // ─── Malaysian IC Numbers ────────────────────────────────────────

  test('redacts a Malaysian IC with dashes', () => {
    const result = redactPii('My IC is 900101-14-5678');
    expect(result.redacted).toContain('[MY_IC_REDACTED]');
    expect(result.redacted).not.toContain('900101-14-5678');
    expect(result.hadPii).toBe(true);
    expect(result.types).toContain('MY_IC');
  });

  test('redacts a Malaysian IC without dashes', () => {
    const result = redactPii('IC number: 900101145678 for verification');
    expect(result.redacted).toContain('[MY_IC_REDACTED]');
    expect(result.hadPii).toBe(true);
  });

  test('redacts IC in a natural sentence', () => {
    const result = redactPii('Please verify guest IC: 850615-10-1234 for check-in');
    expect(result.redacted).toContain('[MY_IC_REDACTED]');
    expect(result.redacted).not.toContain('850615-10-1234');
  });

  // ─── Passport Numbers ────────────────────────────────────────────

  test('redacts a standard passport number (A12345678)', () => {
    const result = redactPii('Passport: A12345678');
    expect(result.redacted).toContain('[PASSPORT_REDACTED]');
    expect(result.hadPii).toBe(true);
    expect(result.types).toContain('PASSPORT');
  });

  test('redacts a two-letter prefix passport number', () => {
    const result = redactPii('Guest passport number is AB1234567');
    expect(result.redacted).toContain('[PASSPORT_REDACTED]');
    expect(result.hadPii).toBe(true);
  });

  // ─── Bank Account Numbers ────────────────────────────────────────

  test('redacts a 15-digit bank account number', () => {
    // 15 digits — cannot match the IC pattern (6+2+4=12), so captured as BANK_ACCOUNT
    const result = redactPii('Bank account: 164890234567890 for refund');
    expect(result.redacted).toContain('[BANK_ACCOUNT_REDACTED]');
    expect(result.hadPii).toBe(true);
    expect(result.types).toContain('BANK_ACCOUNT');
  });

  // ─── Email Addresses ─────────────────────────────────────────────

  test('redacts an email address', () => {
    const result = redactPii('Contact me at guest123@gmail.com for receipt');
    expect(result.redacted).toContain('[EMAIL_REDACTED]');
    expect(result.redacted).not.toContain('guest123@gmail.com');
    expect(result.hadPii).toBe(true);
    expect(result.types).toContain('EMAIL');
  });

  // ─── Multiple PII in one message ─────────────────────────────────

  test('redacts multiple PII types in one message', () => {
    const msg = 'IC: 900101-14-5678, email: test@example.com, passport A12345678';
    const result = redactPii(msg);
    expect(result.types.length).toBeGreaterThanOrEqual(2);
    expect(result.redacted).not.toContain('900101-14-5678');
    expect(result.redacted).not.toContain('test@example.com');
    expect(result.hadPii).toBe(true);
  });

  // ─── Safe messages pass through unchanged ────────────────────────

  test('does not alter a safe message with no PII', () => {
    const safe = 'Hi, I would like to book a bed for 2 nights. What is the price?';
    const result = redactPii(safe);
    expect(result.redacted).toBe(safe);
    expect(result.hadPii).toBe(false);
    expect(result.types).toHaveLength(0);
  });

  test('does not redact short numeric references (room numbers, prices)', () => {
    const result = redactPii('Room 101 costs RM 85 per night');
    expect(result.hadPii).toBe(false);
    expect(result.redacted).toBe('Room 101 costs RM 85 per night');
  });

  test('returns original text when no PII found', () => {
    const msg = 'What time is check-in?';
    const result = redactPii(msg);
    expect(result.redacted).toBe(msg);
  });
});
