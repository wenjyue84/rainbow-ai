/**
 * Admin API: WhatsApp Opt-In Consent Management (US-155)
 *
 * GET  /api/admin/whatsapp-consent/:phone     — Get opt-in status for a contact
 * PATCH /api/admin/whatsapp-consent/:phone    — Update opt-in status for a contact
 * GET  /api/admin/whatsapp-consent            — List all opt-in status records (paginated)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { pool } from '../../lib/db.js';
import { checkWhatsAppConsent, recordWhatsAppOptIn, recordWhatsAppOptOut } from '../../lib/whatsapp/consent-enforcement.js';
import { badRequest, notFound, ok, serverError } from './http-utils.js';
import { createModuleLogger } from '../../lib/logger.js';

const logger = createModuleLogger('WhatsAppConsentAdmin');
const router = Router();

// GET /api/admin/whatsapp-consent/:phone — Get opt-in status for a contact
router.get('/whatsapp-consent/:phone', async (req: Request, res: Response) => {
  const phone = decodeURIComponent((req.params.phone as string) ?? '');
  if (!phone) {
    badRequest(res, 'phone parameter is required');
    return;
  }

  const profileId = req.headers['x-profile-id'] as string | undefined;

  try {
    const consent = await checkWhatsAppConsent(phone, profileId);
    const cleanPhone = phone.replace(/[@a-z.]/g, '');

    if (!pool) {
      ok(res, { phone: cleanPhone, ...consent });
      return;
    }

    // Get additional details from database
    const { rows } = await pool.query<{
      whatsapp_opted_in: boolean;
      whatsapp_opted_in_at: Date | null;
      opt_in_method: string | null;
      opt_in_at: Date | null;
      opt_in_channel: string | null;
      push_name: string;
      profile_id: string;
    }>(
      `SELECT whatsapp_opted_in, whatsapp_opted_in_at, opt_in_method, opt_in_at, opt_in_channel, push_name, profile_id
       FROM rainbow_conversations
       WHERE phone = $1`,
      [cleanPhone]
    );

    if (rows.length === 0) {
      notFound(res, `Contact ${phone}`);
      return;
    }

    const row = rows[0];
    ok(res, {
      phone: cleanPhone,
      whatsappOptedIn: row.whatsapp_opted_in,
      whatsappOptedInAt: row.whatsapp_opted_in_at,
      optInMethod: row.opt_in_method,
      optInAt: row.opt_in_at,
      optInChannel: row.opt_in_channel,
      pushName: row.push_name,
      profileId: row.profile_id
    });
  } catch (error: any) {
    logger.error('Consent check failed:', { phone, error: error.message });
    serverError(res, error);
  }
});

// PATCH /api/admin/whatsapp-consent/:phone — Update opt-in status
// Body: { optedIn: boolean }
router.patch('/whatsapp-consent/:phone', async (req: Request, res: Response) => {
  const phone = decodeURIComponent((req.params.phone as string) ?? '');
  const { optedIn } = req.body as { optedIn?: boolean };

  if (!phone) {
    badRequest(res, 'phone parameter is required');
    return;
  }

  if (typeof optedIn !== 'boolean') {
    badRequest(res, 'optedIn (boolean) is required in request body');
    return;
  }

  const profileId = req.headers['x-profile-id'] as string | undefined;

  try {
    if (optedIn) {
      await recordWhatsAppOptIn(phone, profileId);
    } else {
      await recordWhatsAppOptOut(phone, profileId);
    }

    logger.info(`Consent status updated via admin`, {
      phone,
      optedIn,
      profileId,
      event: 'admin_consent_update'
    });

    ok(res, { success: true, phone, optedIn });
  } catch (error: any) {
    logger.error('Consent update failed:', { phone, error: error.message });
    serverError(res, error);
  }
});

// GET /api/admin/whatsapp-consent — List all opt-in records (paginated)
// Query: ?limit=50&offset=0&optedIn=true&profile=pelangi
router.get('/whatsapp-consent', async (req: Request, res: Response) => {
  if (!pool) {
    badRequest(res, 'Database not available');
    return;
  }

  try {
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const optedInFilter = req.query.optedIn ? req.query.optedIn === 'true' : undefined;
    const profileId = (req.query.profile as string | undefined)
      ?? (req.headers['x-profile-id'] as string | undefined);

    let whereClause = '1=1';
    const params: any[] = [];

    if (optedInFilter !== undefined) {
      whereClause += ` AND whatsapp_opted_in = $${params.length + 1}`;
      params.push(optedInFilter);
    }

    if (profileId) {
      whereClause += ` AND profile_id = $${params.length + 1}`;
      params.push(profileId);
    }

    // Get total count
    const { rows: countRows } = await pool.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM rainbow_conversations WHERE ${whereClause}`,
      params
    );
    const total = countRows[0]?.count ?? 0;

    // Get paginated records
    const { rows } = await pool.query<{
      phone: string;
      push_name: string;
      profile_id: string;
      whatsapp_opted_in: boolean;
      whatsapp_opted_in_at: Date | null;
      opt_in_method: string | null;
      opt_in_at: Date | null;
      updated_at: Date;
    }>(
      `SELECT phone, push_name, profile_id, whatsapp_opted_in, whatsapp_opted_in_at, opt_in_method, opt_in_at, updated_at
       FROM rainbow_conversations
       WHERE ${whereClause}
       ORDER BY whatsapp_opted_in_at DESC NULLS LAST
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    ok(res, {
      total,
      limit,
      offset,
      records: rows.map(r => ({
        phone: r.phone,
        pushName: r.push_name,
        profileId: r.profile_id,
        whatsappOptedIn: r.whatsapp_opted_in,
        whatsappOptedInAt: r.whatsapp_opted_in_at,
        optInMethod: r.opt_in_method,
        optInAt: r.opt_in_at,
        updatedAt: r.updated_at
      }))
    });
  } catch (error: any) {
    logger.error('Consent list failed:', { error: error.message });
    serverError(res, error);
  }
});

export default router;
