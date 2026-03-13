/**
 * Admin API: Consent record lookup (US-424)
 *
 * GET /api/admin/consent/:jid
 *   Returns the consent record for the given JID (phone number or WhatsApp JID).
 *   The JID is hashed (SHA-256) before lookup — raw phone numbers are never stored.
 *
 * 404  if no consent record exists for the JID.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getConsentByJid, hashJid } from '../../assistant/consent.js';
import { badRequest, notFound, serverError } from './http-utils.js';

const router = Router();

// GET /api/admin/consent/:jid
router.get('/consent/:jid', async (req: Request, res: Response) => {
  const jidParam = decodeURIComponent(req.params.jid ?? '');
  if (!jidParam) return badRequest(res, 'JID parameter is required');

  try {
    const record = await getConsentByJid(jidParam);
    if (!record) return notFound(res, `Consent record for ${jidParam}`);

    res.json({
      jid_hash: record.jid_hash,
      profile_id: record.profile_id,
      consent_method: record.consent_method,
      first_contact_at: record.first_contact_at,
      ip_address: record.ip_address,
    });
  } catch (error: any) {
    console.error('[Consent Admin] Lookup failed:', error.message);
    return serverError(res, error);
  }
});

export default router;
