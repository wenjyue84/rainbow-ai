/**
 * Rate Limit Settings Admin API (US-828)
 *
 * Dedicated admin endpoints for viewing and configuring per-profile
 * rate limiting, plus stats on rate-limited users in the last 24 hours.
 *
 * GET  /rate-limit-settings         — current rate limit config + 24h stats
 * PATCH /rate-limit-settings        — update rate limit settings
 * GET  /rate-limit-settings/stats   — count of rate-limited users in last 24h
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, badRequest, serverError, getStore } from './http-utils.js';
import {
  getThrottledJidCount,
  getThrottleEventsLast24h,
} from '../../assistant/jid-rate-limiter.js';

const router = Router();

// ─── GET /rate-limit-settings ────────────────────────────────────────
// Returns the current rate limit configuration and 24h stats
router.get('/rate-limit-settings', (_req: Request, res: Response) => {
  try {
    const settings = getStore(res).getSettings();
    const rateLimiting = settings.rateLimiting ?? { enabled: false, perUserWindowMs: 60000, perUserMaxMessages: 10 };
    const rateLimits = settings.rate_limits ?? { per_minute: 40, per_hour: 200 };

    const events = getThrottleEventsLast24h();
    const uniqueJids = new Set(events.map(e => e.jid));

    ok(res, {
      rateLimiting: {
        enabled: rateLimiting.enabled ?? false,
        perUserWindowMs: rateLimiting.perUserWindowMs ?? 60000,
        perUserMaxMessages: rateLimiting.perUserMaxMessages ?? 10,
      },
      rateLimits: {
        per_minute: rateLimits.per_minute ?? 40,
        per_hour: rateLimits.per_hour ?? 200,
      },
      stats: {
        currentlyThrottledUsers: getThrottledJidCount(),
        rateLimitedUsersLast24h: uniqueJids.size,
        totalThrottleEventsLast24h: events.length,
      },
    });
  } catch (err: any) {
    serverError(res, err);
  }
});

// ─── PATCH /rate-limit-settings ──────────────────────────────────────
// Update rate limit configuration (partial update via deep merge)
router.patch('/rate-limit-settings', (req: Request, res: Response) => {
  try {
    const { enabled, perUserWindowMs, perUserMaxMessages, per_minute, per_hour } = req.body;

    // Validate numeric fields if provided
    if (perUserWindowMs !== undefined && (typeof perUserWindowMs !== 'number' || perUserWindowMs < 1000)) {
      return badRequest(res, 'perUserWindowMs must be a number >= 1000 (1 second)');
    }
    if (perUserMaxMessages !== undefined && (typeof perUserMaxMessages !== 'number' || perUserMaxMessages < 1)) {
      return badRequest(res, 'perUserMaxMessages must be a number >= 1');
    }
    if (per_minute !== undefined && (typeof per_minute !== 'number' || per_minute < 1)) {
      return badRequest(res, 'per_minute must be a number >= 1');
    }
    if (per_hour !== undefined && (typeof per_hour !== 'number' || per_hour < 1)) {
      return badRequest(res, 'per_hour must be a number >= 1');
    }

    const settings = getStore(res).getSettings();

    // Update rateLimiting section
    if (!settings.rateLimiting) {
      settings.rateLimiting = { enabled: false, perUserWindowMs: 60000, perUserMaxMessages: 10 };
    }
    if (enabled !== undefined) settings.rateLimiting.enabled = Boolean(enabled);
    if (perUserWindowMs !== undefined) settings.rateLimiting.perUserWindowMs = perUserWindowMs;
    if (perUserMaxMessages !== undefined) settings.rateLimiting.perUserMaxMessages = perUserMaxMessages;

    // Update rate_limits section
    if (!settings.rate_limits) {
      settings.rate_limits = { per_minute: 40, per_hour: 200 };
    }
    if (per_minute !== undefined) settings.rate_limits.per_minute = per_minute;
    if (per_hour !== undefined) settings.rate_limits.per_hour = per_hour;

    getStore(res).setSettings(settings);

    ok(res, {
      rateLimiting: settings.rateLimiting,
      rateLimits: settings.rate_limits,
    });
  } catch (err: any) {
    serverError(res, err);
  }
});

// ─── GET /rate-limit-settings/stats ──────────────────────────────────
// Returns count of rate-limited users in the last 24 hours
router.get('/rate-limit-settings/stats', (_req: Request, res: Response) => {
  try {
    const events = getThrottleEventsLast24h();
    const uniqueJids = new Set(events.map(e => e.jid));

    // Break down by hour for trend data
    const hourlyBuckets: Record<string, number> = {};
    const now = Date.now();
    for (const event of events) {
      const hoursAgo = Math.floor((now - event.timestamp) / (60 * 60 * 1000));
      const key = `${hoursAgo}h_ago`;
      hourlyBuckets[key] = (hourlyBuckets[key] || 0) + 1;
    }

    ok(res, {
      currentlyThrottledUsers: getThrottledJidCount(),
      rateLimitedUsersLast24h: uniqueJids.size,
      totalThrottleEventsLast24h: events.length,
      hourlyBreakdown: hourlyBuckets,
      recentEvents: events.slice(-20).map(e => ({
        jid: e.jid,
        timestamp: new Date(e.timestamp).toISOString(),
      })),
    });
  } catch (err: any) {
    serverError(res, err);
  }
});

export default router;
