/**
 * Messaging Limits Admin API (US-446, US-1030)
 *
 * Tracks WhatsApp Business Portfolio messaging tier and 24-hour outbound count.
 *
 * GET  /analytics/messaging-limits             — tier, used24h, limit, percentUsed, upgradeUrl, tierHistory
 * PUT  /analytics/messaging-limits/tier         — manually set the portfolio tier
 * GET  /analytics/messaging-limits/tier-history — tier change history for Meta eligibility audit
 *
 * US-1030: Adds 80%/95% alert thresholds, Meta Business Manager upgrade URL,
 *          tier history logging, and graceful queue pause at 100% cap.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady, pool } from '../../lib/db.js';
import { appSettings, rainbowMessages } from '../../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { badRequest, serverError } from './http-utils.js';
import { notifyAdminConfigError, notifyAdminMessagingLimit } from '../../lib/admin-notifier.js';
import { getPacingState, getPacingStatusPanel } from '../../lib/pacing-monitor.js';

const router = Router();

// ─── Constants ─────────────────────────────────────────────────────
/** Obsolete tiers removed in US-890 (Meta Q2 2026 flat-cap migration) */
const OBSOLETE_TIERS = ['250', '2000'];

const TIER_LIMITS: Record<string, number> = {
  '10000': 10_000,
  '100000': 100_000,
  'unlimited': Infinity,
};

const VALID_TIERS = Object.keys(TIER_LIMITS);

const SETTING_KEY_TIER = 'rainbow_portfolio_tier';
const SETTING_KEY_TIER_UPDATED = 'rainbow_portfolio_tier_updated_at';

const DEFAULT_TIER = '100000';

// ─── US-1030: Volume alert thresholds ─────────────────────────────
const ALERT_THRESHOLD_80 = 80;
const ALERT_THRESHOLD_95 = 95;

/** Cooldown: suppress repeat alerts for 1 hour per threshold level */
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const _alertSentAt: Record<number, number> = {};

/** Whether the queue is paused due to hitting 100% cap (US-1030) */
let _queuePausedAt: string | null = null;

// ─── US-1030: Meta Business Manager upgrade URL ───────────────────
const META_UPGRADE_URL = 'https://business.facebook.com/settings/whatsapp-business-accounts';

// ─── In-memory cache (10s TTL) ─────────────────────────────────────
let _cache: { data: any; expiry: number } | null = null;
const CACHE_TTL = 10_000;

// ─── Helpers ───────────────────────────────────────────────────────

async function getCurrentTier(): Promise<string> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, SETTING_KEY_TIER));
  return rows[0]?.value || DEFAULT_TIER;
}

async function get24hOutboundCount(): Promise<number> {
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(rainbowMessages)
    .where(
      sql`${rainbowMessages.role} = 'assistant' AND ${rainbowMessages.timestamp} > NOW() - INTERVAL '24 hours' AND ${rainbowMessages.deletedAt} IS NULL`
    );
  return Number(result[0]?.count ?? 0);
}

// ─── US-1030: Tier history ─────────────────────────────────────────

/**
 * Append a tier change entry to the rainbow_config_audit log.
 * This lets operators demonstrate growth trajectory to Meta for upgrade eligibility.
 */
