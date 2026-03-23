import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { sql } from 'drizzle-orm';
import { ok, serverError } from './http-utils.js';
import { getLatencyPercentiles, getTrackedIntents } from '../../assistant/pipeline/latency-tracker.js';

const router = Router();

// Source values stored in rainbow_messages.source → routing tier labels
const SOURCE_TO_TIER: Record<string, string> = {
  regex: 't1_regex',
  fuzzy: 't2_fuzzy',
  semantic: 't3_kb',
  llm: 't4_llm',
};

/** Helper: parse a percentile row into { p50Ms, p95Ms, p99Ms, sampleCount } */
function parsePercentileRow(r: any, prefix: string) {
  return {
    p50Ms: r[`p50_${prefix}`] !== null ? Math.round(Number(r[`p50_${prefix}`])) : null,
    p95Ms: r[`p95_${prefix}`] !== null ? Math.round(Number(r[`p95_${prefix}`])) : null,
    p99Ms: r[`p99_${prefix}`] !== null ? Math.round(Number(r[`p99_${prefix}`])) : null,
    sampleCount: Number(r[`sample_count_${prefix}`] ?? r[`count_${prefix}`] ?? 0),
  };
}

/**
 * GET /analytics/latency
 *
 * US-982: Chatbot response latency SLA monitoring with P95 alerting.
 *
 * Returns P50/P95/P99 response latency from rainbow_messages.response_time_ms.
 * - Overall percentiles over 1h / 24h / 7d rolling windows (AC2)
 * - Broken down by profile_id and routing source
 * - Broken down by AI provider (model column) (AC4)
 * - 15-minute rolling P95 SLA alert with configurable threshold (AC3)
 * - Optional alert threshold: ?p95_threshold_ms=5000 (default 5000ms per AC3)
 */
router.get('/analytics/latency', async (req: Request, res: Response) => {
  try {
    const p95ThresholdMs = parseInt(req.query.p95_threshold_ms as string) || 5000;

    // ── Overall percentiles for 1h, 24h, and 7d ─────────────────────
    const overallRows = await db.execute(sql`
      SELECT
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '1 hour') AS p50_1h,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '1 hour') AS p95_1h,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '1 hour') AS p99_1h,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '1 hour'
          AND response_time_ms IS NOT NULL) AS sample_count_1h,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p50_24h,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p95_24h,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p99_24h,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours'
          AND response_time_ms IS NOT NULL) AS sample_count_24h,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p50_7d,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p95_7d,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p99_7d,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days'
          AND response_time_ms IS NOT NULL) AS sample_count_7d
      FROM rainbow_messages
      WHERE
        role = 'assistant'
        AND response_time_ms IS NOT NULL
        AND deleted_at IS NULL
        AND timestamp >= NOW() - INTERVAL '7 days'
    `);

    const o = (overallRows as any).rows[0] ?? {};

    const overall = {
      last1h: parsePercentileRow(o, '1h'),
      last24h: parsePercentileRow(o, '24h'),
      last7d: parsePercentileRow(o, '7d'),
    };

    // ── By profile ───────────────────────────────────────────────────
    const byProfileRows = await db.execute(sql`
      SELECT
        COALESCE(profile_id, 'pelangi') AS profile_id,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '1 hour') AS p50_1h,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '1 hour') AS p95_1h,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '1 hour') AS p99_1h,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '1 hour') AS count_1h,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p50_24h,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p95_24h,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p99_24h,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS count_24h,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p50_7d,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p95_7d,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p99_7d,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS count_7d
      FROM rainbow_messages
      WHERE
        role = 'assistant'
        AND response_time_ms IS NOT NULL
        AND deleted_at IS NULL
        AND timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY COALESCE(profile_id, 'pelangi')
      ORDER BY count_7d DESC
    `);

    const byProfile = (byProfileRows as any).rows.map((r: any) => ({
      profileId: r.profile_id,
      last1h: parsePercentileRow(r, '1h'),
      last24h: parsePercentileRow(r, '24h'),
      last7d: parsePercentileRow(r, '7d'),
    }));

    // ── By routing source ────────────────────────────────────────────
    const bySourceRows = await db.execute(sql`
      SELECT
        COALESCE(source, 'unknown') AS source,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p50_24h,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p95_24h,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p99_24h,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS count_24h,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p50_7d,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p95_7d,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p99_7d,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS count_7d
      FROM rainbow_messages
      WHERE
        role = 'assistant'
        AND response_time_ms IS NOT NULL
        AND deleted_at IS NULL
        AND timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY COALESCE(source, 'unknown')
      ORDER BY count_7d DESC
    `);

    const bySource = (bySourceRows as any).rows.map((r: any) => ({
      source: r.source,
      routingTier: SOURCE_TO_TIER[r.source] ?? r.source,
      last24h: parsePercentileRow(r, '24h'),
      last7d: parsePercentileRow(r, '7d'),
    }));

    // ── US-982 AC4: By AI provider (model column) ────────────────────
    const byProviderRows = await db.execute(sql`
      SELECT
        COALESCE(model, 'unknown') AS provider,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '1 hour') AS p50_1h,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '1 hour') AS p95_1h,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '1 hour') AS p99_1h,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '1 hour') AS count_1h,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p50_24h,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p95_24h,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p99_24h,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS count_24h,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p50_7d,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p95_7d,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)
          FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p99_7d,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS count_7d
      FROM rainbow_messages
      WHERE
        role = 'assistant'
        AND response_time_ms IS NOT NULL
        AND deleted_at IS NULL
        AND model IS NOT NULL
        AND timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY COALESCE(model, 'unknown')
      ORDER BY count_7d DESC
    `);

    const byProvider = (byProviderRows as any).rows.map((r: any) => ({
      provider: r.provider,
      last1h: parsePercentileRow(r, '1h'),
      last24h: parsePercentileRow(r, '24h'),
      last7d: parsePercentileRow(r, '7d'),
    }));

    // ── US-982 AC3: 15-minute rolling P95 SLA alert ──────────────────
    const slaRows = await db.execute(sql`
      SELECT
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95_15m,
        COUNT(*) FILTER (WHERE response_time_ms IS NOT NULL) AS sample_count_15m
      FROM rainbow_messages
      WHERE
        role = 'assistant'
        AND response_time_ms IS NOT NULL
        AND deleted_at IS NULL
        AND timestamp >= NOW() - INTERVAL '15 minutes'
    `);

    const sla = (slaRows as any).rows[0] ?? {};
    const p95_15m = sla.p95_15m !== null ? Math.round(Number(sla.p95_15m)) : null;
    const sampleCount15m = Number(sla.sample_count_15m ?? 0);
    const slaBreached = p95_15m !== null && p95_15m > p95ThresholdMs;

    ok(res, {
      overall,
      byProfile,
      bySource,
      byProvider,
      slaAlert: {
        window: '15m',
        p95ThresholdMs,
        currentP95Ms: p95_15m,
        sampleCount: sampleCount15m,
        breached: slaBreached,
        message: slaBreached
          ? `SLA BREACH: P95 latency (${p95_15m}ms) exceeds ${p95ThresholdMs}ms over the last 15 minutes`
          : null,
      },
    });
  } catch (error) {
    console.error('[Analytics Latency] Error computing latency percentiles:', error);
    serverError(res, 'Failed to compute latency metrics');
  }
});

