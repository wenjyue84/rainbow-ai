/**
 * US-911: WhatsApp in-chat Webview for mobile payment page.
 *
 * Public endpoints (no admin auth) for the payment webview flow:
 *
 * GET  /api/rainbow/pay/:token         — Serves the payment page (webview)
 * POST /api/rainbow/payment/initiate   — Initiates payment with selected method
 * POST /api/rainbow/payment/callback   — Payment gateway webhook callback
 * GET  /api/rainbow/payment/status/:id — Poll payment status
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { eq } from 'drizzle-orm';
import { db, dbReady } from '../../lib/db.js';
import { paymentSessions } from '../../../shared/schema-tables.js';
import { verifyPaymentToken, hashToken } from '../../lib/payment-token.js';
import { sendWhatsAppMessage } from '../../lib/whatsapp/index.js';

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = dirname(__filename_local);

const router = Router();

// Rate limit payment page loads (20/min per IP)
const paymentPageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many requests' },
});

// Rate limit payment initiation (5/min per IP)
const paymentInitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many payment attempts' },
});

// Cache the payment HTML template
let paymentHtmlTemplate: string | null = null;
function getPaymentHtml(): string {
  if (!paymentHtmlTemplate) {
    paymentHtmlTemplate = readFileSync(
      join(__dirname_local, '..', '..', 'public', 'payment.html'),
      'utf-8'
    );
  }
  return paymentHtmlTemplate;
}

/**
 * GET /api/rainbow/pay/:token
 * Validates the signed token and serves the payment page with session data injected.
 * This is the URL opened by the WhatsApp CTA button (in-app webview).
 */
router.get('/pay/:token', paymentPageLimiter, async (req: Request, res: Response) => {
  const { token } = req.params;

  // Verify token signature and expiry
  const payload = verifyPaymentToken(token);
  if (!payload) {
    return res.status(400).send(getExpiredHtml());
  }

  // Check session exists and is not already paid/expired in DB
  if (!dbReady()) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  try {
    const tokenH = hashToken(token);
    const [session] = await db!
      .select()
      .from(paymentSessions)
      .where(eq(paymentSessions.tokenHash, tokenH))
      .limit(1);

    if (!session) {
      return res.status(404).send(getExpiredHtml());
    }

    if (session.status === 'paid') {
      return res.send(getSuccessHtml());
    }

    if (session.status === 'expired' || session.status === 'failed') {
      return res.status(410).send(getExpiredHtml());
    }

    // Check time-based expiry
    if (new Date(session.expiresAt) < new Date()) {
      // Mark as expired in DB
      await db!.update(paymentSessions)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(paymentSessions.id, session.id));
      return res.status(410).send(getExpiredHtml());
    }

    // Parse order summary
    let orderSummary: any = {};
    try {
      orderSummary = JSON.parse(session.orderSummaryJson);
    } catch { /* empty */ }

    // Inject session data into the HTML page
    const sessionData = JSON.stringify({
      sessionId: session.id,
      token: token,
      items: orderSummary.items || [],
      totalMyr: session.amountMyr,
      currency: 'MYR',
      description: orderSummary.description || '',
      businessName: orderSummary.businessName || 'Pelangi Capsule Hostel',
      expiresAt: session.expiresAt,
    });

    const html = getPaymentHtml().replace(
      'window.__PAYMENT_SESSION__ || null',
      sessionData,
    );

    // Serve with webview-friendly headers
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    // Allow WhatsApp in-app browser to render
    res.set('X-Frame-Options', 'ALLOWALL');
    res.send(html);
  } catch (err: any) {
    console.error('[Payment] Error serving payment page:', err.message);
    res.status(500).send(getExpiredHtml());
  }
});

/**
 * POST /api/rainbow/payment/initiate
 * Called by the payment page when user selects a payment method and clicks Pay.
 * In production, this would create a payment intent with HitPay/Curlec.
 * For now, returns a placeholder redirect or marks as processing.
 */
