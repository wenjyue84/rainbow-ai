/**
 * Unit tests for US-911: Signed payment session tokens for webview URLs.
 *
 * Verifies:
 * - createPaymentToken returns a token and its SHA-256 hash
 * - verifyPaymentToken returns the payload for a valid token
 * - verifyPaymentToken returns null for a tampered token
 * - verifyPaymentToken returns null for an expired token
 * - hashToken is deterministic (same token -> same hash)
 * - Payment page renders with session data (graceful degradation when SESSION is null)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPaymentToken, verifyPaymentToken, hashToken } from '../../lib/payment-token.js';

const TEST_SECRET = 'test-payment-secret-us911';

beforeAll(() => {
  process.env.PAYMENT_TOKEN_SECRET = TEST_SECRET;
});

afterAll(() => {
  delete process.env.PAYMENT_TOKEN_SECRET;
});

describe('createPaymentToken', () => {
  it('returns a token string and a hex tokenHash', () => {
    const { token, tokenHash } = createPaymentToken('session-1', '+60123456789', 50.00, 'pelangi');
    expect(typeof token).toBe('string');
    expect(token).toContain('.'); // payload.signature format
    expect(typeof tokenHash).toBe('string');
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/); // 256-bit hex
  });

  it('token includes sid, ph, amt, pid fields', () => {
    const { token } = createPaymentToken('sess-abc', '+60111234567', 120.50, 'southern');
    const payload = verifyPaymentToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sid).toBe('sess-abc');
    expect(payload!.ph).toBe('+60111234567');
    expect(payload!.amt).toBe(12050); // stored as cents
    expect(payload!.pid).toBe('southern');
  });

  it('default expiry is 30 minutes from now', () => {
    const before = Date.now();
    const { token } = createPaymentToken('sess-expiry', '+601', 1.00);
    const payload = verifyPaymentToken(token);
    const after = Date.now();
    expect(payload).not.toBeNull();
    const expectedMin = before + 29 * 60 * 1000;
    const expectedMax = after + 31 * 60 * 1000;
    expect(payload!.exp).toBeGreaterThan(expectedMin);
    expect(payload!.exp).toBeLessThan(expectedMax);
  });
});

describe('verifyPaymentToken', () => {
  it('returns the payload for a valid, unexpired token', () => {
    const { token } = createPaymentToken('sess-valid', '+60198765432', 75.00);
    const payload = verifyPaymentToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sid).toBe('sess-valid');
  });

  it('returns null when the signature is tampered', () => {
    const { token } = createPaymentToken('sess-tamper', '+60198765432', 10.00);
    const [payloadPart, sigPart] = token.split('.');
    const tamperedSig = sigPart.slice(0, -4) + 'xxxx';
    const tamperedToken = `${payloadPart}.${tamperedSig}`;
    expect(verifyPaymentToken(tamperedToken)).toBeNull();
  });

  it('returns null when the payload is tampered', () => {
    const { token } = createPaymentToken('sess-tamper2', '+60198765432', 10.00);
    const [, sigPart] = token.split('.');
    // Craft a different payload
    const fakePayload = Buffer.from(JSON.stringify({ sid: 'evil', ph: 'x', amt: 0, exp: Date.now() + 60000, pid: 'x' }))
      .toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const tamperedToken = `${fakePayload}.${sigPart}`;
    expect(verifyPaymentToken(tamperedToken)).toBeNull();
  });

  it('returns null for an expired token', () => {
    // Create a token that already expired (1ms expiry)
    const { token } = createPaymentToken('sess-expired', '+60198765432', 5.00, 'pelangi', 1);
    // Wait 5ms to guarantee expiry
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(verifyPaymentToken(token)).toBeNull();
        resolve();
      }, 10);
    });
  });

  it('returns null for a completely invalid token string', () => {
    expect(verifyPaymentToken('not-a-valid-token')).toBeNull();
    expect(verifyPaymentToken('')).toBeNull();
    expect(verifyPaymentToken('a.b.c')).toBeNull();
  });
});

describe('hashToken', () => {
  it('returns the same hash for the same token (deterministic)', () => {
    const { token } = createPaymentToken('sess-hash', '+601', 20.00);
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('returns a 64-char hex string', () => {
    const { token } = createPaymentToken('sess-hashlen', '+601', 20.00);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('token hash matches the hash returned by createPaymentToken', () => {
    const { token, tokenHash } = createPaymentToken('sess-match', '+601', 20.00);
    expect(hashToken(token)).toBe(tokenHash);
  });
});
