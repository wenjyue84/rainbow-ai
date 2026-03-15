/**
 * qr-campaigns.ts — QR Code Campaign Management (US-919)
 *
 * Admin endpoints for creating, managing, and generating WhatsApp QR codes
 * with pre-filled deep-link messages for table ordering, room check-in,
 * and marketing campaigns.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import QRCode from 'qrcode';
import { pool } from '../../lib/db.js';
import { ok, serverError } from './http-utils.js';

const router = Router();

// ─── Table Setup ────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS qr_campaigns (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        campaign_label VARCHAR(100),
        prefilled_message TEXT NOT NULL,
        context_type VARCHAR(50) DEFAULT 'general',
        context_value VARCHAR(255),
        profile_id VARCHAR(50) DEFAULT 'makan-moments',
        scan_count INT DEFAULT 0,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.warn('[QRCampaigns] Table ensure failed:', err.message);
  }
}

// ─── CRUD Endpoints ─────────────────────────────────────────────────

/**
 * GET /qr-campaigns — List all QR campaigns
 */
router.get('/qr-campaigns', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const profileId = req.query.profileId as string || undefined;
    const where = profileId ? 'WHERE profile_id = $1' : '';
    const params = profileId ? [profileId] : [];
    const result = await pool.query(
      `SELECT * FROM qr_campaigns ${where} ORDER BY created_at DESC`,
      params
    );
    ok(res, result.rows);
  } catch (err: any) {
    serverError(res, err);
  }
});

/**
 * POST /qr-campaigns — Create a new QR campaign
 * Body: { name, campaignLabel?, prefilledMessage, contextType?, contextValue?, profileId? }
 */
router.post('/qr-campaigns', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const { name, campaignLabel, prefilledMessage, contextType, contextValue, profileId } = req.body;

    if (!name || !prefilledMessage) {
      res.status(400).json({ error: 'name and prefilledMessage are required' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO qr_campaigns (name, campaign_label, prefilled_message, context_type, context_value, profile_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, campaignLabel || null, prefilledMessage, contextType || 'general', contextValue || null, profileId || 'makan-moments']
    );

    ok(res, result.rows[0]);
  } catch (err: any) {
    serverError(res, err);
  }
});

/**
 * PUT /qr-campaigns/:id — Update a QR campaign
 */
router.put('/qr-campaigns/:id', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const { id } = req.params;
    const { name, campaignLabel, prefilledMessage, contextType, contextValue, active } = req.body;

    const result = await pool.query(
      `UPDATE qr_campaigns SET
         name = COALESCE($2, name),
         campaign_label = COALESCE($3, campaign_label),
         prefilled_message = COALESCE($4, prefilled_message),
         context_type = COALESCE($5, context_type),
         context_value = COALESCE($6, context_value),
         active = COALESCE($7, active),
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, name, campaignLabel, prefilledMessage, contextType, contextValue, active]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'QR campaign not found' });
      return;
    }
    ok(res, result.rows[0]);
  } catch (err: any) {
    serverError(res, err);
  }
});

/**
 * DELETE /qr-campaigns/:id — Deactivate a QR campaign
 */
router.delete('/qr-campaigns/:id', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    await pool.query('UPDATE qr_campaigns SET active = FALSE WHERE id = $1', [req.params.id]);
    ok(res, { deleted: true });
  } catch (err: any) {
    serverError(res, err);
  }
});

/**
 * POST /qr-campaigns/:id/scan — Increment scan count (called when a QR referral is detected)
 */
router.post('/qr-campaigns/:id/scan', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    await pool.query('UPDATE qr_campaigns SET scan_count = scan_count + 1 WHERE id = $1', [req.params.id]);
    ok(res, { ok: true });
  } catch (err: any) {
    serverError(res, err);
  }
});

/**
 * GET /qr-campaigns/analytics — Scan analytics per QR code per time period
 */
router.get('/qr-campaigns/analytics', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const days = parseInt(req.query.days as string) || 30;

    // Get scan counts from conversations with qr_code referral source
    const result = await pool.query(
      `SELECT
         c.referral_source_id as source_id,
         qr.name as campaign_name,
         qr.campaign_label,
         qr.context_type,
         COUNT(*)::int as scan_count,
         MIN(c.created_at) as first_scan,
         MAX(c.created_at) as last_scan
       FROM rainbow_conversations c
       LEFT JOIN qr_campaigns qr ON qr.id::text = c.referral_source_id
       WHERE c.referral_source_type = 'qr_code'
         AND c.created_at >= NOW() - INTERVAL '1 day' * $1
       GROUP BY c.referral_source_id, qr.name, qr.campaign_label, qr.context_type
       ORDER BY scan_count DESC`,
      [days]
    );

    ok(res, result.rows);
  } catch (err: any) {
    serverError(res, err);
  }
});

/**
 * GET /qr-campaigns/:id/image — Generate QR code PNG (wa.me link with pre-filled message)
 * Query params: ?format=json (returns link only) | default returns PNG binary
 * PNG is 900x900px (~3 inches at 300 DPI), suitable for print
 */
router.get('/qr-campaigns/:id/image', async (req: Request, res: Response) => {
  try {
    await ensureTable();
    const result = await pool.query('SELECT * FROM qr_campaigns WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'QR campaign not found' });
      return;
    }

    const campaign = result.rows[0];
    const phoneNumber = process.env.WA_PHONE_NUMBER || process.env.WABA_PHONE_NUMBER || '';
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(campaign.prefilled_message)}`;

    // JSON mode: return link metadata (for client-side rendering)
    if (req.query.format === 'json') {
      ok(res, {
        campaignId: campaign.id,
        name: campaign.name,
        waLink,
        prefilledMessage: campaign.prefilled_message,
        contextType: campaign.context_type,
      });
      return;
    }

    // PNG mode: generate 300 DPI QR code image (900px = 3" at 300 DPI)
    const pngBuffer = await QRCode.toBuffer(waLink, {
      type: 'png',
      width: 900,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#000000', light: '#FFFFFF' },
    });

    const safeName = campaign.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="qr-${safeName}.png"`);
    res.setHeader('Content-Length', pngBuffer.length);
    res.end(pngBuffer);
  } catch (err: any) {
    serverError(res, err);
  }
});

/**
 * Increment scan count by prefilled message match.
 * Called from the message router when a QR deep-link message is detected.
 */
export async function incrementQrScanByMessage(message: string): Promise<{ contextType: string; contextValue: string } | null> {
  try {
    await ensureTable();
    const result = await pool.query(
      `UPDATE qr_campaigns SET scan_count = scan_count + 1
       WHERE prefilled_message = $1 AND active = TRUE
       RETURNING context_type, context_value`,
      [message]
    );
    if (result.rows.length > 0) {
      return { contextType: result.rows[0].context_type, contextValue: result.rows[0].context_value };
    }
  } catch { /* non-critical */ }
  return null;
}

export default router;
