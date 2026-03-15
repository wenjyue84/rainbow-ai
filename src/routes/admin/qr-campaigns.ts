/**
 * qr-campaigns.ts — Admin CRUD + analytics for QR code campaigns
 *
 * US-919: Admin can create named QR codes with pre-filled messages,
 * view analytics (scan counts per QR code per time period),
 * and export QR code images as PNG (300 DPI).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import QRCode from 'qrcode';
import { db } from '../../lib/db.js';
import { qrCampaigns, rainbowConversations } from '../../../shared/schema-tables.js';
import { eq, and, gte, desc, sql, count } from 'drizzle-orm';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────

/** Generate a slug from a name. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** Build wa.me deep-link URL with pre-filled message. */
function buildWhatsAppLink(phoneNumber: string, prefilledMessage: string): string {
  const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(prefilledMessage)}`;
}

// ─── POST /qr-campaigns — Create a new QR campaign ─────────────────

router.post('/qr-campaigns', async (req: Request, res: Response) => {
  const profileId = (req.query.profileId as string) || (res.locals.profileId as string) || 'pelangi';
  const { name, campaignLabel, prefilledMessage, deepLinkType, deepLinkValue, whatsappNumber } = req.body;

  if (!name || !prefilledMessage || !deepLinkType) {
    res.status(400).json({ error: 'name, prefilledMessage, and deepLinkType are required' });
    return;
  }

  const validTypes = ['table', 'room', 'campaign'];
  if (!validTypes.includes(deepLinkType)) {
    res.status(400).json({ error: `deepLinkType must be one of: ${validTypes.join(', ')}` });
    return;
  }

  const id = slugify(name) || `qr-${Date.now()}`;

  try {
    await db.insert(qrCampaigns).values({
      id,
      profileId,
      name,
      campaignLabel: campaignLabel || null,
      prefilledMessage,
      deepLinkType,
      deepLinkValue: deepLinkValue || null,
      whatsappNumber: whatsappNumber || null,
    });

    res.status(201).json({ success: true, id, name, prefilledMessage });
  } catch (err: any) {
    if (err.code === '23505') {
      // Unique violation — ID already exists
      res.status(409).json({ error: `QR campaign with ID "${id}" already exists` });
      return;
    }
    console.error('[QR-Campaigns] Create error:', err.message);
    res.status(500).json({ error: 'Failed to create QR campaign' });
  }
});

// ─── GET /qr-campaigns — List all QR campaigns ─────────────────────

router.get('/qr-campaigns', async (req: Request, res: Response) => {
  const profileId = (req.query.profileId as string) || (res.locals.profileId as string) || undefined;

  try {
    const conditions = profileId
      ? [eq(qrCampaigns.profileId, profileId)]
      : [];

    const rows = await db
      .select()
      .from(qrCampaigns)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(qrCampaigns.createdAt));

    res.json({ success: true, campaigns: rows });
  } catch (err: any) {
    console.error('[QR-Campaigns] List error:', err.message);
    res.status(500).json({ error: 'Failed to list QR campaigns' });
  }
});

// ─── GET /qr-campaigns/:id — Get a single QR campaign ──────────────

router.get('/qr-campaigns/:id', async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(qrCampaigns)
      .where(eq(qrCampaigns.id, req.params.id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: 'QR campaign not found' });
      return;
    }
    res.json({ success: true, campaign: rows[0] });
  } catch (err: any) {
    console.error('[QR-Campaigns] Get error:', err.message);
    res.status(500).json({ error: 'Failed to get QR campaign' });
  }
});

// ─── PATCH /qr-campaigns/:id — Update a QR campaign ────────────────

router.patch('/qr-campaigns/:id', async (req: Request, res: Response) => {
  const allowed = ['name', 'campaignLabel', 'prefilledMessage', 'deepLinkType', 'deepLinkValue', 'whatsappNumber', 'active'];
  const updates: Record<string, any> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' });
    return;
  }
  updates.updatedAt = new Date();

  try {
    const result = await db
      .update(qrCampaigns)
      .set(updates)
      .where(eq(qrCampaigns.id, req.params.id));

    res.json({ success: true, id: req.params.id });
  } catch (err: any) {
    console.error('[QR-Campaigns] Update error:', err.message);
    res.status(500).json({ error: 'Failed to update QR campaign' });
  }
});

// ─── DELETE /qr-campaigns/:id — Deactivate a QR campaign ───────────

router.delete('/qr-campaigns/:id', async (req: Request, res: Response) => {
  try {
    await db
      .update(qrCampaigns)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(qrCampaigns.id, req.params.id));

    res.json({ success: true, id: req.params.id, deactivated: true });
  } catch (err: any) {
    console.error('[QR-Campaigns] Delete error:', err.message);
    res.status(500).json({ error: 'Failed to deactivate QR campaign' });
  }
});

// ─── GET /qr-campaigns/:id/qr.png — Export QR code as PNG ──────────
// AC5: 300 DPI output — at 300 DPI, a 3cm QR code needs ~354px width.
// We use 600px for comfortable print margin.

router.get('/qr-campaigns/:id/qr.png', async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(qrCampaigns)
      .where(eq(qrCampaigns.id, req.params.id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: 'QR campaign not found' });
      return;
    }

    const campaign = rows[0];
    const phone = campaign.whatsappNumber || process.env.WHATSAPP_PHONE_NUMBER || '';
    const waLink = buildWhatsAppLink(phone, campaign.prefilledMessage);

    const width = parseInt(req.query.width as string) || 600;
    const margin = parseInt(req.query.margin as string) || 2;

    const pngBuffer = await QRCode.toBuffer(waLink, {
      type: 'png',
      width: Math.min(width, 2000), // Cap at 2000px
      margin,
      errorCorrectionLevel: 'H', // High error correction for print
      color: { dark: '#000000', light: '#FFFFFF' },
    });

    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="qr-${campaign.id}.png"`,
      'Cache-Control': 'public, max-age=86400',
    });
    res.send(pngBuffer);
  } catch (err: any) {
    console.error('[QR-Campaigns] QR PNG error:', err.message);
    res.status(500).json({ error: 'Failed to generate QR code image' });
  }
});

