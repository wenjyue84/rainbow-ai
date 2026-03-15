/**
 * PDPA 2024 Phase 3 — Self-service data portability (US-894)
 *
 * Public (no admin auth) endpoints for guests to request their own data
 * using their phone number + a one-time WhatsApp verification code.
 *
 * POST /api/rainbow/portability/request
 *   Body: { phone: string }
 *   Sends a 6-digit OTP via WhatsApp. Valid for 10 minutes.
 *
 * GET /api/rainbow/portability/download?phone=X&otp=Y&format=json|csv
 *   Verifies the OTP and returns the data export.
 *   Logs to gdpr_audit_log with action='portability'.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { eq, and, isNull } from 'drizzle-orm';
import { db, dbReady, pool } from '../../lib/db.js';
import {
  rainbowMessages,
  rainbowConversations,
  rainbowConversationState,
  rainbowFeedback,
  intentPredictions,
  optOuts,
} from '../../../shared/schema-tables.js';
import { canonicalPhoneKey } from '../../assistant/conversation-db.js';
import { sendWhatsAppMessage } from '../../lib/whatsapp/index.js';
import { buildMessageCsv } from '../admin/gdpr-data-export.js';

const router = Router();

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

// In-memory OTP store: phone key -> { otp, expiresAt, used }
interface OtpRecord {
  otp: string;
  expiresAt: number;
  used: boolean;
}
const otpStore = new Map<string, OtpRecord>();

// Cleanup expired OTPs periodically
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore) {
    if (v.expiresAt < now || v.used) otpStore.delete(k);
  }
}, 5 * 60 * 1000);

// Rate limiter: max 3 OTP requests per phone per 15 minutes
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  keyGenerator: (req: Request) => {
    const phone = req.body?.phone as string | undefined;
    if (phone) return `portability-otp:${phone}`;
    return ipKeyGenerator(req);
  },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ error: 'Too many OTP requests. Please wait 15 minutes before trying again.' });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter: max 10 download attempts per IP per 15 minutes
const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ error: 'Too many download attempts. Please wait before retrying.' });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── POST /portability/request ────────────────────────────────────────────────

router.post('/portability/request', otpRequestLimiter, async (req: Request, res: Response) => {
  const { phone } = req.body as { phone?: string };
  if (!phone || typeof phone !== 'string' || phone.trim().length < 7) {
    return res.status(400).json({ error: 'phone is required' });
  }

  const ready = await dbReady;
  if (!ready) return res.status(503).json({ error: 'Service unavailable' });

  const key = canonicalPhoneKey(phone.trim());

  // Verify the phone has data (don't reveal existence via timing; use constant-time reply)
  const otp = Math.floor(100_000 + Math.random() * 900_000).toString();
  otpStore.set(key, { otp, expiresAt: Date.now() + OTP_TTL_MS, used: false });

  // Send OTP via WhatsApp (best-effort — we always respond 200 to avoid phone enumeration)
  try {
    const jid = `${key}@s.whatsapp.net`;
    const message =
      `Your Pelangi data export verification code is: *${otp}*\n\n` +
      `This code expires in 10 minutes. Use it at the data portability download link provided to you.\n\n` +
      `If you did not request this, you can ignore this message.`;
    await sendWhatsAppMessage(jid, message);
    console.log(`[Portability OTP] Sent to ${key.substring(0, 6)}...`);
  } catch (err: any) {
    // Log but don't fail — OTP is stored, guest may retry sending themselves
    console.error('[Portability OTP] WhatsApp send failed:', err.message);
  }

  return res.json({
    ok: true,
    message: 'Verification code sent via WhatsApp. It is valid for 10 minutes.',
    expires_in_seconds: Math.floor(OTP_TTL_MS / 1000),
  });
});

// ─── GET /portability/download ────────────────────────────────────────────────

router.get('/portability/download', downloadLimiter, async (req: Request, res: Response) => {
  const { phone, otp, format } = req.query as { phone?: string; otp?: string; format?: string };

  if (!phone || !otp) {
    return res.status(400).json({ error: 'phone and otp are required query parameters' });
  }

  const fmt = (format ?? 'json').toLowerCase();
  if (fmt !== 'json' && fmt !== 'csv') {
    return res.status(400).json({ error: 'format must be "json" or "csv"' });
  }

  const ready = await dbReady;
  if (!ready) return res.status(503).json({ error: 'Service unavailable' });

  const key = canonicalPhoneKey(String(phone).trim());
  const record = otpStore.get(key);

  // Constant-time OTP validation to prevent timing attacks
  const DUMMY_OTP = '000000';
  const providedOtp = String(otp).trim().substring(0, 6);
  const expectedOtp = record?.otp ?? DUMMY_OTP;
  const otpMatch = crypto.timingSafeEqual(
    Buffer.from(providedOtp.padEnd(6, '0')),
    Buffer.from(expectedOtp.padEnd(6, '0'))
  );

  if (!record || !otpMatch || record.used || record.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Invalid or expired verification code' });
  }

  // Mark OTP as used (single-use)
  record.used = true;

  const jidHash = crypto.createHash('sha256').update(key).digest('hex');
  const generatedAt = new Date().toISOString();

  try {
    const [messages, conversations, conversationState, feedback, predictions, optOutRecord] = await Promise.all([
      db.select().from(rainbowMessages).where(and(eq(rainbowMessages.phone, key), isNull(rainbowMessages.deletedAt))),
      db.select().from(rainbowConversations).where(and(eq(rainbowConversations.phone, key), isNull(rainbowConversations.deletedAt))),
      db.select().from(rainbowConversationState).where(eq(rainbowConversationState.phone, key)),
      db.select().from(rainbowFeedback).where(eq(rainbowFeedback.phoneNumber, key)),
      db.select().from(intentPredictions).where(eq(intentPredictions.phoneNumber, key)),
      db.select().from(optOuts).where(eq(optOuts.phone, key)),
    ]);

    const hasAnyData =
      messages.length > 0 || conversations.length > 0 || conversationState.length > 0 ||
      feedback.length > 0 || predictions.length > 0 || optOutRecord.length > 0;

    if (!hasAnyData) {
      return res.status(404).json({ error: 'No data found for this phone number' });
    }

    // Audit log (action='portability')
    try {
      await pool.query(
        `INSERT INTO gdpr_audit_log (jid_hash, requested_by, action, completed_at)
         VALUES ($1, $2, 'portability', NOW())`,
        [jidHash, 'self-service']
      );
    } catch (auditErr) {
      console.error('[Portability Download] Audit log write failed (continuing):', auditErr);
    }

    console.log(`[Portability Download] JID hash ${jidHash.substring(0, 12)}... format=${fmt} msgs=${messages.length}`);

    if (fmt === 'csv') {
      const csv = buildMessageCsv(messages);
      const filename = `my-data-${jidHash.substring(0, 16)}.csv`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(csv);
    }

    // JSON
    const exportPayload = {
      generated_at: generatedAt,
      retention_policy: {
        summary: 'Data is retained for up to 2 years from last activity unless an erasure request is submitted.',
      },
      data: {
        messages: messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          intent: m.intent,
          confidence: m.confidence,
          source: m.source,
          profile_id: m.profileId,
        })),
        conversations: conversations.map(c => ({
          push_name: c.pushName,
          instance_id: c.instanceId,
          profile_id: c.profileId,
          status: c.status,
          created_at: c.createdAt,
          updated_at: c.updatedAt,
        })),
        conversation_state: conversationState.map(s => ({
          push_name: s.pushName,
          language: s.language,
          last_intent: s.lastIntent,
          profile_id: s.profileId,
          created_at: s.createdAt,
          last_active_at: s.lastActiveAt,
        })),
        feedback: feedback.map(f => ({
          id: f.id,
          rating: f.rating,
          feedback_text: f.feedbackText,
          created_at: f.createdAt,
        })),
        opt_out_status: optOutRecord.length > 0
          ? {
            opted_out_at: optOutRecord[0]!.optedOutAt,
            opted_in_at: optOutRecord[0]!.optedInAt,
            is_opted_out: optOutRecord[0]!.optedInAt === null,
          }
          : null,
      },
      summary: {
        total_messages: messages.length,
        total_conversations: conversations.length,
        total_feedback_records: feedback.length,
      },
    };

    const filename = `my-data-${jidHash.substring(0, 16)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    return res.json(exportPayload);
  } catch (error: any) {
    console.error('[Portability Download] Failed:', error.message);
    return res.status(500).json({ error: 'Export failed. Please try again later.' });
  }
});

export default router;