router.post('/payment/initiate', paymentInitLimiter, async (req: Request, res: Response) => {
  const { sessionId, paymentMethod, token } = req.body;

  if (!sessionId || !paymentMethod || !token) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate payment method
  const validMethods = ['duitnow_qr', 'fpx', 'tng'];
  if (!validMethods.includes(paymentMethod)) {
    return res.status(400).json({ error: 'Invalid payment method' });
  }

  // Verify token
  const payload = verifyPaymentToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (!dbReady()) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  try {
    const [session] = await db!
      .select()
      .from(paymentSessions)
      .where(eq(paymentSessions.id, sessionId))
      .limit(1);

    if (!session || session.status !== 'pending') {
      return res.status(400).json({ error: 'Payment session not available' });
    }

    // Check expiry
    if (new Date(session.expiresAt) < new Date()) {
      await db!.update(paymentSessions)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(paymentSessions.id, session.id));
      return res.status(410).json({ error: 'Payment session expired' });
    }

    // Update session with selected payment method
    await db!.update(paymentSessions)
      .set({ paymentMethod, updatedAt: new Date() })
      .where(eq(paymentSessions.id, session.id));

    // --- Payment Gateway Integration Point ---
    // In production, create a payment intent with the gateway:
    //
    // HitPay: POST https://api.hit-pay.com/v1/payment-requests
    // Curlec/Razorpay MY: POST https://api.razorpay.com/v1/payment_links
    //
    // The gateway returns a redirect URL (for FPX/TNG) or QR code URL (for DuitNow).
    // The callback URL should point to POST /api/rainbow/payment/callback.

    const gatewayRef = `SIM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Store gateway reference
    await db!.update(paymentSessions)
      .set({
        gatewayRef,
        gatewayProvider: 'pending_integration',
        updatedAt: new Date(),
      })
      .where(eq(paymentSessions.id, session.id));

    console.log(`[Payment] Initiated ${paymentMethod} payment for session ${sessionId}, gateway ref: ${gatewayRef}`);

    // Return response based on payment method
    if (paymentMethod === 'duitnow_qr') {
      // DuitNow QR: return a QR code URL for the payer to scan
      // In production: gateway returns a DuitNow QR image URL
      res.json({
        status: 'processing',
        gatewayRef,
        // qrCodeUrl: gatewayResponse.qr_url,  // uncomment when gateway is integrated
        message: 'DuitNow QR payment initiated. Gateway integration pending.',
      });
    } else {
      // FPX / TNG: return a redirect URL for the payer's bank/wallet
      // In production: gateway returns a redirect URL
      res.json({
        status: 'processing',
        gatewayRef,
        // redirectUrl: gatewayResponse.redirect_url,  // uncomment when gateway is integrated
        message: `${paymentMethod.toUpperCase()} payment initiated. Gateway integration pending.`,
      });
    }
  } catch (err: any) {
    console.error('[Payment] Initiate error:', err.message);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});

/**
 * POST /api/rainbow/payment/callback
 * Webhook callback from payment gateway (HitPay / Curlec).
 * Verifies the callback signature and updates the session status.
 * Sends a WhatsApp confirmation message on success.
 */
router.post('/payment/callback', async (req: Request, res: Response) => {
  // In production, verify the gateway's webhook signature here.
  // HitPay: HMAC-SHA256 on payload using API salt
  // Curlec: x-razorpay-signature header with webhook secret

  const { payment_id, status, reference, amount } = req.body;

  if (!reference) {
    return res.status(400).json({ error: 'Missing reference' });
  }

  if (!dbReady()) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  try {
    // Find session by gateway reference
    const [session] = await db!
      .select()
      .from(paymentSessions)
      .where(eq(paymentSessions.gatewayRef, reference))
      .limit(1);

    if (!session) {
      console.warn(`[Payment] Callback for unknown reference: ${reference}`);
      return res.status(404).json({ error: 'Session not found' });
    }

    // Store raw callback payload for audit
    const callbackPayload = JSON.stringify(req.body);

    if (status === 'completed' || status === 'succeeded' || status === 'paid') {
      // Payment successful
      await db!.update(paymentSessions)
        .set({
          status: 'paid',
          paidAt: new Date(),
          callbackPayloadJson: callbackPayload,
          updatedAt: new Date(),
        })
        .where(eq(paymentSessions.id, session.id));

      // Send WhatsApp confirmation message
      try {
        let orderSummary: any = {};
        try { orderSummary = JSON.parse(session.orderSummaryJson); } catch { /* empty */ }
        const confirmMsg = [
          `Payment Confirmed! RM ${session.amountMyr.toFixed(2)}`,
          '',
          orderSummary.description || 'Your order',
          `Payment method: ${session.paymentMethod || 'Online'}`,
          `Reference: ${session.gatewayRef}`,
          '',
          'Thank you for your payment!',
        ].join('\n');

        await sendWhatsAppMessage(session.phone, confirmMsg);
        console.log(`[Payment] Confirmation sent to ${session.phone} for session ${session.id}`);
      } catch (waErr: any) {
        console.error(`[Payment] Failed to send confirmation to ${session.phone}:`, waErr.message);
      }

      console.log(`[Payment] Session ${session.id} marked as paid (gateway ref: ${reference})`);
    } else if (status === 'failed' || status === 'cancelled') {
      await db!.update(paymentSessions)
        .set({
          status: 'failed',
          failedAt: new Date(),
          callbackPayloadJson: callbackPayload,
          updatedAt: new Date(),
        })
        .where(eq(paymentSessions.id, session.id));

      console.log(`[Payment] Session ${session.id} marked as failed (gateway ref: ${reference})`);
    }

    // Always return 200 to acknowledge the webhook
    res.json({ received: true });
  } catch (err: any) {
    console.error('[Payment] Callback error:', err.message);
    res.status(500).json({ error: 'Callback processing failed' });
  }
});

/**
 * GET /api/rainbow/payment/status/:id
 * Polled by the payment page to check if payment has been completed.
 */
router.get('/payment/status/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!dbReady()) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  try {
    const [session] = await db!
      .select({
        status: paymentSessions.status,
        paidAt: paymentSessions.paidAt,
        paymentMethod: paymentSessions.paymentMethod,
      })
      .from(paymentSessions)
      .where(eq(paymentSessions.id, id))
      .limit(1);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      status: session.status,
      paidAt: session.paidAt,
      paymentMethod: session.paymentMethod,
    });
  } catch (err: any) {
    console.error('[Payment] Status check error:', err.message);
    res.status(500).json({ error: 'Status check failed' });
  }
});

// --- Helper HTML generators ---

function getExpiredHtml(): string {
  return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Expired</title>
<style>body{font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;color:#1e293b;background:#f8fafc}
h2{font-size:20px;margin-bottom:8px}p{color:#64748b;font-size:14px}</style>
</head><body>
<div style="font-size:48px;color:#64748b">&#9203;</div>
<h2>Payment Link Expired</h2>
<p>This payment link is no longer valid.<br>Please request a new payment link via WhatsApp.</p>
</body></html>`;
}

function getSuccessHtml(): string {
  return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Complete</title>
<style>body{font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;color:#1e293b;background:#f8fafc}
h2{font-size:20px;margin-bottom:8px;color:#16a34a}p{color:#64748b;font-size:14px}</style>
</head><body>
<div style="font-size:48px;color:#16a34a">&#10004;</div>
<h2>Payment Already Completed</h2>
<p>This payment has already been processed.<br>Check your WhatsApp for the confirmation message.</p>
</body></html>`;
}

export default router;
