/**
 * US-911: WhatsApp in-chat Webview for mobile payment page.
 *
 * Endpoints:
 *   POST /payment/create-session  — Create a payment session, returns signed URL
 *   GET  /payment/checkout/:token — Serve the mobile-optimised payment page
 *   POST /payment/callback        — Payment gateway webhook callback
 *   GET  /payment/status/:sessionId — Poll payment status (for webview JS)
 *
 * The webview URL opens inside WhatsApp's in-app browser when sent via
 * a CTA URL button. For accounts below the WABA eligibility threshold,
 * the same URL works as a fallback external browser link.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../../lib/db.js';
import { createPaymentToken, verifyPaymentToken } from '../../lib/payment-token.js';
import { sendWhatsAppMessage } from '../../lib/baileys-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

// ─── DB Table Setup (lazy) ───────────────────────────────────────────
let _tableEnsured = false;

async function ensurePaymentTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wa_payment_sessions (
        id TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        order_id TEXT NOT NULL,
        profile_id TEXT NOT NULL DEFAULT 'pelangi',
        amount_cents INTEGER NOT NULL,
        items JSONB NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        payment_method TEXT,
        payment_ref TEXT,
        gateway_response JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        paid_at TIMESTAMPTZ,
        expired_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_payment_sessions_phone ON wa_payment_sessions(phone);
      CREATE INDEX IF NOT EXISTS idx_payment_sessions_order ON wa_payment_sessions(order_id);
      CREATE INDEX IF NOT EXISTS idx_payment_sessions_status ON wa_payment_sessions(status);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error('[Payment] Failed to create payment table:', err.message);
  }
}

// ─── Helper: base URL ────────────────────────────────────────────────
function getBaseUrl(req: Request): string {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3002';
  return `${proto}://${host}`;
}

// ─── POST /payment/create-session ────────────────────────────────────
/**
 * Creates a payment session and returns a signed webview URL.
 *
 * Body: { phone, orderId, amountCents, items, profileId }
 * Returns: { url, sessionId, token, expiresIn }
 */
router.post('/payment/create-session', async (req: Request, res: Response) => {
  try {
    const { phone, orderId, amountCents, items, profileId } = req.body;

    if (!phone || !orderId || !amountCents || !items) {
      res.status(400).json({ error: 'Missing required fields: phone, orderId, amountCents, items' });
      return;
    }

    const token = createPaymentToken({
      phone,
      orderId,
      amountCents: Number(amountCents),
      items: items || [],
      profileId: profileId || 'pelangi',
    });

    const payload = verifyPaymentToken(token);
    if (!payload) {
      res.status(500).json({ error: 'Token creation failed' });
      return;
    }

    // Persist session to DB
    await ensurePaymentTable();
    await pool.query(
      `INSERT INTO wa_payment_sessions (id, phone, order_id, profile_id, amount_cents, items, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT (id) DO NOTHING`,
      [payload.sessionId, phone, orderId, payload.profileId, payload.amountCents, JSON.stringify(items)]
    );

    const baseUrl = getBaseUrl(req);
    const checkoutUrl = `${baseUrl}/payment/checkout/${token}`;

    res.json({
      url: checkoutUrl,
      sessionId: payload.sessionId,
      token,
      expiresIn: 1800, // 30 minutes
    });
  } catch (err: any) {
    console.error('[Payment] create-session error:', err.message);
    res.status(500).json({ error: 'Failed to create payment session' });
  }
});

// ─── GET /payment/checkout/:token ────────────────────────────────────
/**
 * Serves the mobile-optimised payment page inside WhatsApp webview.
 * Token is validated; expired/invalid tokens show an error page.
 */
router.get('/payment/checkout/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  const payload = verifyPaymentToken(token);

  if (!payload) {
    res.status(400).send(getExpiredHtml());
    return;
  }

  // Check DB status — if already paid, show success
  await ensurePaymentTable();
  const dbResult = await pool.query(
    'SELECT status FROM wa_payment_sessions WHERE id = $1',
    [payload.sessionId]
  );
  if (dbResult.rows[0]?.status === 'paid') {
    res.send(getSuccessHtml(payload.orderId));
    return;
  }

  // Serve the checkout page with embedded order data
  const baseUrl = getBaseUrl(req);
  const html = getCheckoutHtml(payload, token, baseUrl);
  res.type('html').send(html);
});

// ─── POST /payment/callback ─────────────────────────────────────────
/**
 * Payment gateway webhook callback.
 * Called by DuitNow/FPX gateway when payment completes.
 *
 * Body: { sessionId, status, paymentRef, paymentMethod, gatewayData }
 */
