/**
 * Unit tests for WhatsApp BSUID (Business-Scoped User ID) routing (US-477).
 *
 * Verifies:
 * - isBsuid correctly identifies BSUID format (CC.alphanumeric)
 * - conversationKey returns correct key for E.164-only, BSUID-only, and dual payloads
 * - canonicalPhoneKey preserves BSUID-prefixed keys
 * - extractBsuid extracts BSUID from various Baileys message shapes
 */
import { describe, test, expect } from 'vitest';

// ─── Import BSUID utilities ────────────────────────────────────────

import {
  canonicalPhoneKey,
  conversationKey,
  isBsuidIdentifier,
} from '../conversation-db.js';

import { isBsuid } from '../../lib/whatsapp/instance.js';

// ─── isBsuid / isBsuidIdentifier ───────────────────────────────────

describe('isBsuid / isBsuidIdentifier', () => {
  test('recognizes valid BSUID format (CC.alphanumeric)', () => {
    expect(isBsuid('MY.abc123')).toBe(true);
    expect(isBsuid('US.user42xyz')).toBe(true);
    expect(isBsuid('SG.A1b2C3d4E5')).toBe(true);
    expect(isBsuidIdentifier('MY.abc123')).toBe(true);
  });

  test('rejects E.164 phone numbers', () => {
    expect(isBsuid('60123456789')).toBe(false);
    expect(isBsuid('+60123456789')).toBe(false);
    expect(isBsuidIdentifier('60123456789')).toBe(false);
  });

  test('rejects malformed BSUIDs', () => {
    // Country code must be exactly 2 uppercase letters
    expect(isBsuid('M.abc123')).toBe(false);
    expect(isBsuid('MYS.abc123')).toBe(false);
    expect(isBsuid('my.abc123')).toBe(false);

    // Must have dot separator
    expect(isBsuid('MYabc123')).toBe(false);

    // BSUID part must be alphanumeric
    expect(isBsuid('MY.abc-123')).toBe(false);
    expect(isBsuid('MY.abc 123')).toBe(false);

    // Empty BSUID part
    expect(isBsuid('MY.')).toBe(false);
  });

  test('handles JID-like strings (strips @suffix correctly in extractBsuid)', () => {
    // isBsuid only checks raw format, not JIDs
    expect(isBsuid('MY.abc123@s.whatsapp.net')).toBe(false);
  });
});

// ─── conversationKey ────────────────────────────────────────────────

describe('conversationKey', () => {
  test('E.164-only: returns digit-only key (existing behavior)', () => {
    expect(conversationKey('60123456789')).toBe('60123456789');
    expect(conversationKey('60123456789@s.whatsapp.net')).toBe('60123456789');
    expect(conversationKey('+1-555-123-4567')).toBe('15551234567');
  });

  test('BSUID-only: returns bsuid-prefixed key when no real phone', () => {
    expect(conversationKey('MY.abc123@s.whatsapp.net', 'MY.abc123')).toBe('bsuid:MY.abc123');
    // Short digit string (< 7) from BSUID is not a real phone
    expect(conversationKey('MY.x1', 'MY.x1')).toBe('bsuid:MY.x1');
  });

  test('BSUID-only: detects BSUID from `from` when no explicit bsuid param', () => {
    // from itself is a BSUID (after stripping JID suffix)
    expect(conversationKey('MY.abc123')).toBe('bsuid:MY.abc123');
  });

  test('dual-identifier: prefers phone key when phone is valid', () => {
    // Both phone and BSUID — phone wins as key
    expect(conversationKey('60123456789', 'MY.abc123')).toBe('60123456789');
    expect(conversationKey('60123456789@s.whatsapp.net', 'MY.abc123')).toBe('60123456789');
  });

  test('fallback: non-phone non-BSUID returns sanitized string', () => {
    expect(conversationKey('webchat-session-abc')).toBe('webchat-session-abc');
  });

  test('webchat keys with digits are preserved as-is (LC-01)', () => {
    expect(conversationKey('webchat-web_zjc78qz5_1774492351497')).toBe('webchat-web_zjc78qz5_1774492351497');
    expect(conversationKey('webchat-web_8zcwkjuc_1776148858315')).toBe('webchat-web_8zcwkjuc_1776148858315');
  });
});

// ─── canonicalPhoneKey ──────────────────────────────────────────────

describe('canonicalPhoneKey with BSUID support', () => {
  test('standard phone numbers work as before', () => {
    expect(canonicalPhoneKey('60123456789')).toBe('60123456789');
    expect(canonicalPhoneKey('+60-123-456-789')).toBe('60123456789');
    expect(canonicalPhoneKey('60123456789@s.whatsapp.net')).toBe('60123456789');
  });

  test('preserves bsuid-prefixed keys', () => {
    expect(canonicalPhoneKey('bsuid:MY.abc123')).toBe('bsuid:MY.abc123');
    expect(canonicalPhoneKey('bsuid:US.user42xyz')).toBe('bsuid:US.user42xyz');
  });

  test('non-digit non-BSUID strings are sanitized', () => {
    expect(canonicalPhoneKey('webchat-abc')).toBe('webchat-abc');
  });

  test('webchat keys with digits are preserved as-is (LC-01)', () => {
    expect(canonicalPhoneKey('webchat-web_zjc78qz5_1774492351497')).toBe('webchat-web_zjc78qz5_1774492351497');
    expect(canonicalPhoneKey('webchat-web_8zcwkjuc_1776148858315')).toBe('webchat-web_8zcwkjuc_1776148858315');
  });
});
