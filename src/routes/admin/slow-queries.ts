/**
 * GET /metrics/slow-queries — US-515
 *
 * Returns the top-20 slow queries from pg_stat_statements.
 * Uses the in-memory cache populated by the 10-minute background monitor,
 * with a live fallback query if the cache is cold.
 *
 * NOTE: Neon resets pg_stat_statements on compute suspend / scale-to-zero.
 * Statistics here reflect only the current compute lifetime.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { pool } from '../../lib/db.js';
import {
  getLatestSlowQueryReport,
  getSlowQueries,
  type SlowQueryReport,
} from '../../lib/slow-query-monitor.js';
import { ok, serverError } from './http-utils.js';

const router = Router();

router.get('/metrics/slow-queries', async (req: Request, res: Response) => {
  try {
    const thresholdMs = parseInt(req.query.threshold_ms as string) || 500;

    // Serve cached report if available and threshold matches default
    let report: SlowQueryReport | null = getLatestSlowQueryReport();

    // If no cache yet (cold start) or caller specified a custom threshold, do a live query
    if (!report || thresholdMs !== 500) {
      const { rows, extensionMissing } = await getSlowQueries(pool, thresholdMs);
      report = {
        collectedAt: new Date().toISOString(),
        thresholdMs,
        rows,
        extensionMissing,
      };
    }

    const criticalCount = report.rows.filter(r => r.meanExecTimeMs > 2000).length;

    ok(res, {
      collectedAt: report.collectedAt,
      thresholdMs: report.thresholdMs,
      totalFound: report.rows.length,
      criticalCount,
      extensionMissing: report.extensionMissing ?? false,
      neonNote: 'Statistics reset on Neon compute suspend / scale-to-zero',
      queries: report.rows,
    });
  } catch (error) {
    console.error('[SlowQueries] Error fetching slow queries:', error);
    serverError(res, 'Failed to fetch slow query data');
  }
});

export default router;