// ─── GET /analytics/qr-campaigns — Scan analytics per QR code ──────
// AC4: scan count (conversation starts) per QR code per time period

router.get('/analytics/qr-campaigns', async (req: Request, res: Response) => {
  const profileId = (req.query.profileId as string) || (res.locals.profileId as string) || undefined;
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
  const since = new Date();
  since.setDate(since.getDate() - days);

  try {
    // Get all campaigns with their scan counts
    const conditions = profileId
      ? [eq(qrCampaigns.profileId, profileId)]
      : [];

    const campaigns = await db
      .select({
        id: qrCampaigns.id,
        name: qrCampaigns.name,
        campaignLabel: qrCampaigns.campaignLabel,
        deepLinkType: qrCampaigns.deepLinkType,
        scanCount: qrCampaigns.scanCount,
        active: qrCampaigns.active,
        createdAt: qrCampaigns.createdAt,
      })
      .from(qrCampaigns)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(qrCampaigns.scanCount));

    // Count conversations attributed to QR codes (referral_source_type = 'qr_code')
    const qrConversationConditions = [
      eq(rainbowConversations.referralSourceType, 'qr_code'),
      gte(rainbowConversations.createdAt, since),
    ];
    if (profileId) {
      qrConversationConditions.push(eq(rainbowConversations.profileId, profileId));
    }

    const [qrConvoStats] = await db
      .select({ total: count() })
      .from(rainbowConversations)
      .where(and(...qrConversationConditions));

    const totalScans = campaigns.reduce((sum, c) => sum + c.scanCount, 0);

    res.json({
      success: true,
      periodDays: days,
      totalScans,
      totalQrConversations: qrConvoStats?.total ?? 0,
      campaigns,
    });
  } catch (err: any) {
    console.error('[QR-Campaigns] Analytics error:', err.message);
    res.status(500).json({ error: 'Failed to get QR analytics' });
  }
});

export default router;
