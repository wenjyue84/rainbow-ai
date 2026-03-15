/**
 * PDPA DPO Settings & Breach Detection Admin API (US-907)
 *
 * GET  /api/rainbow/pdpa/dpo          — Read DPO appointment details
 * PUT  /api/rainbow/pdpa/dpo          — Update DPO appointment details
 * GET  /api/rainbow/pdpa/dsar/:phone  — Generate Data Subject Access Report
 *
 * Malaysia PDPA Amendment Act 2024:
 * - DPO must be ordinarily resident in Malaysia and registered with PDPC Commissioner
 * - Penalties: up to RM1,000,000 and/or 3 years imprisonment
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, badRequest, serverError, getStore } from './http-utils.js';

const router = Router();

// ─── GET /pdpa/dpo — Read DPO appointment details ────────────────
router.get('/pdpa/dpo', (req: Request, res: Response) => {
  try {
    const store = getStore(res);
    const settings = store.getSettings() as any;
    const pdpa = settings.pdpa ?? {};

    res.json({
      ok: true,
      dpo: {
        name: pdpa.dpo_name ?? null,
        email: pdpa.dpo_email ?? null,
        registration_status: pdpa.dpo_registration_status ?? 'pending',
        appointed_date: pdpa.dpo_appointed_date ?? null,
        general_contact_email: pdpa.general_contact_email ?? null,
      },
      breach_detection: pdpa.breach_detection ?? {
        enabled: false,
        scan_interval_minutes: 15,
        bulk_access_threshold: 100,
      },
      retention_months: pdpa.retention_months ?? 24,
    });
  } catch (error: any) {
    serverError(res, error);
  }
});

// ─── PUT /pdpa/dpo — Update DPO appointment details ──────────────
router.put('/pdpa/dpo', (req: Request, res: Response) => {
  try {
    const { dpo_name, dpo_email, dpo_registration_status, dpo_appointed_date } = req.body ?? {};

    // Validate required fields
    if (!dpo_name || typeof dpo_name !== 'string' || dpo_name.trim().length === 0) {
      return badRequest(res, 'dpo_name is required');
    }
    if (!dpo_email || typeof dpo_email !== 'string' || !dpo_email.includes('@')) {
      return badRequest(res, 'dpo_email must be a valid email address');
    }

    const validStatuses = ['pending', 'registered', 'expired'];
    const status = dpo_registration_status ?? 'pending';
    if (!validStatuses.includes(status)) {
      return badRequest(res, `dpo_registration_status must be one of: ${validStatuses.join(', ')}`);
    }

    const store = getStore(res);
    const currentSettings = store.getSettings() as any;
    const currentPdpa = currentSettings.pdpa ?? {};

    const updatedPdpa = {
      ...currentPdpa,
      dpo_name: dpo_name.trim(),
      dpo_email: dpo_email.trim(),
      dpo_registration_status: status,
      dpo_appointed_date: dpo_appointed_date ?? currentPdpa.dpo_appointed_date ?? new Date().toISOString().slice(0, 10),
    };

    store.setSettings({ ...currentSettings, pdpa: updatedPdpa });

    console.log(`[PDPA] DPO settings updated: ${updatedPdpa.dpo_name} <${updatedPdpa.dpo_email}> (${updatedPdpa.dpo_registration_status})`);

    ok(res, {
      dpo: {
        name: updatedPdpa.dpo_name,
        email: updatedPdpa.dpo_email,
        registration_status: updatedPdpa.dpo_registration_status,
        appointed_date: updatedPdpa.dpo_appointed_date,
      },
      message: 'DPO settings updated',
    });
  } catch (error: any) {
    serverError(res, error);
  }
});

export default router;
