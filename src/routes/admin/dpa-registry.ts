/**
 * Admin API: Vendor DPA Registry (US-958)
 *
 * PDPA 2024 requires signed Data Processing Agreements with all third-party
 * processors that handle personal data. This registry tracks vendor DPA status,
 * expiry dates, and data categories processed.
 *
 * Endpoints:
 *   GET    /pdpa/dpa-registry           — List all vendor DPA entries
 *   GET    /pdpa/dpa-registry/:id       — Get single entry
 *   POST   /pdpa/dpa-registry           — Add vendor DPA entry
 *   PUT    /pdpa/dpa-registry/:id       — Update vendor DPA entry
 *   DELETE /pdpa/dpa-registry/:id       — Soft-delete (mark inactive)
 *   GET    /pdpa/dpa-registry/alerts/expiring — Vendors with DPAs expiring within 30 days
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { dpaRegistry } from '../../../shared/schema-tables.js';
import { eq, sql, and, lte, gt, desc } from 'drizzle-orm';
import { ok, badRequest, notFound, serverError, validateRequired } from './http-utils.js';
import { checkRole } from '../../lib/rbac.js';

const router = Router();

// ─── GET /pdpa/dpa-registry — List all entries (AC1) ─────────────────
router.get('/pdpa/dpa-registry', checkRole(['operator', 'super-admin']), async (_req: Request, res: Response) => {
  try {
    const entries = await db.select().from(dpaRegistry).orderBy(desc(dpaRegistry.updatedAt));
    ok(res, { entries, total: entries.length });
  } catch (error: any) {
    serverError(res, error);
  }
});

// ─── GET /pdpa/dpa-registry/alerts/expiring — Expiry alerts (AC3) ────
router.get('/pdpa/dpa-registry/alerts/expiring', checkRole(['operator', 'super-admin']), async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const expiring = await db.select()
      .from(dpaRegistry)
      .where(and(
        eq(dpaRegistry.dpaStatus, 'signed'),
        lte(dpaRegistry.dpaExpiryDate, thirtyDaysFromNow),
        gt(dpaRegistry.dpaExpiryDate, now)
      ))
      .orderBy(dpaRegistry.dpaExpiryDate);

    const expired = await db.select()
      .from(dpaRegistry)
      .where(and(
        eq(dpaRegistry.dpaStatus, 'signed'),
        lte(dpaRegistry.dpaExpiryDate, now)
      ))
      .orderBy(dpaRegistry.dpaExpiryDate);

    ok(res, {
      expiring_within_30_days: expiring,
      already_expired: expired,
      alert_count: expiring.length + expired.length,
    });
  } catch (error: any) {
    serverError(res, error);
  }
});

// ─── GET /pdpa/dpa-registry/:id — Single entry ──────────────────────
router.get('/pdpa/dpa-registry/:id', checkRole(['operator', 'super-admin']), async (req: Request, res: Response) => {
  try {
    const [entry] = await db.select().from(dpaRegistry).where(eq(dpaRegistry.id, req.params.id));
    if (!entry) return notFound(res, 'DPA registry entry');
    ok(res, { entry });
  } catch (error: any) {
    serverError(res, error);
  }
});

// ─── POST /pdpa/dpa-registry — Add vendor (AC1, AC4) ────────────────
router.post('/pdpa/dpa-registry', checkRole(['super-admin']), async (req: Request, res: Response) => {
  try {
    const err = validateRequired(req.body, ['vendor_name', 'data_categories', 'processing_purpose']);
    if (err) return badRequest(res, err);

    const {
      vendor_name,
      registered_address,
      data_categories,
      processing_purpose,
      retention_period,
      sub_processors,
      dpa_status,
      dpa_expiry_date,
      dpa_signed,
      notes,
    } = req.body;

    const [entry] = await db.insert(dpaRegistry).values({
      vendorName: vendor_name,
      registeredAddress: registered_address || '',
      dataCategories: Array.isArray(data_categories) ? JSON.stringify(data_categories) : data_categories,
      processingPurpose: processing_purpose,
      retentionPeriod: retention_period || '',
      subProcessors: sub_processors ? JSON.stringify(sub_processors) : '[]',
      dpaStatus: dpa_status || 'pending',
      dpaExpiryDate: dpa_expiry_date ? new Date(dpa_expiry_date) : null,
      dpaSigned: dpa_signed ? new Date(dpa_signed) : null,
      notes: notes || null,
    }).returning();

    ok(res, { entry, message: 'Vendor DPA entry created' });
  } catch (error: any) {
    serverError(res, error);
  }
});

// ─── PUT /pdpa/dpa-registry/:id — Update vendor (AC1) ───────────────
router.put('/pdpa/dpa-registry/:id', checkRole(['super-admin']), async (req: Request, res: Response) => {
  try {
    const [existing] = await db.select().from(dpaRegistry).where(eq(dpaRegistry.id, req.params.id));
    if (!existing) return notFound(res, 'DPA registry entry');

    const {
      vendor_name,
      registered_address,
      data_categories,
      processing_purpose,
      retention_period,
      sub_processors,
      dpa_status,
      dpa_expiry_date,
      dpa_signed,
      notes,
    } = req.body;

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (vendor_name !== undefined) updates.vendorName = vendor_name;
    if (registered_address !== undefined) updates.registeredAddress = registered_address;
    if (data_categories !== undefined) updates.dataCategories = Array.isArray(data_categories) ? JSON.stringify(data_categories) : data_categories;
    if (processing_purpose !== undefined) updates.processingPurpose = processing_purpose;
    if (retention_period !== undefined) updates.retentionPeriod = retention_period;
    if (sub_processors !== undefined) updates.subProcessors = JSON.stringify(sub_processors);
    if (dpa_status !== undefined) updates.dpaStatus = dpa_status;
    if (dpa_expiry_date !== undefined) updates.dpaExpiryDate = dpa_expiry_date ? new Date(dpa_expiry_date) : null;
    if (dpa_signed !== undefined) updates.dpaSigned = dpa_signed ? new Date(dpa_signed) : null;
    if (notes !== undefined) updates.notes = notes;

    const [updated] = await db.update(dpaRegistry)
      .set(updates)
      .where(eq(dpaRegistry.id, req.params.id))
      .returning();

    ok(res, { entry: updated, message: 'Vendor DPA entry updated' });
  } catch (error: any) {
    serverError(res, error);
  }
});

// ─── DELETE /pdpa/dpa-registry/:id — Soft-delete (mark inactive) ─────
router.delete('/pdpa/dpa-registry/:id', checkRole(['super-admin']), async (req: Request, res: Response) => {
  try {
    const [existing] = await db.select().from(dpaRegistry).where(eq(dpaRegistry.id, req.params.id));
    if (!existing) return notFound(res, 'DPA registry entry');

    await db.update(dpaRegistry)
      .set({ dpaStatus: 'inactive', updatedAt: new Date() })
      .where(eq(dpaRegistry.id, req.params.id));

    ok(res, { message: 'Vendor DPA entry marked inactive' });
  } catch (error: any) {
    serverError(res, error);
  }
});

export default router;
