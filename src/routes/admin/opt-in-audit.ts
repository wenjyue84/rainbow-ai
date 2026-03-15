/**
 * Admin API: WhatsApp Marketing Opt-In Audit Trail (US-979)
 *
 * GET  /opt-in-audit/check/:phone  — Check opt-in status for a contact
 * POST /opt-in-audit/double-optin  — Record a confirmed double opt-in
 * GET  /opt-in-audit/export        — Download opt-in audit CSV for compliance
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  checkOptInBeforeMarketingSend,
  recordDoubleOptIn,
  exportOptInAuditRecords,
} from '../../lib/opt-in-audit.js';
import { badRequest, ok, serverError } from './http-utils.js';

const router = Router();

// GET /opt-in-audit/check/:phone — check if contact has documented consent
router.get('/opt-in-audit/check/:phone', async (req: Request, res: Response) => {
  const phone = decodeURIComponent((req.params.phone as string) ?? '');
  if (!phone) {
    badRequest(res, 'phone parameter is required');
    return;
  }

  const profileId = req.headers['x-profile-id'] as string | undefined;

  try {
    const result = await checkOptInBeforeMarketingSend(phone, profileId);
    ok(res, result);
  } catch (err: any) {
    serverError(res, err);
  }
});

// POST /opt-in-audit/double-optin — record confirmed double opt-in
// Body: { phone: string }
router.post('/opt-in-audit/double-optin', async (req: Request, res: Response) => {
  const { phone } = req.body as { phone?: string };
  if (!phone || typeof phone !== 'string') {
    badRequest(res, 'phone (string) is required');
    return;
  }

  const profileId = req.headers['x-profile-id'] as string | undefined;

  try {
    await recordDoubleOptIn(phone, profileId);
    ok(res, { success: true, phone });
  } catch (err: any) {
    serverError(res, err);
  }
});

// GET /opt-in-audit/export — CSV export for compliance review
// Query: ?profile=pelangi&limit=5000
router.get('/opt-in-audit/export', async (req: Request, res: Response) => {
  const profileId = (req.query.profile as string | undefined)
    ?? (req.headers['x-profile-id'] as string | undefined);
  const limit = Math.min(50000, Math.max(1, parseInt(req.query.limit as string) || 10000));

  try {
    const records = await exportOptInAuditRecords(profileId, limit);

    // Build CSV
    const header = 'JID,profile_id,opt_in_method,opt_in_at,opt_in_channel\n';
    const rows = records.map(r => {
      const escapeCsv = (v: string | null | undefined) => {
        if (v == null) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"` : s;
      };
      return [
        escapeCsv(r.jid),
        escapeCsv(r.profileId),
        escapeCsv(r.optInMethod),
        r.optInAt ? r.optInAt.toISOString() : '',
        escapeCsv(r.optInChannel),
      ].join(',');
    });

    const csv = header + rows.join('\n');
    const filename = `opt-in-audit${profileId ? `-${profileId}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err: any) {
    serverError(res, err);
  }
});

export default router;
