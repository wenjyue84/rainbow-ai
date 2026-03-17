/**
 * WABA Portfolio Messaging Limits Admin API (US-026)
 *
 * Tracks portfolio-level (WABA-level) WhatsApp messaging limits.
 * Meta changed limits from per-phone to portfolio-level on October 7, 2025.
 *
 * GET  /analytics/waba-portfolio          — portfolio usage: conversations started in last 24h vs limit
 * POST /webhooks/business-capability      — process business_capability_update from Meta
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady } from '../../lib/db.js';
import { rainbowConversations } from '../../../shared/schema.js';
import { sql, gte } from 'drizzle-orm';
import { serverError } from './http-utils.js';
import { getStore } from './http-utils.js';
import { notifyAdminMessagingLimit } from '../../lib/admin-notifier.js';

const router = Router();

// ─── Constants ──────────────────────────────────────────────────────────────
const DEFAULT_LIMIT = 1000;
const DEFAULT_ALERT_THRESHOLD_PCT = 80;

/** Cooldown: one alert per hour */
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
let _lastAlertAt = 0;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Read waba_messaging_limits from settings.json */
function getWabaLimits(settings: Record<string, any>): {
  current_limit: number;
  alert_threshold: number;
  last_updated: string | null;
} {
  const wl = settings.waba_messaging_limits ?? {};
  return {
    current_limit: typeof wl.current_limit === 'number' ? wl.current_limit : DEFAULT_LIMIT,
    alert_threshold: typeof wl.alert_threshold === 'number' ? wl.alert_threshold : DEFAULT_ALERT_THRESHOLD_PCT,
    last_updated: typeof wl.last_updated === 'string' ? wl.last_updated : null,
  };
}

/** Count distinct phone numbers across all profiles (graceful fallback = 1) */
async function countActivePhones(): Promise<number> {
  try {
    const isConnected = await dbReady;
    if (!isConnected) return 1;
    // Count distinct profileId values with conversations in the last 24h as a proxy for active phones
    const result = await db
      .select({ count: sql<number>`count(distinct profile_id)::int` })
      .from(rainbowConversations)
      .where(gte(rainbowConversations.updatedAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
    return Math.max(1, Number(result[0]?.count ?? 1));
  } catch {
    return 1;
  }
}

/** Count conversations started in last 24h across all profiles */
async function getConversations24h(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rainbowConversations)
    .where(gte(rainbowConversations.createdAt, since));
  return Number(result[0]?.count ?? 0);
}

/** Fire admin alert if portfolio usage exceeds alert_threshold. Throttled to once/hour. */
async function checkPortfolioAlert(used: number, limit: number, alertThresholdPct: number): Promise<void> {
  if (limit <= 0) return;
  const pct = (used / limit) * 100;
  if (pct < alertThresholdPct) return;
  if (Date.now() - _lastAlertAt < ALERT_COOLDOWN_MS) return;
  _lastAlertAt = Date.now();
  notifyAdminMessagingLimit(used, limit, 'waba-portfolio', pct).catch(() => {});
}

// ─── GET /analytics/waba-portfolio ───────────────────────────────────────────

router.get('/analytics/waba-portfolio', async (_req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({
        success: true,
        data: { used24h: 0, limit: DEFAULT_LIMIT, percentUsed: 0, alertThreshold: DEFAULT_ALERT_THRESHOLD_PCT, activePhones: 1, multiPhoneActive: false },
        warning: 'Database connection unavailable. Using defaults.',
      });
    }

    const settings = getStore(res).getSettings() as any;
    const { current_limit: limit, alert_threshold: alertThreshold, last_updated: lastUpdated } = getWabaLimits(settings);

    const [used24h, activePhones] = await Promise.all([
      getConversations24h(),
      countActivePhones(),
    ]);

    const percentUsed = limit > 0 ? Math.round((used24h / limit) * 10000) / 100 : 0;
    const multiPhoneActive = activePhones > 1;

    // Feature is only relevant if both phones are active (graceful disable for single-phone)
    const featureEnabled = multiPhoneActive;

    // Fire threshold alert asynchronously
    if (featureEnabled) {
      checkPortfolioAlert(used24h, limit, alertThreshold).catch(() => {});
    }

    res.json({
      success: true,
      data: {
        used24h,
        limit,
        percentUsed,
        alertThreshold,
        lastUpdated,
        activePhones,
        multiPhoneActive,
        featureEnabled,
        atRisk: featureEnabled && percentUsed >= alertThreshold,
      },
    });
  } catch (err) {
    serverError(res, err instanceof Error ? err : 'Failed to fetch WABA portfolio limits');
  }
});

// ─── POST /webhooks/business-capability ──────────────────────────────────────
// Processes Meta's business_capability_update webhook event.
// Payload: { object: "whatsapp_business_account", entry: [{ changes: [{ value: { max_daily_conversation_per_phone: N }, field: "business_capability_update" }] }] }

router.post('/webhooks/business-capability', async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};

    // Support both direct { max_daily_conversation_per_phone } and nested Meta webhook envelope
    let maxDailyConversations: number | null = null;

    if (typeof body.max_daily_conversation_per_phone === 'number') {
      maxDailyConversations = body.max_daily_conversation_per_phone;
    } else if (Array.isArray(body.entry)) {
      // Meta webhook envelope format
      for (const entry of body.entry) {
        for (const change of entry?.changes ?? []) {
          if (change?.field === 'business_capability_update' && typeof change?.value?.max_daily_conversation_per_phone === 'number') {
            maxDailyConversations = change.value.max_daily_conversation_per_phone;
          }
        }
      }
    }

    if (maxDailyConversations === null || maxDailyConversations <= 0) {
      return res.status(400).json({ success: false, error: 'Missing or invalid max_daily_conversation_per_phone' });
    }

    const store = getStore(res);
    const current = store.getSettings() as any;
    const updated = {
      ...current,
      waba_messaging_limits: {
        ...(current.waba_messaging_limits ?? {}),
        current_limit: maxDailyConversations,
        last_updated: new Date().toISOString(),
      },
    };
    store.setSettings(updated);

    res.json({ success: true, current_limit: maxDailyConversations, last_updated: updated.waba_messaging_limits.last_updated });
  } catch (err) {
    serverError(res, err instanceof Error ? err : 'Failed to process business_capability_update');
  }
});

export default router;
