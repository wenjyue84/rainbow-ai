import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { sql } from 'drizzle-orm';
import { ok, serverError } from './http-utils.js';

const router = Router();

// Source values stored in rainbow_messages.source → routing tier labels
const SOURCE_TO_TIER: Record<string, string> = {
  regex: 't1_regex',
  fuzzy: 't2_fuzzy',
  semantic: 't3_kb',
  llm: 't4_llm',
};

/**
 * GET /analytics/latency
 *
 * Returns P50/P95/P99 response latency from rainbow_messages.response_time_ms.
 * - Broken down by profile_id and routing source (t1_regex, t2_fuzzy, t3_kb, t4_llm)
 * - Covers last 24h and last 7d windows
 * - Optional alert threshold: ?p95_threshold_ms=8000 (default 8000ms)
 *   When P95 > threshold, response includes warningTriggered: true
 */
router.get('/analytics/latency', async (req: Request, res: Response) => {
  try {
    const p95ThresholdMs = parseInt(req.query.p95_threshold_ms as string) || 8000;

    // ── Overall percentiles for 24h and 7d ──────────────────────────
    const overallRows = await db.execute(sql`
      SELECT
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms) AS p50_24h,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95_24h,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) AS p99_24h,
        COUNT(*) FILTER (WHERE response_time_ms IS NOT NULL) AS sample_count_24h
      FROM rainbow_messages
      WHERE
        role = 'assistant'
        AND response_time_ms IS NOT NULL
        AND deleted_at IS NULL
        AND timestamp >= NOW() - INTERVAL '24 hours'
    `);

    const overall7dRows = await db.execute(sql`
      SELECT
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms) AS p50_7d,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95_7d,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) AS p99_7d,
        COUNT(*) FILTER (WHERE response_time_ms IS NOT NULL) AS sample_count_7d
      FROM rainbow_messages
      WHERE
        role = 'assistant'
        AND response_time_ms IS NOT NULL
        AND deleted_at IS NULL
        AND timestamp >= NOW() - INTERVAL '7 days'
    `);

    const o24 = (overallRows as any).rows[0] ?? {};
    const o7d = (overall7dRows as any).rows[0] ?? {};

    const overall = {
      last24h: {
        p50Ms: o24.p50_24h !== null ? Math.round(Number(o24.p50_24h)) : null,
        p95Ms: o24.p95_24h !== null ? Math.round(Number(o24.p95_24h)) : null,
        p99Ms: o24.p99_24h !== null ? Math.round(Number(o24.p99_24h)) : null,
        sampleCount: Number(o24.sample_count_24h ?? 0),
      },
      last7d: {
        p50Ms: o7d.p50_7d !== null ? Math.round(Number(o7d.p50_7d)) : null,
        p95Ms: o7d.p95_7d !== null ? Math.round(Number(o7d.p95_7d)) : null,
        p99Ms: o7d.p99_7d !== null ? Math.round(Number(o7d.p99_7d)) : null,
        sampleCount: Number(o7d.sample_count_7d ?? 0),
      },
    };

    // ── By profile ───────────────────────────────────────────────────
    const byProfileRows = await db.execute(sql`
      SELECT
        COALESCE(profile_id, 'pelangi') AS profile_id,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p50_24h,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p95_24h,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p99_24h,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS count_24h,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p50_7d,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p95_7d,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p99_7d,
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
      last24h: {
        p50Ms: r.p50_24h !== null ? Math.round(Number(r.p50_24h)) : null,
        p95Ms: r.p95_24h !== null ? Math.round(Number(r.p95_24h)) : null,
        p99Ms: r.p99_24h !== null ? Math.round(Number(r.p99_24h)) : null,
        sampleCount: Number(r.count_24h ?? 0),
      },
      last7d: {
        p50Ms: r.p50_7d !== null ? Math.round(Number(r.p50_7d)) : null,
        p95Ms: r.p95_7d !== null ? Math.round(Number(r.p95_7d)) : null,
        p99Ms: r.p99_7d !== null ? Math.round(Number(r.p99_7d)) : null,
        sampleCount: Number(r.count_7d ?? 0),
      },
    }));

    // ── By routing source ────────────────────────────────────────────
    const bySourceRows = await db.execute(sql`
      SELECT
        COALESCE(source, 'unknown') AS source,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p50_24h,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p95_24h,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS p99_24h,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS count_24h,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p50_7d,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p95_7d,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') AS p99_7d,
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
      last24h: {
        p50Ms: r.p50_24h !== null ? Math.round(Number(r.p50_24h)) : null,
        p95Ms: r.p95_24h !== null ? Math.round(Number(r.p95_24h)) : null,
        p99Ms: r.p99_24h !== null ? Math.round(Number(r.p99_24h)) : null,
        sampleCount: Number(r.count_24h ?? 0),
      },
      last7d: {
        p50Ms: r.p50_7d !== null ? Math.round(Number(r.p50_7d)) : null,
        p95Ms: r.p95_7d !== null ? Math.round(Number(r.p95_7d)) : null,
        p99Ms: r.p99_7d !== null ? Math.round(Number(r.p99_7d)) : null,
        sampleCount: Number(r.count_7d ?? 0),
      },
    }));

    // ── Alert threshold check ────────────────────────────────────────
    const p95_24h = overall.last24h.p95Ms;
    const warningTriggered = p95_24h !== null && p95_24h > p95ThresholdMs;

    ok(res, {
      overall,
      byProfile,
      bySource,
      alert: {
        p95ThresholdMs,
        warningTriggered,
        message: warningTriggered
          ? `P95 latency (${p95_24h}ms) exceeds threshold of ${p95ThresholdMs}ms in the last 24h`
          : null,
      },
    });
  } catch (error) {
    console.error('[Analytics Latency] ❌ Error computing latency percentiles:', error);
    serverError(res, 'Failed to compute latency metrics');
  }
});

export default router;
