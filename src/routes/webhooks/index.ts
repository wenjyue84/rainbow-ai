/**
 * webhooks/index.ts — Inbound webhook routes
 *
 * Handles POST payloads from:
 *  - Evolution API  (WhatsApp message delivery status events)
 *  - DIGIMAN API    (booking/checkin/checkout callback notifications)
 *  - Meta Cloud API (phone_number_quality_update events) — US-458
 *
 * All routes apply HMAC-SHA256 signature validation via validateWebhookSignature()
 * before any business logic is executed.
 *
 * US-442: Implement webhook signature validation for inbound admin API calls
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { validateWebhookSignature } from '../../lib/webhook-signature.js';
import { updateQualityState } from '../../lib/phone-quality.js';
import type { QualityRating, QualityStatus } from '../../lib/phone-quality.js';
import { notifyAdminQualityDegradation } from '../../lib/admin-notifier.js';

const router = Router();

// Load shared secret once at module initialisation so the "secret unset"
// warning appears at startup rather than on the first request.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';
const signatureGuard = validateWebhookSignature(WEBHOOK_SECRET);

// ─── Evolution API inbound webhook ─────────────────────────────────────────
// Evolution API POSTs message delivery events, connection status changes,
// and inbound message notifications to this endpoint.
router.post('/webhooks/evolution', signatureGuard, (req: Request, res: Response) => {
  // Acknowledge receipt immediately so Evolution does not retry.
  res.status(200).json({ ok: true });

  // TODO: route event types (message.upsert, message.update, connection.update)
  // into the message pipeline once Evolution API integration is enabled.
  // For now we log the event so it can be observed in production logs.
  const event = req.body as { event?: string; [key: string]: unknown };
  if (process.env.NODE_ENV !== 'production') {
    console.log('[webhook:evolution] received event:', event?.event ?? '(no event field)');
  }
});

// ─── DIGIMAN API callback webhook ──────────────────────────────────────────
// DIGIMAN API POSTs reservation lifecycle callbacks (booking created, check-in
// confirmed, check-out completed) to this endpoint.
router.post('/webhooks/digiman', signatureGuard, (req: Request, res: Response) => {
  // Acknowledge receipt immediately.
  res.status(200).json({ ok: true });

  // TODO: dispatch to notification handlers (checkin-notify, checkout-notify, etc.)
  // once DIGIMAN webhook support is enabled.
  const event = req.body as { type?: string; [key: string]: unknown };
  if (process.env.NODE_ENV !== 'production') {
    console.log('[webhook:digiman] received event:', event?.type ?? '(no type field)');
  }
});

// ─── Meta Cloud API: phone_number_quality_update webhook (US-458) ───────────
// Meta POSTs phone number quality updates when the quality rating transitions
// between GREEN/YELLOW/RED or when status changes to FLAGGED/RESTRICTED.
// Must be subscribed in the Meta App Dashboard alongside the messages field.
router.post('/webhooks/meta/quality', signatureGuard, (req: Request, res: Response) => {
  // Acknowledge receipt immediately so Meta does not retry.
  res.status(200).json({ ok: true });

  const body = req.body as {
    phone_number?: string;
    event?: string;        // FLAGGED, UNFLAGGED, QUALITY_SCORE_CHANGE
    quality?: string;      // GREEN, YELLOW, RED
    messaging_limit_tier?: string;
    profile_id?: string;   // Custom field to route to the right profile
    [key: string]: unknown;
  };

  const phoneNumber = body.phone_number;
  const event = body.event;
  const quality = (body.quality?.toUpperCase() ?? 'UNKNOWN') as QualityRating;
  const profileId = body.profile_id ?? 'pelangi';

  // Derive status from event
  let status: QualityStatus = 'CONNECTED';
  if (event === 'FLAGGED') {
    status = 'FLAGGED';
  } else if (event === 'UNFLAGGED') {
    status = 'CONNECTED';
  }
  // QUALITY_SCORE_CHANGE keeps current status but updates the rating

  console.warn(
    `[webhook:meta:quality] phone_number_quality_update: phone=${phoneNumber} event=${event} ` +
    `quality=${quality} status=${status} tier=${body.messaging_limit_tier} profile=${profileId}`
  );

  // Update quality state
  updateQualityState(profileId, {
    rating: quality,
    status,
    event: event ?? undefined,
    messagingLimitTier: body.messaging_limit_tier ?? undefined,
    phoneNumber: phoneNumber ?? undefined,
  }).catch(err =>
    console.error('[webhook:meta:quality] Failed to update quality state:', err.message)
  );

  // Notify admin on degradation (FLAGGED, RESTRICTED, or RED rating)
  if (status === 'FLAGGED' || status === 'RESTRICTED' || quality === 'RED') {
    notifyAdminQualityDegradation(profileId, quality, status, phoneNumber ?? 'unknown').catch(() => {});
  }
});

export default router;
