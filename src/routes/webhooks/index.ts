/**
 * webhooks/index.ts — Inbound webhook routes
 *
 * Handles POST payloads from:
 *  - Evolution API  (WhatsApp message delivery status events)
 *  - DIGIMAN API    (booking/checkin/checkout callback notifications)
 *  - Meta Cloud API (phone_number_quality_update events) — US-458
 *  - Meta Cloud API (account_update events) — US-479
 *  - Meta Cloud API (business_capability_update events) — US-908
 *  - Meta Cloud API (inbound messages with BSUID support) — US-926
 *
 * All routes apply HMAC-SHA256 signature validation via validateWebhookSignature()
 * before any business logic is executed.
 *
 * US-442: Implement webhook signature validation for inbound admin API calls
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { validateWebhookSignature, validateMetaSignature } from '../../lib/webhook-signature.js';
import { updateQualityState } from '../../lib/phone-quality.js';
import type { QualityRating, QualityStatus } from '../../lib/phone-quality.js';
import {
  notifyAdminQualityDegradation,
  notifyAdminAccountViolation,
  notifyAdminAccountRestriction,
  notifyAdminTemplatePaused,
  notifyAdminCapabilityUpdate,
} from '../../lib/admin-notifier.js';
import { db } from '../../lib/db.js';
import { sql } from 'drizzle-orm';
import { appSettings, templateQualityEvents } from '../../../shared/schema.js';
import { recordAccountViolation, recordAccountRestriction } from '../../lib/account-status.js';
import { dispatchWebhookEvent, UnrecognizedEventError } from './handlers.js';
import { parseCloudApiMessages } from './meta-messages.js';
import { persistRawEvent, markRawEventProcessed } from '../../lib/webhook-raw-events.js';

const router = Router();

// Load shared secret once at module initialisation so the "secret unset"
// warning appears at startup rather than on the first request.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';
const signatureGuard = validateWebhookSignature(WEBHOOK_SECRET);

// Meta Cloud API uses its own app secret for HMAC validation (US-844).
const META_APP_SECRET = process.env.META_APP_SECRET ?? '';
const metaSignatureGuard = validateMetaSignature(META_APP_SECRET);

// ─── Evolution API inbound webhook ─────────────────────────────────────────
// Evolution API POSTs message delivery events, connection status changes,
// and inbound message notifications to this endpoint.
router.post('/webhooks/evolution', signatureGuard, (req: Request, res: Response) => {
  // Acknowledge receipt immediately so Evolution does not retry.
  res.status(200).json({ ok: true });

  // US-895: Persist raw payload before any processing (fire-and-forget)
  persistRawEvent('evolution', req.body).catch(() => {});

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
  // Acknowledge receipt immediately so DIGIMAN does not retry.
  res.status(200).json({ ok: true });

  // US-895: Persist raw payload before any processing (fire-and-forget)
  persistRawEvent('digiman', req.body).catch(() => {});

  const event = req.body as { type?: string; [key: string]: unknown };
  const eventType = event?.type ?? '';

  console.log('[webhook:digiman] received event:', eventType || '(no type field)');

  if (!eventType) return;

  // Dispatch to handler registry; errors are logged but must not crash the server
  // since we already sent 200. Unknown types are logged as warnings.
  dispatchWebhookEvent({ ...event, type: eventType }).catch((err: unknown) => {
    if (err instanceof UnrecognizedEventError) {
      console.warn(`[webhook:digiman] ${err.message} — payload dropped`);
    } else {
      console.error('[webhook:digiman] Handler error for event:', eventType, err);
    }
  });
});

// ─── Generic event webhook (US-821) ─────────────────────────────────────────
// Synchronous event routing with handler registry dispatch.
// Callers receive a meaningful HTTP status rather than a silent 200.
//
//   POST /webhooks/events
//   Body: { "type": "<event-type>", ...payload }
//
// Returns:
//   200  – handler ran successfully
//   422  – event type not registered
//   500  – handler threw an error
router.post('/webhooks/events', signatureGuard, async (req: Request, res: Response) => {
  const event = req.body as { type?: string; [key: string]: unknown };
  const eventType = event?.type;

  if (!eventType) {
    res.status(400).json({ error: 'Missing required field: type' });
    return;
  }

  // US-895: Persist raw payload before any processing (fire-and-forget)
  persistRawEvent('events', req.body).catch(() => {});

  try {
    await dispatchWebhookEvent({ ...event, type: eventType });
    res.status(200).json({ ok: true, event: eventType });
  } catch (err: unknown) {
    if (err instanceof UnrecognizedEventError) {
      console.warn(`[webhook:events] ${err.message}`);
      res.status(422).json({ error: err.message, event: eventType });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[webhook:events] Handler error for event:', eventType, err);
      res.status(500).json({ error: 'Handler error', event: eventType });
    }
  }
});

// ─── Meta Cloud API: phone_number_quality_update webhook (US-458) ───────────
// Meta POSTs phone number quality updates when the quality rating transitions
// between GREEN/YELLOW/RED or when status changes to FLAGGED/RESTRICTED.
// Must be subscribed in the Meta App Dashboard alongside the messages field.
router.post('/webhooks/meta/quality', metaSignatureGuard, (req: Request, res: Response) => {
  // Acknowledge receipt immediately so Meta does not retry.
  res.status(200).json({ ok: true });

  // US-895: Persist raw payload before any processing (fire-and-forget)
  persistRawEvent('meta:quality', req.body).catch(() => {});

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
  } else if (event === 'RESTRICTED') {
    status = 'RESTRICTED';
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

// ─── Meta Cloud API: account_update webhook (US-479) ────────────────────────
// Meta POSTs account_update events when an account_update policy violation
// (ACCOUNT_VIOLATION) or account restriction (ACCOUNT_RESTRICTION) is imposed.
// Must be subscribed in the Meta App Dashboard alongside the messages field.
//
// Payload shape:
//   changes[0].field  = 'account_update'
//   changes[0].value.event = 'ACCOUNT_VIOLATION' | 'ACCOUNT_RESTRICTION'
//   changes[0].value.violation_info.violation_type  (for ACCOUNT_VIOLATION)
//   changes[0].value.restriction_info[]             (for ACCOUNT_RESTRICTION)
router.post('/webhooks/meta/account', metaSignatureGuard, (req: Request, res: Response) => {
  // Acknowledge receipt immediately so Meta does not retry.
  res.status(200).json({ ok: true });

  // US-895: Persist raw payload before any processing (fire-and-forget)
  persistRawEvent('meta:account', req.body).catch(() => {});

  const body = req.body as {
    entry?: Array<{
      changes?: Array<{
        field?: string;
        value?: {
          event?: string;
          phone_number?: string;
          violation_info?: { violation_type?: string };
          restriction_info?: Array<{ restriction_type?: string; expiration?: number }>;
        };
      }>;
    }>;
    [key: string]: unknown;
  };

  const entries = body.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'account_update') continue;

      const value = change.value;
      if (!value) continue;

      const event = value.event ?? 'UNKNOWN';
      const phoneNumber = value.phone_number ?? 'unknown';

      if (event === 'ACCOUNT_VIOLATION') {
        const violationType = value.violation_info?.violation_type ?? 'UNKNOWN_VIOLATION';

        console.warn(
          `[webhook:meta:account] ACCOUNT_VIOLATION: phone=${phoneNumber} violation_type=${violationType}`
        );

        recordAccountViolation(violationType, phoneNumber);
        notifyAdminAccountViolation(phoneNumber, violationType).catch(() => {});

      } else if (event === 'ACCOUNT_RESTRICTION') {
        const rawRestrictions = value.restriction_info ?? [];
        const restrictions = rawRestrictions.map(r => ({
          restrictionType: r.restriction_type ?? 'UNKNOWN',
          expiration: r.expiration ?? null,
        }));

        const expiryList = restrictions
          .map(r => `${r.restrictionType}@${r.expiration ?? 'indefinite'}`)
          .join(', ');
        console.warn(
          `[webhook:meta:account] ACCOUNT_RESTRICTION: phone=${phoneNumber} restrictions=[${expiryList}]`
        );

        recordAccountRestriction(restrictions, phoneNumber);
        notifyAdminAccountRestriction(phoneNumber, restrictions).catch(() => {});

      } else {
        console.warn(
          `[webhook:meta:account] account_update: phone=${phoneNumber} event=${event} (unhandled)`
        );
      }
    }
  }
});

// ─── Meta Cloud API: message_template_status_update webhook (US-831) ──────
// Meta POSTs message_template_status_update when a template status transitions
// (e.g. APPROVED → PAUSED, PAUSED → DISABLED). Must be subscribed in the
// Meta App Dashboard alongside the messages field.
//
// Payload shape (inside entry[].changes[]):
//   field = 'message_template_status_update'
//   value.message_template_name = template name
//   value.event = 'APPROVED' | 'PAUSED' | 'DISABLED' | etc.
//   value.previous_category / value.new_category (optional)
//   value.reason (optional — e.g. 'LOW_QUALITY')
router.post('/webhooks/meta/template-status', metaSignatureGuard, (req: Request, res: Response) => {
  // Acknowledge receipt immediately so Meta does not retry.
  res.status(200).json({ ok: true });

  // US-895: Persist raw payload before any processing (fire-and-forget)
  persistRawEvent('meta:template-status', req.body).catch(() => {});

  const body = req.body as {
    entry?: Array<{
      changes?: Array<{
        field?: string;
        value?: {
          message_template_name?: string;
          event?: string;
          previous_category?: string;
          new_category?: string;
          reason?: string;
        };
      }>;
    }>;
    [key: string]: unknown;
  };

  const entries = body.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'message_template_status_update') continue;

      const value = change.value;
      if (!value) continue;

      const templateName = value.message_template_name ?? 'unknown';
      const newStatus = value.event ?? 'UNKNOWN';
      const reason = value.reason ?? undefined;

      console.warn(
        `[webhook:meta:template-status] template=${templateName} status=${newStatus} reason=${reason ?? 'none'}`
      );

      // Persist to template_quality_events table
      db.insert(templateQualityEvents).values({
        templateName,
        oldStatus: null,
        newStatus,
        reason: reason ?? null,
        profileId: 'pelangi',
      }).catch(err =>
        console.error('[webhook:meta:template-status] Failed to persist event:', err.message)
      );

      // Notify admin on PAUSED or DISABLED
      if (newStatus === 'PAUSED' || newStatus === 'DISABLED') {
        notifyAdminTemplatePaused(templateName, newStatus, reason).catch(() => {});
      }
    }
  }
});

// ─── Meta Cloud API: business_capability_update webhook (US-908) ─────────
// Meta POSTs business_capability_update when the portfolio messaging tier limit
// or max phone numbers changes. Must be subscribed in the Meta App Dashboard.
//
// Payload shape (inside entry[].changes[]):
//   field = 'business_capability_update'
//   value.max_daily_conversation_per_phone = <number>  (the new tier limit)
//   value.max_phone_numbers_per_business   = <number>
router.post('/webhooks/meta/capability', metaSignatureGuard, async (req: Request, res: Response) => {
  // Acknowledge receipt immediately so Meta does not retry.
  res.status(200).json({ ok: true });

  // US-895: Persist raw payload before any processing (fire-and-forget)
  persistRawEvent('meta:capability', req.body).catch(() => {});

  const body = req.body as {
    entry?: Array<{
      changes?: Array<{
        field?: string;
        value?: {
          max_daily_conversation_per_phone?: number;
          max_phone_numbers_per_business?: number;
        };
      }>;
    }>;
    [key: string]: unknown;
  };

  const entries = body.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'business_capability_update') continue;

      const value = change.value;
      if (!value) continue;

      const maxDaily = value.max_daily_conversation_per_phone;
      const maxPhones = value.max_phone_numbers_per_business ?? null;

      // Map max_daily_conversation_per_phone to a tier string
      const newTier = maxDaily != null ? String(maxDaily) : 'unknown';

      console.warn(
        `[webhook:meta:capability] business_capability_update: tier=${newTier} maxPhones=${maxPhones}`
      );

      // Read current tier before updating
      let previousTier: string | null = null;
      try {
        const { getCurrentTier } = await import('../admin/messaging-limits.js');
        previousTier = await getCurrentTier();
      } catch {
        // Non-critical — previousTier stays null
      }

      // Update messaging tier in app_settings DB
      if (maxDaily != null) {
        try {
          const tierStr = String(maxDaily);
          const now = new Date().toISOString();

          await db.insert(appSettings)
            .values({
              key: 'rainbow_portfolio_tier',
              value: tierStr,
              description: 'WhatsApp Business Portfolio messaging tier',
              updatedBy: 'webhook:business_capability_update',
            })
            .onConflictDoUpdate({
              target: [appSettings.key],
              set: { value: tierStr, updatedBy: 'webhook:business_capability_update', updatedAt: sql`NOW()` },
            });

          await db.insert(appSettings)
            .values({
              key: 'rainbow_portfolio_tier_updated_at',
              value: now,
              description: 'When the portfolio tier was last updated',
              updatedBy: 'webhook:business_capability_update',
            })
            .onConflictDoUpdate({
              target: [appSettings.key],
              set: { value: now, updatedBy: 'webhook:business_capability_update', updatedAt: sql`NOW()` },
            });

          console.log(`[webhook:meta:capability] Updated portfolio tier to '${tierStr}' in app_settings`);
        } catch (err: any) {
          console.error('[webhook:meta:capability] Failed to update tier in DB:', err.message);
        }
      }

      // Store max phone numbers if provided
      if (maxPhones != null) {
        try {
          await db.insert(appSettings)
            .values({
              key: 'rainbow_max_phone_numbers',
              value: String(maxPhones),
              description: 'Max phone numbers allowed per WABA portfolio',
              updatedBy: 'webhook:business_capability_update',
            })
            .onConflictDoUpdate({
              target: [appSettings.key],
              set: { value: String(maxPhones), updatedBy: 'webhook:business_capability_update', updatedAt: sql`NOW()` },
            });
        } catch (err: any) {
          console.error('[webhook:meta:capability] Failed to update max phone numbers in DB:', err.message);
        }
      }

      // Notify admin of the capability change
      notifyAdminCapabilityUpdate(newTier, maxPhones, previousTier).catch(() => {});
    }
  }
});

// ─── KDS/POS kitchen acceptance webhook (US-881) ──────────────────────────
// The KDS/POS system POSTs back when the kitchen accepts an order.
// This closes the modification window so customers can no longer change it.
//
//   POST /webhooks/kds/accept
//   Body: { "orderId": "<order-id>", "sessionId": "<webchat-session-id>" }
//
// At least one of orderId or sessionId is required. If sessionId is provided,
// it is used directly to mark kitchen acceptance. If only orderId is provided,
// a reverse lookup finds the session (best-effort).
router.post('/webhooks/kds/accept', signatureGuard, async (req: Request, res: Response) => {
  // US-895: Persist raw payload before any processing (fire-and-forget)
  persistRawEvent('kds', req.body).catch(() => {});

  const { markKitchenAccepted } = await import('../../assistant/order-modification-store.js');

  const body = req.body as { orderId?: string; sessionId?: string };
  const sessionId = body.sessionId?.trim();
  const orderId = body.orderId?.trim();

  if (!sessionId && !orderId) {
    res.status(400).json({ error: 'Missing required field: sessionId or orderId' });
    return;
  }

  if (sessionId) {
    const accepted = markKitchenAccepted(sessionId);
    console.log(`[webhook:kds:accept] Kitchen accepted order for session=${sessionId} result=${accepted}`);
    res.status(200).json({ ok: true, accepted, sessionId });
    return;
  }

  // orderId-only: cannot reverse-lookup without a registry, so log and acknowledge
  console.warn(`[webhook:kds:accept] Received orderId=${orderId} without sessionId — cannot mark acceptance (no reverse lookup). Order will expire by timer.`);
  res.status(200).json({ ok: true, accepted: false, reason: 'sessionId required for real-time acceptance', orderId });
});

// ─── Meta Cloud API: Webhook verification (US-926) ──────────────────────────
// Meta requires a GET endpoint that echoes back hub.challenge when
// hub.mode === 'subscribe' and hub.verify_token matches our secret.
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? '';

router.get('/webhooks/meta/messages', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string | undefined;
  const token = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge'] as string | undefined;

  if (mode === 'subscribe' && token && token === META_VERIFY_TOKEN) {
    console.log('[webhook:meta:messages] Verification challenge accepted');
    res.status(200).send(challenge ?? '');
    return;
  }

  console.warn('[webhook:meta:messages] Verification failed — token mismatch or missing mode');
  res.status(403).send('Forbidden');
});

// ─── Meta Cloud API: Inbound messages with BSUID support (US-926) ───────────
// Meta POSTs inbound WhatsApp messages via the Cloud API webhook. Starting
// June 2026, payloads may include a user_id (BSUID) field alongside or
// instead of wa_id (phone number). This endpoint parses both identifiers
// and routes them into the existing message pipeline.
//
// Payload shape:
//   entry[].changes[].field = 'messages'
//   entry[].changes[].value.contacts[].wa_id   = phone (may be absent post-BSUID rollout)
//   entry[].changes[].value.contacts[].user_id = BSUID (new, present when user has username)
//   entry[].changes[].value.messages[].from     = phone or BSUID
router.post('/webhooks/meta/messages', metaSignatureGuard, async (req: Request, res: Response) => {
  // Acknowledge immediately to prevent Meta retries
  res.status(200).json({ ok: true });

  // US-895: Persist raw payload BEFORE any processing (fire-and-forget)
  const rawEventId = await persistRawEvent('meta:messages', req.body).catch(() => null);

  try {
    const incomingMessages = parseCloudApiMessages(req.body);

    if (incomingMessages.length === 0) return;

    // Attach rawEventId so DLQ entries can reference the original payload
    if (rawEventId) {
      for (const msg of incomingMessages) {
        msg.rawEventId = rawEventId;
      }
    }

    // Dynamically import the message handler to avoid circular deps at module load
    const { whatsappManager } = await import('../../lib/whatsapp/index.js');
    const handler = (whatsappManager as any).messageHandler;

    if (!handler) {
      console.warn('[webhook:meta:messages] No message handler registered — messages dropped');
      return;
    }

    for (const msg of incomingMessages) {
      try {
        await handler(msg);
      } catch (err: any) {
        console.error(`[webhook:meta:messages] Handler error for ${msg.from}:`, err.message);
      }
    }

    // Mark raw event as processed after all messages handled successfully
    if (rawEventId) {
      markRawEventProcessed(rawEventId).catch(() => {});
    }

    console.log(`[webhook:meta:messages] Processed ${incomingMessages.length} inbound message(s)`);
  } catch (err: any) {
    console.error('[webhook:meta:messages] Parse error:', err.message);
  }
});

export default router;