/**
 * GET /analytics/latency/high-latency
 *
 * US-982 AC5: High-latency responses (>10s) flagged with warning badge.
 * Returns recent high-latency messages for admin conversation list view.
 * Optional: ?threshold_ms=10000 (default 10000ms) &limit=50 (default 50)
 */
router.get('/analytics/latency/high-latency', async (req: Request, res: Response) => {
  try {
    const thresholdMs = parseInt(req.query.threshold_ms as string) || 10000;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const rows = await db.execute(sql`
      SELECT
        m.id,
        m.phone,
        m.response_time_ms,
        m.model,
        m.source,
        m.intent,
        m.confidence,
        m.profile_id,
        m.timestamp,
        c.push_name
      FROM rainbow_messages m
      LEFT JOIN rainbow_conversations c ON c.phone = m.phone
      WHERE
        m.role = 'assistant'
        AND m.response_time_ms > ${thresholdMs}
        AND m.deleted_at IS NULL
        AND m.timestamp >= NOW() - INTERVAL '24 hours'
      ORDER BY m.timestamp DESC
      LIMIT ${limit}
    `);

    const messages = (rows as any).rows.map((r: any) => ({
      id: r.id,
      phone: r.phone,
      pushName: r.push_name ?? null,
      responseTimeMs: Number(r.response_time_ms),
      provider: r.model ?? 'unknown',
      source: r.source ?? 'unknown',
      intent: r.intent ?? null,
      confidence: r.confidence !== null ? Number(r.confidence) : null,
      profileId: r.profile_id ?? 'pelangi',
      timestamp: r.timestamp,
      highLatencyWarning: true,
    }));

    // Count total high-latency in last 24h
    const countRows = await db.execute(sql`
      SELECT COUNT(*) AS total
      FROM rainbow_messages
      WHERE
        role = 'assistant'
        AND response_time_ms > ${thresholdMs}
        AND deleted_at IS NULL
        AND timestamp >= NOW() - INTERVAL '24 hours'
    `);
    const totalCount = Number((countRows as any).rows[0]?.total ?? 0);

    ok(res, {
      thresholdMs,
      totalCount,
      messages,
    });
  } catch (error) {
    console.error('[Analytics Latency] Error fetching high-latency responses:', error);
    serverError(res, 'Failed to fetch high-latency responses');
  }
});

/**
 * GET /analytics/latency-percentiles
 *
 * US-315: Intent Classification Latency Percentile Tracker.
 *
 * Returns {p10, p50, p90, count} for the requested intent from in-memory latency store.
 * Query params:
 *   - intent (optional): specific intent to query (e.g. "booking"). If omitted, aggregates all intents.
 */
router.get('/analytics/latency-percentiles', async (req: Request, res: Response) => {
  try {
    const intent = req.query.intent as string | undefined;

    const percentiles = getLatencyPercentiles(intent);
    const trackedIntents = getTrackedIntents();

    ok(res, {
      intent: intent ?? 'all',
      ...percentiles,
      trackedIntents,
    });
  } catch (error) {
    console.error('[Analytics Latency] Error computing latency percentiles:', error);
    serverError(res, 'Failed to compute latency percentiles');
  }
});

export default router;
