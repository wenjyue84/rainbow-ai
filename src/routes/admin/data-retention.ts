/**
 * Admin API: Data retention management (US-419, US-838)
 *
 * GET  /api/rainbow/data-retention/stats    — Records eligible for purge in next run
 * POST /api/rainbow/data-retention/run      — Manually trigger a retention purge
 *
 * GET  /api/rainbow/retention/stats         — Alias with ?profile= query param support (US-838)
 * GET  /api/rainbow/retention/settings      — Read current retention config per profile
 * PUT  /api/rainbow/retention/settings      — Update retention config (validates ranges, audits disable)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getRetentionStats, runRetentionPurge } from '../../lib/data-retention.js';
import { ok, badRequest, serverError, getStore } from './http-utils.js';
import { pool } from '../../lib/db.js';

const router = Router();

// ─── Legacy endpoints (US-419) ───────────────────────────────────────

// GET /api/rainbow/data-retention/stats
router.get('/data-retention/stats', async (req: Request, res: Response) => {
  try {
    const profileId = req.headers['x-profile-id'] as string | undefined;
    const stats = await getRetentionStats(profileId);
    res.json({ success: true, ...stats });
  } catch (error: any) {
    console.error('[DataRetention] Failed to get stats:', error.message);
    res.status(500).json({ error: 'Failed to retrieve retention stats' });
  }
});

// POST /api/rainbow/data-retention/run
router.post('/data-retention/run', async (req: Request, res: Response) => {
  try {
    const profileId = (req.headers['x-profile-id'] as string | undefined)
      ?? (req.body?.profile_id as string | undefined);
    const result = await runRetentionPurge(profileId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[DataRetention] Manual purge failed:', error.message);
    res.status(500).json({ error: 'Retention purge failed' });
  }
});

// ─── US-838: Per-profile retention settings endpoints ────────────────

// GET /api/rainbow/retention/stats  (supports ?profile= query param)
router.get('/retention/stats', async (req: Request, res: Response) => {
  try {
    const profileId = (req.query.profile as string | undefined)
      ?? (req.headers['x-profile-id'] as string | undefined);
    const stats = await getRetentionStats(profileId);
    ok(res, stats);
  } catch (error: any) {
    serverError(res, error);
  }
});

// GET /api/rainbow/retention/settings
router.get('/retention/settings', (req: Request, res: Response) => {
  try {
    const store = getStore(res);
    const settings = store.getSettings();
    const retention = (settings as any).retention ?? {
      enabled: true,
      retention_days: 730, // US-907: PDPA 2024 default 24 months
      grace_period_days: 30,
    };
    ok(res, { retention });
  } catch (error: any) {
    serverError(res, error);
  }
});

// PUT /api/rainbow/retention/settings
router.put('/retention/settings', async (req: Request, res: Response) => {
  try {
    const { enabled, retention_days, grace_period_days } = req.body ?? {};

    // Validate required fields
    if (enabled === undefined || retention_days === undefined || grace_period_days === undefined) {
      badRequest(res, 'enabled, retention_days, and grace_period_days are required');
      return;
    }

    // Validate ranges
    if (typeof retention_days !== 'number' || !Number.isInteger(retention_days) || retention_days < 30 || retention_days > 3650) {
      badRequest(res, 'retention_days must be an integer between 30 and 3650');
      return;
    }
    if (typeof grace_period_days !== 'number' || !Number.isInteger(grace_period_days) || grace_period_days < 7 || grace_period_days > 365) {
      badRequest(res, 'grace_period_days must be an integer between 7 and 365');
      return;
    }
    if (typeof enabled !== 'boolean') {
      badRequest(res, 'enabled must be a boolean');
      return;
    }

    const store = getStore(res);
    const currentSettings = store.getSettings() as any;
    const previousRetention = currentSettings.retention;

    // Build updated settings
    const updatedSettings = {
      ...currentSettings,
      retention: { enabled, retention_days, grace_period_days },
    };

    store.setSettings(updatedSettings);

    // Audit log when retention is disabled
    if (!enabled && previousRetention?.enabled !== false) {
      const changedBy = (req.headers['x-changed-by'] as string | undefined) ?? 'admin';
      const profileId = (req.headers['x-profile-id'] as string | undefined) ?? 'pelangi';
      try {
        await pool.query(
          `INSERT INTO rainbow_config_audit (config_key, action, changed_by, server_role, old_version, new_version)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            `retention.${profileId}`,
            'disabled',
            changedBy,
            process.env.RAINBOW_ROLE ?? 'primary',
            null,
            null,
          ]
        );
        console.log(JSON.stringify({
          event: 'retention_disabled',
          profile: profileId,
          changed_by: changedBy,
          timestamp: new Date().toISOString(),
        }));
      } catch (auditErr: any) {
        // Non-fatal — log but don't fail the request
        console.error('[DataRetention] Audit log insert failed:', auditErr.message);
      }
    }

    ok(res, {
      retention: { enabled, retention_days, grace_period_days },
      message: 'Retention settings updated',
    });
  } catch (error: any) {
    serverError(res, error);
  }
});

export default router;
