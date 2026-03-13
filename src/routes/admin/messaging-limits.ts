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

const router = Router();

// ─── Constants ─────────────────────────────────────────────────────
const TIER_LIMITS: Record<string, number> = {
  '250': 250,
  '2000': 2_000,
  '10000': 10_000,
  '100000': 100_000,
  'unlimited': Infinity,
};

const VALID_TIERS = Object.keys(TIER_LIMITS);

const SETTING_KEY_TIER = 'rainbow_portfolio_tier';
const SETTING_KEY_TIER_UPDATED = 'rainbow_portfolio_tier_updated_at';

const DEFAULT_TIER = '250';

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

    const data = { tier, used24h, limit: limit === Infinity ? 'unlimited' : limit, percentUsed };

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

export default router;

// ─── Exported for use by notification scheduler ────────────────────
export { TIER_LIMITS, getCurrentTier, get24hOutboundCount };
