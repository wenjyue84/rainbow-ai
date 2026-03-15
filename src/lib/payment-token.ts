/**
 * payment-token.ts — US-911: Signed payment session tokens for webview URLs.
 *
 * Uses HMAC-SHA256 with PAYMENT_TOKEN_SECRET env var (falls back to RAINBOW_ADMIN_KEY).
 * Token format: base64url(JSON payload).base64url(HMAC signature)
 */
import { createHmac, createHash } from 'crypto';

const DEFAULT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export interface PaymentTokenPayload {
  /** Payment session ID (UUID) */
  sid: string;
  /** Payer phone number */
  ph: string;
  /** Amount in MYR (cents) */
  amt: number;
  /** Expiry timestamp (epoch ms) */
  exp: number;
  /** Profile ID */
  pid: string;
}

function getSecret(): string {
  const secret = process.env.PAYMENT_TOKEN_SECRET || process.env.RAINBOW_ADMIN_KEY;
  if (!secret) {
    throw new Error('PAYMENT_TOKEN_SECRET or RAINBOW_ADMIN_KEY must be set');
  }
  return secret;
}

function base64urlEncode(data: string): string {
  return Buffer.from(data, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function sign(payload: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(payload).digest('base64');
  return sig.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Create a signed payment token.
 * @returns The token string and its SHA-256 hash (for DB storage/revocation).
 */
export function createPaymentToken(
  sessionId: string,
  phone: string,
  amountMyr: number,
  profileId: string = 'pelangi',
  expiryMs: number = DEFAULT_EXPIRY_MS,
): { token: string; tokenHash: string } {
  const payload: PaymentTokenPayload = {
    sid: sessionId,
    ph: phone,
    amt: Math.round(amountMyr * 100), // store as cents
    exp: Date.now() + expiryMs,
    pid: profileId,
  };

  const secret = getSecret();
  const payloadStr = base64urlEncode(JSON.stringify(payload));
  const signature = sign(payloadStr, secret);
  const token = `${payloadStr}.${signature}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');

  return { token, tokenHash };
}

/**
 * Verify and decode a payment token.
 * @returns The decoded payload, or null if invalid/expired.
 */
export function verifyPaymentToken(token: string): PaymentTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadStr, providedSig] = parts;
  const secret = getSecret();
  const expectedSig = sign(payloadStr, secret);

  // Constant-time comparison
  if (providedSig.length !== expectedSig.length) return null;
  let mismatch = 0;
  for (let i = 0; i < providedSig.length; i++) {
    mismatch |= providedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  try {
    const payload: PaymentTokenPayload = JSON.parse(base64urlDecode(payloadStr));
    if (payload.exp < Date.now()) return null; // expired
    return payload;
  } catch {
    return null;
  }
}

/** Hash a token for DB lookup (revocation check). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