async function logTierChange(
  previousTier: string | null,
  newTier: string,
  changedBy: string | null
): Promise<void> {
  if (!pool) return;
  try {
    const serverRole = process.env.RAINBOW_ROLE || 'unknown';
    await pool.query(
      `INSERT INTO rainbow_config_audit (config_key, action, changed_by, server_role, endpoint, before_json, after_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        SETTING_KEY_TIER,
        'tier_change',
        changedBy,
        serverRole,
        '/analytics/messaging-limits/tier',
        previousTier ? JSON.stringify({ tier: previousTier }) : null,
        JSON.stringify({ tier: newTier }),
      ]
    );
  } catch (err: any) {
    console.error('[messaging-limits] Failed to log tier change:', err.message);
  }
}

/**
 * Fetch the last N tier change entries from the audit log.
 */
async function getTierHistory(limit = 50): Promise<Array<{ tier: string; changedBy: string | null; changedAt: string }>> {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT after_json, changed_by, created_at
       FROM rainbow_config_audit
       WHERE config_key = $1 AND action = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [SETTING_KEY_TIER, 'tier_change', limit]
    );
    return rows.map((r: any) => {
      const parsed = typeof r.after_json === 'string' ? JSON.parse(r.after_json) : r.after_json;
      return {
        tier: parsed?.tier ?? 'unknown',
        changedBy: r.changed_by ?? null,
        changedAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      };
    });
  } catch (err: any) {
    console.error('[messaging-limits] Failed to fetch tier history:', err.message);
    return [];
  }
}

// ─── US-1030: Volume alert check ──────────────────────────────────

/**
 * Check volume thresholds and fire alerts at 80% and 95%.
 * When limit is fully reached (≥100%), set _queuePausedAt.
 * Throttled: one alert per threshold per hour.
 */
async function checkVolumeAlerts(used24h: number, limit: number, tier: string): Promise<void> {
  if (limit === Infinity || limit === 0) return;

  const percentUsed = (used24h / limit) * 100;

  // Queue pause at 100%
  if (percentUsed >= 100 && !_queuePausedAt) {
    _queuePausedAt = new Date().toISOString();
    console.warn(`[messaging-limits] Daily cap reached (${used24h}/${limit}). Queue paused at ${_queuePausedAt}`);
    notifyAdminMessagingLimit(used24h, limit, tier, 100).catch(() => {});
  } else if (percentUsed < 100 && _queuePausedAt) {
    // New 24h window — clear pause
    _queuePausedAt = null;
  }

  // 95% alert
  if (percentUsed >= ALERT_THRESHOLD_95) {
    const lastSent = _alertSentAt[ALERT_THRESHOLD_95] ?? 0;
    if (Date.now() - lastSent > ALERT_COOLDOWN_MS) {
      _alertSentAt[ALERT_THRESHOLD_95] = Date.now();
      notifyAdminMessagingLimit(used24h, limit, tier, Math.min(percentUsed, 100)).catch(() => {});
      console.warn(`[messaging-limits] 95% threshold alert fired (${used24h}/${limit})`);
    }
    return; // Don't also fire 80% alert
  }

  // 80% alert
  if (percentUsed >= ALERT_THRESHOLD_80) {
    const lastSent = _alertSentAt[ALERT_THRESHOLD_80] ?? 0;
    if (Date.now() - lastSent > ALERT_COOLDOWN_MS) {
      _alertSentAt[ALERT_THRESHOLD_80] = Date.now();
      notifyAdminMessagingLimit(used24h, limit, tier, percentUsed).catch(() => {});
      console.warn(`[messaging-limits] 80% threshold alert fired (${used24h}/${limit})`);
    }
  }
}

/**
 * US-1030: Periodic volume check — called by scheduler in index.ts.
 * Runs every 15 minutes to check thresholds and fire alerts.
 */
export async function checkMessagingVolumeLimits(): Promise<void> {
  try {
    const isConnected = await dbReady;
    if (!isConnected) return;
    const [tier, used24h] = await Promise.all([getCurrentTier(), get24hOutboundCount()]);
    const limit = TIER_LIMITS[tier] ?? TIER_LIMITS[DEFAULT_TIER];
    await checkVolumeAlerts(used24h, limit, tier);
  } catch (err: any) {
    console.error('[messaging-limits] Periodic volume check failed:', err.message);
  }
}

/** US-1030: Returns true if the daily cap has been reached and the queue is paused */
export function isVolumePaused(): boolean {
  return _queuePausedAt !== null;
}

/** US-1030: Returns when the queue was paused, or null if not paused */
export function getVolumePausedAt(): string | null {
  return _queuePausedAt;
}

// ─── GET /analytics/messaging-limits ───────────────────────────────
router.get('/analytics/messaging-limits', async (_req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({
        success: true,
        data: { tier: DEFAULT_TIER, used24h: 0, limit: TIER_LIMITS[DEFAULT_TIER], percentUsed: 0 },
        warning: 'Database connection unavailable. Using defaults.',
      });
    }

    // Check cache
    const now = Date.now();
    if (_cache && now < _cache.expiry) {
      return res.json({ success: true, data: _cache.data, cached: true });
    }

    const [tier, used24h] = await Promise.all([
      getCurrentTier(),
      get24hOutboundCount(),
    ]);

    const limit = TIER_LIMITS[tier] ?? TIER_LIMITS[DEFAULT_TIER];
    const percentUsed = limit === Infinity ? 0 : Math.round((used24h / limit) * 10000) / 100;

    // US-891: Include pacing state from pacing monitor
    // US-995: Include queue depth metrics and broadcast warning
    const pacing = getPacingState();
    const qd = pacing.queueDepth;

    // US-1030: Fire threshold alerts asynchronously (non-blocking)
    if (limit !== Infinity) {
      checkVolumeAlerts(used24h, limit, tier).catch(() => {});
    }

    const data = {
      tier,
      used24h,
      limit: limit === Infinity ? 'unlimited' : limit,
      percentUsed,
      pacingPaused: pacing.pacingPaused,
      pacingDetails: pacing.pacingPaused ? {
        affectedTemplateName: pacing.affectedTemplateName,
        percentNotDelivered: pacing.percentNotDelivered,
        pauseDetectedAt: pacing.pauseDetectedAt,
      } : undefined,
      pacingLastCheckedAt: pacing.lastCheckedAt,
      // US-995: Queue depth visibility
      queueDepth: qd ? {
        messagesSent24h: qd.messagesSent24h,
        messagesPending: qd.messagesPending,
        messagesDelivered: qd.messagesDelivered,
        messagesFailed: qd.messagesFailed,
        volumeAvailable: qd.volumeAvailable,
      } : null,
      // US-995: Broadcast UI warning — shown in template send UI when pacing active
      pacingWarning: pacing.pacingPaused
        ? 'Portfolio pacing is active. Template sends may be delayed as Meta releases messages in batches. This is not a system error.'
        : null,
      // US-1030: Queue paused flag (daily cap reached)
      volumeCapReached: _queuePausedAt !== null,
      volumeCapPausedAt: _queuePausedAt,
      // US-1030: Meta Business Manager link for tier upgrade
      upgradeUrl: META_UPGRADE_URL,
    };

    _cache = { data, expiry: now + CACHE_TTL };

    res.json({ success: true, data });
  } catch (err) {
    serverError(res, err instanceof Error ? err : 'Failed to fetch messaging limits');
  }
});

// ─── PUT /analytics/messaging-limits/tier ──────────────────────────
router.put('/analytics/messaging-limits/tier', async (req: Request, res: Response) => {
  try {
    const { tier } = req.body;
    if (!tier || !VALID_TIERS.includes(String(tier))) {
      return badRequest(res, `Invalid tier. Must be one of: ${VALID_TIERS.join(', ')}`);
    }

    const isConnected = await dbReady;
    if (!isConnected) {
      return serverError(res, 'Database connection unavailable');
    }

    const now = new Date().toISOString();
    const changedBy = (req as any).adminUser ?? null;

    // Read previous tier for history log
    const previousTier = await getCurrentTier();

    // Upsert tier
    await db.insert(appSettings)
      .values({
        key: SETTING_KEY_TIER,
        value: String(tier),
        description: 'WhatsApp Business Portfolio messaging tier',
        updatedBy: null,
      })
      .onConflictDoUpdate({
        target: [appSettings.key],
        set: { value: String(tier), updatedAt: sql`NOW()` },
      });

    // Upsert updated_at timestamp
    await db.insert(appSettings)
      .values({
        key: SETTING_KEY_TIER_UPDATED,
        value: now,
        description: 'When the portfolio tier was last updated',
        updatedBy: null,
      })
      .onConflictDoUpdate({
        target: [appSettings.key],
        set: { value: now, updatedAt: sql`NOW()` },
      });

    // US-1030: Log tier change to audit table for Meta eligibility audit trail
    if (previousTier !== String(tier)) {
      await logTierChange(previousTier, String(tier), changedBy);
    }

    // Invalidate cache
    _cache = null;

    res.json({ success: true, tier: String(tier), updatedAt: now });
  } catch (err) {
    serverError(res, err instanceof Error ? err : 'Failed to update tier');
  }
});

// ─── GET /analytics/messaging-limits/tier-history (US-1030) ───────
router.get('/analytics/messaging-limits/tier-history', async (_req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({ success: true, history: [], warning: 'Database unavailable' });
    }
    const history = await getTierHistory(100);
    res.json({ success: true, history });
  } catch (err) {
    serverError(res, err instanceof Error ? err : 'Failed to fetch tier history');
  }
});

// ─── Startup Migration (US-890) ───────────────────────────────────
// Auto-migrate obsolete '250' / '2000' tiers to '10000' on startup
async function migrateObsoleteTiers(): Promise<void> {
  try {
    const isConnected = await dbReady;
    if (!isConnected) return;

    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, SETTING_KEY_TIER));

    const current = rows[0]?.value;
    if (current && OBSOLETE_TIERS.includes(current)) {
      await db
        .update(appSettings)
        .set({ value: '10000', updatedAt: sql`NOW()` })
        .where(eq(appSettings.key, SETTING_KEY_TIER));
      console.log(`[messaging-limits] Auto-migrated tier from '${current}' to '10000' (US-890)`);
      notifyAdminConfigError(
        `[US-890] Messaging tier auto-migrated: '${current}' → '10000' (Meta removed lower tiers in Q2 2026). Current cap: 10,000 messages/day.`
      ).catch(() => {}); // Fire-and-forget
    }
  } catch (err) {
    console.error('[messaging-limits] Tier migration failed:', err);
  }
}

export default router;

// ─── Exported for use by notification scheduler ────────────────────
export { TIER_LIMITS, OBSOLETE_TIERS, getCurrentTier, get24hOutboundCount, migrateObsoleteTiers };
// US-1030 exports are declared inline above (checkMessagingVolumeLimits, isVolumePaused, getVolumePausedAt)
