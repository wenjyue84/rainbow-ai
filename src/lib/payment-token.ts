/**
 * US-911: Signed payment session tokens for WhatsApp in-chat webview.
 *
 * Uses HMAC-SHA256 to sign a JSON payload containing order/session info.
 * No external JWT dependency required — uses Node.js crypto only.
 */
import crypto from 'crypto';

const PAYMENT_SECRET = process.env.PAYMENT_TOKEN_SECRET || 'rainbow-payment-dev-secret';
const TOKEN_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export interface PaymentTokenPayload {
  /** Unique payment session ID */
  sessionId: string;
  /** Phone number of the customer */
  phone: string;
  /** Order reference */
  orderId: string;
  /** Total amount in MYR (cents) */
  amountCents: number;
  /** Order summary items */
  items: { name: string; qty: number; priceCents: number }[];
  /** Profile/tenant ID */
  profileId: string;
  /** Created timestamp (ms) */
  iat: number;
  /** Expiry timestamp (ms) */
  exp: number;
}

/**
 * Create a signed payment token embedding order details.
 */
export function createPaymentToken(params: {
  phone: string;
  orderId: string;
  amountCents: number;
  items: { name: string; qty: number; priceCents: number }[];
  profileId: string;
}): string {
  const now = Date.now();
  const payload: PaymentTokenPayload = {
    sessionId: crypto.randomUUID(),
    phone: params.phone,
    orderId: params.orderId,
    amountCents: params.amountCents,
    items: params.items,
    profileId: params.profileId,
    iat: now,
    exp: now + TOKEN_EXPIRY_MS,
  };

  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', PAYMENT_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/**
 * Verify and decode a payment token.
 * Returns null if invalid or expired.
 */
export function verifyPaymentToken(token: string): PaymentTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [data, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', PAYMENT_SECRET).update(data).digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload: PaymentTokenPayload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
