/**
 * Messaging Limits Admin API (US-446)
 *
 * Tracks WhatsApp Business Portfolio messaging tier and 24-hour outbound count.
 *
 * GET  /analytics/messaging-limits      — tier, used24h, limit, percentUsed
 * PUT  /analytics/messaging-limits/tier  — manually set the portfolio tier
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady } from '../../lib/db.js';
import { appSettings, rainbowMessages } from '../../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { badRequest, serverError } from './http-utils.js';
import { notifyAdminConfigError } from '../../lib/admin-notifier.js';
import { getPacingState } from '../../lib/pacing-monitor.js';

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
    const pacing = getPacingState();
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

    // Invalidate cache
    _cache = null;

    res.json({ success: true, tier: String(tier), updatedAt: now });
  } catch (err) {
    serverError(res, err instanceof Error ? err : 'Failed to update tier');
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
