/**
 * payment-message.ts — US-911: Send "Pay Now" CTA button via WhatsApp.
 *
 * Sends an interactive message with a CTA URL button that opens the payment
 * webview inside WhatsApp (for eligible accounts) or falls back to an
 * external browser link.
 *
 * Uses Baileys' interactive message format for URL buttons.
 */

import { randomUUID } from 'crypto';
import { db, dbReady } from '../db.js';
import { paymentSessions } from '../../../shared/schema-tables.js';
import { createPaymentToken } from '../payment-token.js';
import { sendWhatsAppMessage, sendWhatsAppInteractiveMessage } from './index.js';

export interface PaymentOrderItem {
  name: string;
  qty: number;
  price: number; // MYR
}

export interface SendPaymentLinkOptions {
  /** WhatsApp JID of the recipient */
  jid: string;
  /** Phone number (for DB and confirmation messages) */
  phone: string;
  /** Order line items */
  items: PaymentOrderItem[];
  /** Total amount in MYR */
  totalMyr: number;
  /** Order description (e.g., "Room booking #RB-20260315-1234") */
  description?: string;
  /** Business name shown on payment page */
  businessName?: string;
  /** Profile ID */
  profileId?: string;
  /** Base URL for the payment page (auto-detected from env if not provided) */
  baseUrl?: string;
  /** Token expiry in milliseconds (default: 30 min) */
  expiryMs?: number;
}

/**
 * Create a payment session and send a "Pay Now" button message via WhatsApp.
 *
 * @returns The created payment session ID.
 */
export async function sendPaymentLink(opts: SendPaymentLinkOptions): Promise<string> {
  const {
    jid,
    phone,
    items,
    totalMyr,
    description = '',
    businessName = 'Pelangi Capsule Hostel',
    profileId = 'pelangi',
    expiryMs = 30 * 60 * 1000,
  } = opts;

  if (!dbReady()) {
    throw new Error('Database not ready');
  }

  const sessionId = randomUUID();
  const orderSummary = JSON.stringify({ items, totalMyr, description, businessName });

  // Create signed token
  const { token, tokenHash } = createPaymentToken(
    sessionId, phone, totalMyr, profileId, expiryMs,
  );

  // Build payment URL
  const baseUrl = opts.baseUrl || getBaseUrl();
  const paymentUrl = `${baseUrl}/api/rainbow/pay/${token}`;

  // Persist session to DB
  const expiresAt = new Date(Date.now() + expiryMs);
  await db!.insert(paymentSessions).values({
    id: sessionId,
    profileId,
    jid,
    phone,
    orderSummaryJson: orderSummary,
    amountMyr: totalMyr,
    status: 'pending',
    tokenHash,
    expiresAt,
  });

  console.log(`[Payment] Created session ${sessionId} for ${phone}, RM ${totalMyr.toFixed(2)}`);

  // Build order summary text
  const itemLines = items
    .map(i => `  ${i.qty}x ${i.name} — RM ${i.price.toFixed(2)}`)
    .join('\n');

  const messageText = [
    `*Payment Request*`,
    '',
    description || 'Order Summary:',
    itemLines,
    '',
    `*Total: RM ${totalMyr.toFixed(2)}*`,
    '',
    `Tap the button below to pay securely.`,
    `This link expires in ${Math.round(expiryMs / 60000)} minutes.`,
  ].join('\n');

  // Try to send as interactive CTA URL button first.
  // If the WhatsApp account supports webview (1000+ BIC/day), this opens in-app.
  // Otherwise, it opens in the external browser (graceful degradation).
  try {
    await sendWhatsAppInteractiveMessage(phone, {
      extendedTextMessage: {
        text: messageText,
        matchedText: paymentUrl,
        canonicalUrl: paymentUrl,
        title: 'Pay Now',
        description: `RM ${totalMyr.toFixed(2)} — ${description || 'Secure Payment'}`,
      },
    });
  } catch (interactiveErr: any) {
    // Fallback: send as plain text with URL (opens in external browser)
    console.warn(`[Payment] Interactive message failed, falling back to plain text:`, interactiveErr.message);
    const fallbackText = `${messageText}\n\nPay here: ${paymentUrl}`;
    await sendWhatsAppMessage(phone, fallbackText);
  }

  return sessionId;
}

/**
 * Determine the base URL for payment links from environment variables.
 */
function getBaseUrl(): string {
  // Production: use the public-facing URL
  if (process.env.PAYMENT_BASE_URL) return process.env.PAYMENT_BASE_URL;
  if (process.env.DIGIMAN_API_URL) return process.env.DIGIMAN_API_URL;

  const port = process.env.MCP_SERVER_PORT || '3002';
  const host = process.env.NODE_ENV === 'production'
    ? 'https://rainbow.pelangicapsulehostel.com'
    : `http://localhost:${port}`;
  return host;
}
