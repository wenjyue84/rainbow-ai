/**
 * webhooks/index.ts — Inbound webhook routes
 *
 * Handles POST payloads from:
 *  - Evolution API  (WhatsApp message delivery status events)
 *  - DIGIMAN API    (booking/checkin/checkout callback notifications)
 *  - Meta Cloud API (phone_number_quality_update events) — US-458
 *  - Meta Cloud API (account_update events) — US-479
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
} from '../../lib/admin-notifier.js';
import { db } from '../../lib/db.js';
import { templateQualityEvents } from '../../../shared/schema.js';
import { recordAccountViolation, recordAccountRestriction } from '../../lib/account-status.js';
import { dispatchWebhookEvent, UnrecognizedEventError } from './handlers.js';
import { applyPosStockUpdate } from '../../lib/menu-items-store.js';

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

// ─── POS inventory stock sync webhook (US-949) ─────────────────────────────
//
// POST /webhooks/pos/inventory
//
// Accepts stock updates from a POS system. When an item quantity reaches 0,
// the chatbot menu is updated (within the 60-second in-memory propagation SLA).
//
// Payload:
//   { "profile": "makan-moments", "items": [{ "name": "Nasi Lemak", "quantity": 0 }] }
//
// Authentication: shared WEBHOOK_SECRET via x-webhook-signature header.

router.post('/webhooks/pos/inventory', signatureGuard, async (req: Request, res: Response) => {
  const { profile, items } = req.body as {
    profile?: string;
    items?: Array<{ name?: string; sku?: string; quantity: number }>;
  };

  if (!profile || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'profile and items[] are required' });
    return;
  }

  // Validate item entries
  const invalid = items.filter(i => i.quantity === undefined || i.quantity === null);
  if (invalid.length > 0) {
    res.status(400).json({ error: 'Each item must include a quantity field' });
    return;
  }

  try {
    const result = await applyPosStockUpdate(profile, items);
    console.log(
      `[webhook:pos:inventory] profile=${profile} updated=${result.updated.length} not_found=${result.not_found.length}`
    );
    res.status(200).json({
      ok: true,
      updated: result.updated,
      not_found: result.not_found,
    });
  } catch (err: any) {
    console.error('[webhook:pos:inventory] Error applying stock update:', err.message);
    res.status(500).json({ error: 'Internal error applying stock update' });
  }
});

export default router;
