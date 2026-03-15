/**
 * Self-service data portability endpoint (US-894 — PDPA 2024 Phase 3)
 *
 * Public (no admin auth). Guests request their own data by phone number
 * and verify ownership via a 6-digit OTP sent to their WhatsApp.
 *
 * POST /api/data-portability/request   — send OTP to phone
 * POST /api/data-portability/verify    — verify OTP and download data
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { dbReady, pool } from '../../lib/db.js';
import { sendWhatsAppMessage } from '../../lib/baileys-client.js';
import { canonicalPhoneKey } from '../../assistant/conversation-db.js';
import {
  fetchGuestData,
  buildJsonPayload,
  buildMessageCsv,
  ensureAuditTable,
} from '../admin/gdpr-data-export.js';

const router = Router();

// ─── OTP Store (in-memory, 10-minute TTL) ───────────────────────────

interface OtpEntry {
  code: string;
  phone: string;
  expiresAt: number;
  attempts: number;
}

const otpStore = new Map<string, OtpEntry>();
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;

function generateOtp(): string {
  // Cryptographically random 6-digit code
  return String(crypto.randomInt(100_000, 999_999));
}

function cleanExpiredOtps(): void {
  const now = Date.now();
  for (const [key, entry] of otpStore) {
    if (entry.expiresAt < now) otpStore.delete(key);
  }
}

// Periodic cleanup every 5 minutes
setInterval(cleanExpiredOtps, 5 * 60 * 1000).unref();

// ─── Rate Limiting ──────────────────────────────────────────────────

const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 OTP requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests. Please try again later.' },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please try again later.' },
});

// ─── POST /request — Send OTP ───────────────────────────────────────

router.post('/request', otpRequestLimiter, async (req: Request, res: Response) => {
  const { phone } = req.body || {};
  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ error: 'phone is required' });
  }

  const key = canonicalPhoneKey(phone);
  if (!/^\d{10,15}$/.test(key)) {
    return res.status(400).json({ error: 'Invalid phone number format' });
  }

  const code = generateOtp();
  otpStore.set(key, {
    code,
    phone: key,
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  });

  // Send OTP via WhatsApp
  try {
    const jid = `${key}@s.whatsapp.net`;
    await sendWhatsAppMessage(
      jid,
      `🔐 Your data export verification code is: *${code}*\n\nThis code expires in 10 minutes. If you did not request this, please ignore this message.`
    );
    console.log(`[Data Portability] OTP sent to ${key.substring(0, 4)}****`);
  } catch (err: any) {
    console.error('[Data Portability] Failed to send OTP via WhatsApp:', err.message);
    // Still return success to avoid phone enumeration
  }

  res.json({
    status: 'otp_sent',
    message: 'A verification code has been sent to your WhatsApp. It is valid for 10 minutes.',
    expires_in_seconds: OTP_TTL_MS / 1000,
  });
});

// ─── POST /verify — Verify OTP & Export Data ────────────────────────

router.post('/verify', otpVerifyLimiter, async (req: Request, res: Response) => {
  const { phone, code, format: formatParam } = req.body || {};
  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ error: 'phone is required' });
  }
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code is required' });
  }

  const format = (formatParam || 'json').toLowerCase();
  if (format !== 'json' && format !== 'csv') {
    return res.status(400).json({ error: 'format must be "json" or "csv"' });
  }

  const key = canonicalPhoneKey(phone);
  const entry = otpStore.get(key);

  if (!entry || entry.expiresAt < Date.now()) {
    otpStore.delete(key);
    return res.status(401).json({ error: 'OTP expired or not found. Please request a new code.' });
  }

  entry.attempts++;
  if (entry.attempts > MAX_OTP_ATTEMPTS) {
    otpStore.delete(key);
    return res.status(429).json({ error: 'Too many failed attempts. Please request a new code.' });
  }

  // Timing-safe comparison
  const codeBuf = Buffer.from(code.trim());
  const expectedBuf = Buffer.from(entry.code);
  if (codeBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(codeBuf, expectedBuf)) {
    return res.status(401).json({ error: 'Invalid verification code.' });
  }

  // OTP verified — delete it (single use)
  otpStore.delete(key);

  const ready = await dbReady;
  if (!ready) return res.status(503).json({ error: 'Database not available' });

  const jidHash = crypto.createHash('sha256').update(key).digest('hex');
  const generatedAt = new Date().toISOString();

  try {
    const data = await fetchGuestData(phone);

    if (!data.hasAnyData) {
      return res.status(404).json({ error: 'No data found for this phone number.' });
    }

    // Log to audit table with action='portability' (US-894)
    try {
      await ensureAuditTable();
      await pool.query(
        `INSERT INTO gdpr_audit_log (jid_hash, requested_by, action, completed_at)
         VALUES ($1, $2, 'portability', NOW())`,
        [jidHash, 'self-service']
      );
    } catch (auditErr) {
      console.error('[Data Portability] Audit log write failed (export still proceeding):', auditErr);
    }

    console.log(`[Data Portability] Self-service export (${format}) for ${key.substring(0, 4)}****: ${data.messages.length} msgs`);

    if (format === 'csv') {
      const csv = buildMessageCsv(data.messages);
      const filename = `data-export-${jidHash.substring(0, 16)}.csv`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(csv);
    }

    const exportPayload = buildJsonPayload(phone, data, generatedAt);
    const filename = `data-export-${jidHash.substring(0, 16)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportPayload);
  } catch (error: any) {
    console.error('[Data Portability] Export failed:', error.message);
    return res.status(500).json({ error: 'Export failed. Please try again.' });
  }
});

export default router;
