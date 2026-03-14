/**
 * Slow Query Monitor — US-515
 *
 * Polls pg_stat_statements every 10 minutes and:
 *   - Logs queries where mean_exec_time > 500ms
 *   - Emits a WhatsApp alert when any query exceeds 2000ms mean exec time
 *
 * NOTE: Neon resets pg_stat_statements on compute suspend / scale-to-zero.
 * Statistics collected here reflect only the current compute lifetime.
 */
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('SlowQueryMonitor');

// ─── Types ────────────────────────────────────────────────────────

export interface SlowQueryRow {
  query: string;
  calls: number;
  meanExecTimeMs: number;
  totalExecTimeMs: number;
}

export interface SlowQueryReport {
  collectedAt: string;
  thresholdMs: number;
  rows: SlowQueryRow[];
  /** True if pg_stat_statements extension is unavailable */
  extensionMissing?: boolean;
}

// ─── State ────────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
let latestReport: SlowQueryReport | null = null;
let alertHandler: ((report: SlowQueryReport) => Promise<void>) | null = null;

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const SLOW_QUERY_THRESHOLD_MS = 500;
const ALERT_THRESHOLD_MS = 2000;

// ─── Extension Setup ──────────────────────────────────────────────

/**
 * Enable pg_stat_statements on the connected database.
 * Requires superuser / neon_superuser. On Neon the extension is pre-loaded
 * so this usually succeeds immediately; on fresh databases it may fail
 * silently if privileges are insufficient.
 */
export async function ensurePgStatStatements(pool: import('pg').Pool): Promise<void> {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
    logger.info('pg_stat_statements extension ensured');
  } catch (err: any) {
    // Non-fatal: superuser not available (common on Neon shared tiers)
    logger.warn('Could not enable pg_stat_statements — monitoring will degrade gracefully', {
      error: err.message,
    });
  }
}

// ─── Query ────────────────────────────────────────────────────────

/**
 * Fetch top-20 slow queries from pg_stat_statements.
 * Returns an empty array if the extension is missing.
 */
export async function getSlowQueries(
  pool: import('pg').Pool,
  thresholdMs = SLOW_QUERY_THRESHOLD_MS
): Promise<{ rows: SlowQueryRow[]; extensionMissing?: boolean }> {
  try {
    const result = await pool.query<{
      query: string;
      calls: string;
      mean_exec_time: string;
      total_exec_time: string;
    }>(
      `SELECT query, calls, mean_exec_time, total_exec_time
       FROM pg_stat_statements
       WHERE mean_exec_time > $1
       ORDER BY mean_exec_time DESC
       LIMIT 20`,
      [thresholdMs]
    );

    const rows: SlowQueryRow[] = result.rows.map(r => ({
      query: r.query,
      calls: Number(r.calls),
      meanExecTimeMs: Math.round(Number(r.mean_exec_time) * 100) / 100,
      totalExecTimeMs: Math.round(Number(r.total_exec_time) * 100) / 100,
    }));

    return { rows };
  } catch (err: any) {
    if (
      err.message?.includes('pg_stat_statements') ||
      err.code === '42P01' // relation does not exist
    ) {
      logger.warn('pg_stat_statements view not available — extension may not be enabled');
      return { rows: [], extensionMissing: true };
    }
    throw err;
  }
}

// ─── Scheduler ────────────────────────────────────────────────────

/**
 * Register a callback that fires when any query exceeds the 2000ms alert threshold.
 * Called at most once per polling cycle.
 */
export function setSlowQueryAlertHandler(fn: (report: SlowQueryReport) => Promise<void>): void {
  alertHandler = fn;
}

/**
 * Run one monitoring cycle: query slow statements, update in-memory cache,
 * log offenders, and emit alert if needed.
 */
async function runMonitorCycle(pool: import('pg').Pool): Promise<void> {
  try {
    const { rows, extensionMissing } = await getSlowQueries(pool);

    const report: SlowQueryReport = {
      collectedAt: new Date().toISOString(),
      thresholdMs: SLOW_QUERY_THRESHOLD_MS,
      rows,
      extensionMissing,
    };

    latestReport = report;

    if (extensionMissing) return;

    if (rows.length === 0) {
      logger.debug('No slow queries found');
      return;
    }

    logger.warn(`Found ${rows.length} slow queries (threshold: ${SLOW_QUERY_THRESHOLD_MS}ms)`, {
      topQuery: rows[0]?.query?.slice(0, 120),
      topMeanMs: rows[0]?.meanExecTimeMs,
    });

    // Alert if any query exceeds 2000ms
    const critical = rows.filter(r => r.meanExecTimeMs > ALERT_THRESHOLD_MS);
    if (critical.length > 0 && alertHandler) {
      await alertHandler(report).catch((e: any) =>
        logger.error('Slow query alert handler failed', { error: e.message })
      );
    }
  } catch (err: any) {
    logger.error('Slow query monitor cycle failed', { error: err.message });
  }
}

/**
 * Start the slow-query monitoring background job.
 * Runs immediately, then every 10 minutes.
 */
export function startSlowQueryMonitor(pool: import('pg').Pool): void {
  if (timer) return; // already started

  // Run immediately, then on interval
  runMonitorCycle(pool).catch(() => {});
  timer = setInterval(() => runMonitorCycle(pool), POLL_INTERVAL_MS);
  // Allow process to exit without waiting for this timer
  if (timer.unref) timer.unref();

  logger.info(`Slow query monitor started (poll interval: ${POLL_INTERVAL_MS / 1000}s, threshold: ${SLOW_QUERY_THRESHOLD_MS}ms)`);
}

/**
 * Stop the background monitoring job.
 */
export function stopSlowQueryMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('Slow query monitor stopped');
  }
}

/**
 * Return the most recent report (from the last poll cycle).
 * Returns null if no cycle has run yet.
 */
export function getLatestSlowQueryReport(): SlowQueryReport | null {
  return latestReport;
}
