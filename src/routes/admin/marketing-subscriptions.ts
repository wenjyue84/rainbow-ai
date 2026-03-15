/**
 * Admin API: Marketing Subscription Management (US-969)
 *
 * POST   /marketing-subscriptions        — Add phone to marketing list (triggers double opt-in)
 * GET    /marketing-subscriptions        — List subscriptions with consent status
 * GET    /marketing-subscriptions/:phone — Get consent status for a single contact
 * DELETE /marketing-subscriptions/:phone — Revoke marketing consent
 * POST   /marketing-subscriptions/expire — Manually trigger pending consent expiry
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  initiateDoubleOptIn,
  confirmMarketingOptIn,
  revokeMarketingConsent,
  getMarketingConsentRecord,
  listMarketingSubscriptions,
  expirePendingConsents,
  isAllowedToReceiveMarketing,
  type ConsentStatus,
} from '../../lib/marketing-optin.js';
import { badRequest, ok, serverError } from './http-utils.js';

const router = Router();

// POST /marketing-subscriptions — add phone to marketing list
// Body: { phone: string, channel?: string, collectedVia?: string }
router.post('/marketing-subscriptions', async (req: Request, res: Response) => {
  const { phone, channel, collectedVia } = req.body as {
    phone?: string;
    channel?: string;
    collectedVia?: string;
  };

  if (!phone || typeof phone !== 'string') {
    badRequest(res, 'phone (string) is required');
    return;
  }

  const profileId = (req.headers['x-profile-id'] as string | undefined) ?? 'pelangi';
  const validChannels = ['checkin', 'web_form', 'admin_add', 'qr_code'];
  const resolvedChannel = validChannels.includes(channel ?? '') ? channel! : 'admin_add';

  try {
    const record = await initiateDoubleOptIn(phone, profileId, resolvedChannel, collectedVia);
    if (!record) {
      serverError(res, new Error('Failed to create subscription record'));
      return;
    }
    if (record.consentStatus === 'revoked') {
      res.status(409).json({
        success: false,
        error: 'Contact has previously revoked marketing consent and cannot be re-added',
        consentStatus: record.consentStatus,
        revokedAt: record.revokedAt,
      });
      return;
    }
    ok(res, {
      success: true,
      message: 'Double opt-in initiated — confirmation template should be sent via WhatsApp',
      record,
    });
  } catch (err: any) {
    serverError(res, err);
  }
});

// GET /marketing-subscriptions — list all subscriptions
// Query: ?profile=pelangi&status=pending&limit=200
router.get('/marketing-subscriptions', async (req: Request, res: Response) => {
  const profileId = (req.query.profile as string | undefined)
    ?? (req.headers['x-profile-id'] as string | undefined);
  const status = req.query.status as ConsentStatus | undefined;
  const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit as string) || 500));

  const validStatuses: ConsentStatus[] = ['pending', 'confirmed', 'revoked', 'expired'];
  const resolvedStatus = validStatuses.includes(status as any) ? status : undefined;

  try {
    const records = await listMarketingSubscriptions(profileId, resolvedStatus, limit);
    ok(res, { success: true, count: records.length, records });
  } catch (err: any) {
    serverError(res, err);
  }
});

// GET /marketing-subscriptions/:phone — single contact status
router.get('/marketing-subscriptions/:phone', async (req: Request, res: Response) => {
  const phone = decodeURIComponent(req.params.phone as string);
  if (!phone) {
    badRequest(res, 'phone parameter is required');
    return;
  }

  const profileId = (req.headers['x-profile-id'] as string | undefined) ?? 'pelangi';

  try {
    const record = await getMarketingConsentRecord(phone, profileId);
    const allowed = await isAllowedToReceiveMarketing(phone, profileId);
    ok(res, { success: true, record, allowed });
  } catch (err: any) {
    serverError(res, err);
  }
});

// DELETE /marketing-subscriptions/:phone — revoke marketing consent
router.delete('/marketing-subscriptions/:phone', async (req: Request, res: Response) => {
  const phone = decodeURIComponent(req.params.phone as string);
  if (!phone) {
    badRequest(res, 'phone parameter is required');
    return;
  }

  const profileId = (req.headers['x-profile-id'] as string | undefined) ?? 'pelangi';

  try {
    const revoked = await revokeMarketingConsent(phone, profileId);
    ok(res, { success: true, revoked, phone });
  } catch (err: any) {
    serverError(res, err);
  }
});

// POST /marketing-subscriptions/expire — manually trigger expiry
router.post('/marketing-subscriptions/expire', async (_req: Request, res: Response) => {
  try {
    const count = await expirePendingConsents();
    ok(res, { success: true, expired: count });
  } catch (err: any) {
    serverError(res, err);
  }
});

// POST /marketing-subscriptions/:phone/confirm — admin-confirm an opt-in (testing/override)
router.post('/marketing-subscriptions/:phone/confirm', async (req: Request, res: Response) => {
  const phone = decodeURIComponent(req.params.phone as string);
  if (!phone) {
    badRequest(res, 'phone parameter is required');
    return;
  }

  const profileId = (req.headers['x-profile-id'] as string | undefined) ?? 'pelangi';

  try {
    const confirmed = await confirmMarketingOptIn(phone, profileId);
    ok(res, { success: true, confirmed, phone });
  } catch (err: any) {
    serverError(res, err);
  }
});

export default router;
