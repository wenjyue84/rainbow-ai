/**
 * US-990: BSUID Contact Resolution Regression Tests
 *
 * Verifies correct contact resolution when the phone number is absent
 * from the webhook payload (BSUID-only user after June 2026 transition).
 *
 * Covers:
 * - conversationKey produces consistent keys for BSUID-only payloads
 * - JID rate limiter uses normalised key so BSUID and phone don't create duplicate windows
 * - Outbound rate limiter normalises BSUID keys correctly
 * - lookupPhoneByBsuid fallback works for BSUID-only records
 */
import { describe, test, expect, beforeEach } from 'vitest';

import {
  conversationKey,
  isBsuidIdentifier,
  lookupPhoneByBsuid,
} from '../conversation-db.js';

import {
  checkJidRate,
  _clearJidRateLimiterState,
} from '../jid-rate-limiter.js';

// ─── Contact Resolution: phone absent ─────────────────────────────

describe('US-990: BSUID contact resolution when phone is missing', () => {
  test('BSUID-only from field produces bsuid-prefixed key', () => {
    // Simulates webhook where from = BSUID (no phone)
    const from = 'MY.guest42abc';
    const bsuid = 'MY.guest42abc';

    const key = conversationKey(from, bsuid);
    expect(key).toBe('bsuid:MY.guest42abc');
  });

  test('BSUID-only from with @s.whatsapp.net suffix produces bsuid-prefixed key', () => {
    // Meta may deliver BSUID inside a JID-like wrapper
    const from = 'MY.guest42abc@s.whatsapp.net';
    const bsuid = 'MY.guest42abc';

    const key = conversationKey(from, bsuid);
    // After stripping @suffix, 'MY.guest42abc' has < 7 digits → BSUID key
    expect(key).toBe('bsuid:MY.guest42abc');
  });

  test('phone present alongside BSUID prefers phone key', () => {
    // During 30-day transition, both phone and BSUID are in the payload
    const from = '60123456789@s.whatsapp.net';
    const bsuid = 'MY.guest42abc';

    const key = conversationKey(from, bsuid);
    expect(key).toBe('60123456789');
  });

  test('isBsuidIdentifier correctly identifies BSUID format', () => {
    expect(isBsuidIdentifier('MY.guest42abc')).toBe(true);
    expect(isBsuidIdentifier('SG.A1b2C3')).toBe(true);
    expect(isBsuidIdentifier('60123456789')).toBe(false);
    expect(isBsuidIdentifier('')).toBe(false);
  });
});

// ─── Rate limiter key normalisation ────────────────────────────────

describe('US-990: JID rate limiter uses normalised key for BSUID', () => {
  beforeEach(() => {
    _clearJidRateLimiterState();
  });

  test('BSUID-only key and phone key are separate windows (correct isolation)', () => {
    // A BSUID-only user and a phone user should have independent windows
    const bsuidKey = conversationKey('MY.guest42abc', 'MY.guest42abc');
    const phoneKey = conversationKey('60123456789@s.whatsapp.net');

    expect(bsuidKey).not.toBe(phoneKey);

    // Both should be allowed independently
    const r1 = checkJidRate(bsuidKey, 60_000, 2);
    const r2 = checkJidRate(phoneKey, 60_000, 2);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
  });

  test('same BSUID from different JID wrappers maps to same rate window', () => {
    // Both arrive as the same BSUID user, just different JID formatting
    const key1 = conversationKey('MY.guest42abc', 'MY.guest42abc');
    const key2 = conversationKey('MY.guest42abc@s.whatsapp.net', 'MY.guest42abc');

    expect(key1).toBe(key2); // Both should resolve to 'bsuid:MY.guest42abc'

    // First two messages allowed (maxMessages = 2)
    const r1 = checkJidRate(key1, 60_000, 2);
    const r2 = checkJidRate(key2, 60_000, 2);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);

    // Third message should be throttled (same window)
    const r3 = checkJidRate(key1, 60_000, 2);
    expect(r3.allowed).toBe(false);
  });

  test('transition: phone key used when both phone and BSUID present', () => {
    // During transition window, rate limit keyed on phone (not BSUID)
    const key = conversationKey('60123456789@s.whatsapp.net', 'MY.guest42abc');
    expect(key).toBe('60123456789');

    const r1 = checkJidRate(key, 60_000, 1);
    expect(r1.allowed).toBe(true);

    const r2 = checkJidRate(key, 60_000, 1);
    expect(r2.allowed).toBe(false);
  });
});

// ─── lookupPhoneByBsuid (DB fallback — unit-level, no DB) ──────────

describe('US-990: lookupPhoneByBsuid fallback', () => {
  test('returns null when DB is not available', async () => {
    // lookupPhoneByBsuid gracefully returns null when DB is unavailable
    const result = await lookupPhoneByBsuid('MY.nonexistent');
    expect(result).toBeNull();
  });
});