router.post('/payment/callback', async (req: Request, res: Response) => {
  try {
    const { sessionId, status, paymentRef, paymentMethod, gatewayData } = req.body;

    if (!sessionId || !status) {
      res.status(400).json({ error: 'Missing sessionId or status' });
      return;
    }

    await ensurePaymentTable();

    // Update payment session
    const result = await pool.query(
      `UPDATE wa_payment_sessions
       SET status = $1,
           payment_ref = $2,
           payment_method = $3,
           gateway_response = $4,
           paid_at = CASE WHEN $1 = 'paid' THEN NOW() ELSE paid_at END
       WHERE id = $5
       RETURNING phone, order_id, amount_cents, profile_id`,
      [status, paymentRef || null, paymentMethod || null, JSON.stringify(gatewayData || {}), sessionId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // On successful payment, send WhatsApp confirmation
    if (status === 'paid') {
      const row = result.rows[0];
      const amountRm = (row.amount_cents / 100).toFixed(2);
      const confirmMsg =
        `✅ *Payment Received*\n\n` +
        `Order: ${row.order_id}\n` +
        `Amount: RM${amountRm}\n` +
        `Method: ${paymentMethod || 'Online'}\n` +
        `Ref: ${paymentRef || '-'}\n\n` +
        `Thank you! Your order is being prepared. 🎉`;

      // Fire-and-forget WhatsApp confirmation
      sendWhatsAppMessage(row.phone, confirmMsg).catch((err: any) => {
        console.error('[Payment] Failed to send confirmation:', err.message);
      });
    }

    res.json({ ok: true, status });
  } catch (err: any) {
    console.error('[Payment] callback error:', err.message);
    res.status(500).json({ error: 'Callback processing failed' });
  }
});

// ─── GET /payment/status/:sessionId ──────────────────────────────────
/**
 * Poll payment status (used by the checkout page JS to detect payment completion).
 */
router.get('/payment/status/:sessionId', async (req: Request, res: Response) => {
  try {
    await ensurePaymentTable();
    const result = await pool.query(
      'SELECT status, payment_method, payment_ref, paid_at FROM wa_payment_sessions WHERE id = $1',
      [req.params.sessionId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[Payment] status error:', err.message);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// ─── POST /payment/simulate ─────────────────────────────────────────
/**
 * Dev/test endpoint: simulate a successful payment (non-production only).
 */
router.post('/payment/simulate', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Not available in production' });
    return;
  }

  try {
    const { sessionId, method } = req.body;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }

    await ensurePaymentTable();
    const paymentRef = `SIM-${Date.now().toString(36).toUpperCase()}`;

    const result = await pool.query(
      `UPDATE wa_payment_sessions
       SET status = 'paid', payment_ref = $1, payment_method = $2, paid_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING phone, order_id, amount_cents, profile_id`,
      [paymentRef, method || 'duitnow_qr', sessionId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Session not found or already paid' });
      return;
    }

    const row = result.rows[0];
    const amountRm = (row.amount_cents / 100).toFixed(2);
    sendWhatsAppMessage(row.phone,
      `✅ *Payment Received*\n\nOrder: ${row.order_id}\nAmount: RM${amountRm}\nRef: ${paymentRef}\n\nThank you! 🎉`
    ).catch(() => {});

    res.json({ ok: true, paymentRef });
  } catch (err: any) {
    console.error('[Payment] simulate error:', err.message);
    res.status(500).json({ error: 'Simulation failed' });
  }
});

// ─── HTML Generators ─────────────────────────────────────────────────

function getCheckoutHtml(
  payload: { sessionId: string; orderId: string; amountCents: number; items: { name: string; qty: number; priceCents: number }[]; phone: string; profileId: string },
  token: string,
  baseUrl: string
): string {
  const amountRm = (payload.amountCents / 100).toFixed(2);
  const itemsHtml = payload.items
    .map(i => `<div class="item"><span>${i.name} x${i.qty}</span><span>RM${(i.priceCents / 100).toFixed(2)}</span></div>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Payment — ${payload.orderId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5; color: #1a1a1a; min-height: 100vh;
      display: flex; flex-direction: column;
    }
    .header {
      background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
      color: white; padding: 20px 16px; text-align: center;
    }
    .header h1 { font-size: 18px; font-weight: 600; }
    .header .order-ref { font-size: 13px; opacity: 0.9; margin-top: 4px; }
    .content { flex: 1; padding: 16px; max-width: 480px; margin: 0 auto; width: 100%; }
    .card {
      background: white; border-radius: 12px; padding: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 12px;
    }
    .card-title {
      font-size: 14px; font-weight: 600; color: #666;
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;
    }
    .item {
      display: flex; justify-content: space-between; padding: 8px 0;
      border-bottom: 1px solid #f0f0f0; font-size: 15px;
    }
    .item:last-child { border-bottom: none; }
    .total {
      display: flex; justify-content: space-between; padding: 12px 0 0;
      font-size: 18px; font-weight: 700; border-top: 2px solid #25D366;
      margin-top: 8px;
    }
    .total .amount { color: #128C7E; }
    .methods { display: flex; flex-direction: column; gap: 10px; }
    .method-btn {
      display: flex; align-items: center; gap: 12px; padding: 14px 16px;
      border: 2px solid #e0e0e0; border-radius: 10px; background: white;
      font-size: 15px; font-weight: 500; cursor: pointer; transition: all 0.2s;
      width: 100%; text-align: left;
    }
    .method-btn:active, .method-btn.selected {
      border-color: #25D366; background: #f0fdf4;
    }
    .method-btn .icon { font-size: 24px; width: 32px; text-align: center; }
    .method-btn .label { flex: 1; }
    .method-btn .sublabel { font-size: 12px; color: #888; font-weight: 400; }
    .pay-btn {
      width: 100%; padding: 16px; border: none; border-radius: 12px;
      background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
      color: white; font-size: 17px; font-weight: 600; cursor: pointer;
      margin-top: 16px; transition: opacity 0.2s;
    }
    .pay-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .pay-btn:active:not(:disabled) { opacity: 0.8; }
    .secure-note {
      text-align: center; font-size: 12px; color: #999;
      margin-top: 12px; padding-bottom: 20px;
    }
    .secure-note span { color: #25D366; }
    .status-msg {
      text-align: center; padding: 20px; font-size: 15px; display: none;
    }
    .status-msg.show { display: block; }
    .spinner {
      width: 32px; height: 32px; border: 3px solid #e0e0e0;
      border-top-color: #25D366; border-radius: 50%;
      animation: spin 0.8s linear infinite; margin: 0 auto 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .success-icon { font-size: 48px; margin-bottom: 12px; }
    .qr-container {
      text-align: center; padding: 16px; display: none;
    }
    .qr-container.show { display: block; }
    .qr-placeholder {
      width: 200px; height: 200px; margin: 0 auto; background: #f9f9f9;
      border: 2px dashed #ccc; border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; color: #888;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Pelangi Capsule Hostel</h1>
    <div class="order-ref">Order ${payload.orderId}</div>
  </div>

  <div class="content">
    <!-- Order Summary -->
    <div class="card">
      <div class="card-title">Order Summary</div>
      ${itemsHtml}
      <div class="total">
        <span>Total</span>
        <span class="amount">RM${amountRm}</span>
      </div>
    </div>

    <!-- Payment Methods -->
    <div class="card" id="methods-card">
      <div class="card-title">Payment Method</div>
      <div class="methods">
        <button class="method-btn" data-method="duitnow_qr" onclick="selectMethod(this)">
          <span class="icon">📱</span>
          <div>
            <div class="label">DuitNow QR</div>
            <div class="sublabel">Scan QR code to pay instantly</div>
          </div>
        </button>
        <button class="method-btn" data-method="fpx" onclick="selectMethod(this)">
          <span class="icon">🏦</span>
          <div>
            <div class="label">FPX Online Banking</div>
            <div class="sublabel">Pay via your bank app</div>
          </div>
        </button>
        <button class="method-btn" data-method="tng" onclick="selectMethod(this)">
          <span class="icon">💳</span>
          <div>
            <div class="label">Touch 'n Go eWallet</div>
            <div class="sublabel">Pay with TnG eWallet balance</div>
          </div>
        </button>
      </div>
    </div>

    <!-- DuitNow QR display -->
    <div class="qr-container" id="qr-display">
      <div class="card">
        <div class="card-title">Scan to Pay</div>
        <div class="qr-placeholder" id="qr-code">
          DuitNow QR<br>RM${amountRm}
        </div>
        <p style="margin-top:12px; font-size:13px; color:#666;">
          Open your banking app and scan this QR code
        </p>
      </div>
    </div>

    <!-- Pay button -->
    <button class="pay-btn" id="pay-btn" disabled onclick="initiatePayment()">
      Select a payment method
    </button>

    <!-- Processing status -->
    <div class="status-msg" id="processing-msg">
      <div class="spinner"></div>
      <div>Processing your payment...</div>
      <div style="font-size:13px; color:#888; margin-top:8px;">Please do not close this page</div>
    </div>

    <!-- Success status -->
    <div class="status-msg" id="success-msg">
      <div class="success-icon">✅</div>
      <div style="font-size:18px; font-weight:600; color:#128C7E;">Payment Successful!</div>
      <div style="margin-top:8px; color:#666;">A confirmation has been sent to your WhatsApp.</div>
      <div style="margin-top:4px; font-size:13px; color:#888;">You can close this page now.</div>
    </div>

    <div class="secure-note">
      <span>🔒</span> Secured payment · Powered by Rainbow AI
    </div>
  </div>

  <script>
    const SESSION_ID = '${payload.sessionId}';
    const BASE_URL = '${baseUrl}';
    let selectedMethod = null;
    let pollTimer = null;

    function selectMethod(btn) {
      document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedMethod = btn.dataset.method;

      const payBtn = document.getElementById('pay-btn');
      payBtn.disabled = false;
      payBtn.textContent = 'Pay RM${amountRm}';

      // Show QR for DuitNow
      const qrDisplay = document.getElementById('qr-display');
      qrDisplay.classList.toggle('show', selectedMethod === 'duitnow_qr');
    }

    function initiatePayment() {
      if (!selectedMethod) return;

      // Show processing state
      document.getElementById('methods-card').style.display = 'none';
      document.getElementById('pay-btn').style.display = 'none';
      document.getElementById('qr-display').classList.remove('show');
      document.getElementById('processing-msg').classList.add('show');

      // In production, this would redirect to the payment gateway.
      // For DuitNow QR, the QR is displayed and we poll for confirmation.
      // For FPX/TnG, redirect to bank selection page.
      //
      // Since no gateway is configured yet, we start polling for
      // payment confirmation (via the /payment/callback webhook).
      startPolling();
    }

    function startPolling() {
      let attempts = 0;
      pollTimer = setInterval(async () => {
        attempts++;
        try {
          const resp = await fetch(BASE_URL + '/payment/status/' + SESSION_ID);
          const data = await resp.json();

          if (data.status === 'paid') {
            clearInterval(pollTimer);
            document.getElementById('processing-msg').classList.remove('show');
            document.getElementById('success-msg').classList.add('show');
          } else if (data.status === 'failed') {
            clearInterval(pollTimer);
            document.getElementById('processing-msg').innerHTML =
              '<div style="font-size:48px; margin-bottom:12px;">❌</div>' +
              '<div style="font-size:18px; font-weight:600; color:#dc2626;">Payment Failed</div>' +
              '<div style="margin-top:8px; color:#666;">Please try again or choose a different method.</div>';
          }
        } catch (e) {
          // Network error — keep polling
        }

        // Stop polling after 5 minutes
        if (attempts > 60) {
          clearInterval(pollTimer);
          document.getElementById('processing-msg').innerHTML =
            '<div style="font-size:48px; margin-bottom:12px;">⏰</div>' +
            '<div style="font-size:18px; font-weight:600;">Session Expired</div>' +
            '<div style="margin-top:8px; color:#666;">Please request a new payment link.</div>';
        }
      }, 5000); // Poll every 5 seconds
    }
  </script>
</body>
</html>`;
}

function getExpiredHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Link Expired</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5; display: flex; align-items: center;
      justify-content: center; min-height: 100vh; padding: 20px;
    }
    .card {
      background: white; border-radius: 16px; padding: 32px;
      text-align: center; max-width: 360px; width: 100%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    p { color: #666; font-size: 14px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⏰</div>
    <h1>Payment Link Expired</h1>
    <p>This payment link has expired or is invalid. Please request a new payment link from the chat.</p>
  </div>
</body>
</html>`;
}

function getSuccessHtml(orderId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Complete</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f0fdf4; display: flex; align-items: center;
      justify-content: center; min-height: 100vh; padding: 20px;
    }
    .card {
      background: white; border-radius: 16px; padding: 32px;
      text-align: center; max-width: 360px; width: 100%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; color: #128C7E; margin-bottom: 8px; }
    p { color: #666; font-size: 14px; line-height: 1.5; }
    .order-ref { font-weight: 600; color: #1a1a1a; margin-top: 12px; font-size: 15px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Payment Complete</h1>
    <p>Your payment has been received. A confirmation has been sent to your WhatsApp.</p>
    <div class="order-ref">Order: ${orderId}</div>
  </div>
</body>
</html>`;
}

// ─── Export helper: generate a payment CTA message for WhatsApp ──────
/**
 * Generate a text message with a payment link for WhatsApp.
 * When sent as a CTA URL button, WhatsApp opens it in the in-app webview.
 * Falls back gracefully as a clickable URL for non-eligible accounts.
 */
export function buildPaymentMessage(
  orderId: string,
  amountCents: number,
  paymentUrl: string,
  items: { name: string; qty: number; priceCents: number }[]
): string {
  const amountRm = (amountCents / 100).toFixed(2);
  const itemList = items.map(i => `  • ${i.name} x${i.qty}`).join('\n');
  return (
    `💳 *Pay Now — Order ${orderId}*\n\n` +
    `${itemList}\n\n` +
    `*Total: RM${amountRm}*\n\n` +
    `Tap below to pay securely:\n${paymentUrl}\n\n` +
    `_Payment methods: DuitNow QR, FPX, Touch 'n Go_\n` +
    `_Link expires in 30 minutes_`
  );
}

export default router;
