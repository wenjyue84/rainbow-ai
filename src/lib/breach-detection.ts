/**
 * PDPA Breach Detection Job (US-907)
 *
 * Runs every 15 minutes to scan for anomalous bulk data access patterns.
 * Detects when >100 records are accessed per minute from a single session/IP.
 * Alerts DPO via admin notification and logs to pdpa_breach_log.
 *
 * Malaysia PDPA Amendment Act 2024:
 * - Breach notification to Commissioner within 72 hours
 * - Penalties: up to RM1,000,000
 */

import { pool, dbReady } from './db.js';
import { configStore } from '../assistant/config-store.js';
import { notifyAdminBreachReport } from './admin-notifier.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('BreachDetection');

// Track scan state to avoid duplicate alerts within the same scan window
let lastScanAt = 0;

/**
 * Ensure the access log table exists for tracking API data access patterns.
 * This table records bulk data access events for breach detection.
 */
async function ensureAccessLogTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pdpa_access_log (
      id SERIAL PRIMARY KEY,
      session_id TEXT,
      ip_address TEXT,
      endpoint TEXT NOT NULL,
      records_accessed INTEGER NOT NULL DEFAULT 0,
      accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Index for fast breach detection scans
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pdpa_access_log_time
    ON pdpa_access_log (accessed_at)
  `);
}

/**
 * Log a data access event for breach detection monitoring.
 * Called from data export and bulk access endpoints.
 */
export async function logDataAccess(
  sessionId: string | null,
  ipAddress: string | null,
  endpoint: string,
  recordsAccessed: number
): Promise<void> {
  try {
    const ready = await dbReady;
    if (!ready) return;
    await pool.query(
      `INSERT INTO pdpa_access_log (session_id, ip_address, endpoint, records_accessed)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, ipAddress, endpoint, recordsAccessed]
    );
  } catch (err: any) {
    // Non-fatal — don't break the request
    logger.warn('Failed to log data access event', { error: err.message });
  }
}

/**
 * Scan for anomalous bulk data access patterns.
 * Looks for sessions/IPs that accessed >threshold records in the last scan window.
 */
export async function scanForBreaches(): Promise<Array<{
  session_id: string | null;
  ip_address: string | null;
  total_records: number;
  access_count: number;
  window_start: string;
  window_end: string;
}>> {
  const ready = await dbReady;
  if (!ready) return [];

  const settings = configStore.getSettings() as any;
  const pdpa = settings.pdpa ?? {};
  const threshold = pdpa.breach_detection?.bulk_access_threshold ?? 100;
  const scanMinutes = pdpa.breach_detection?.scan_interval_minutes ?? 15;

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - scanMinutes * 60 * 1000);

  try {
    const result = await pool.query(
      `SELECT
        session_id,
        ip_address,
        SUM(records_accessed) as total_records,
        COUNT(*) as access_count
       FROM pdpa_access_log
       WHERE accessed_at BETWEEN $1 AND $2
       GROUP BY session_id, ip_address
       HAVING SUM(records_accessed) > $3
       ORDER BY total_records DESC`,
      [windowStart, windowEnd, threshold]
    );

    return result.rows.map((row: any) => ({
      session_id: row.session_id,
      ip_address: row.ip_address,
      total_records: Number(row.total_records),
      access_count: Number(row.access_count),
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
    }));
  } catch (err: any) {
    logger.error('Breach scan query failed', { error: err.message });
    return [];
  }
}

/**
 * Run breach detection scan and alert if anomalies found.
 * Creates breach records in pdpa_breach_log for incident response tracking.
 */
export async function runBreachDetection(): Promise<void> {
  const settings = configStore.getSettings() as any;
  const pdpa = settings.pdpa ?? {};
  if (!pdpa.breach_detection?.enabled) {
    return;
  }

  const now = Date.now();
  const scanInterval = (pdpa.breach_detection?.scan_interval_minutes ?? 15) * 60 * 1000;
  if (now - lastScanAt < scanInterval - 30000) {
    // Too soon since last scan (with 30s tolerance)
    return;
  }
  lastScanAt = now;

  logger.info('Running breach detection scan...');

  try {
    const anomalies = await scanForBreaches();

    if (anomalies.length === 0) {
      logger.info('Breach scan clean — no anomalies detected');
      return;
    }

    // Log each anomaly as a breach record
    for (const anomaly of anomalies) {
      const description = `Anomalous bulk data access detected: ${anomaly.total_records} records accessed ` +
        `from ${anomaly.session_id || anomaly.ip_address || 'unknown source'} ` +
        `(${anomaly.access_count} requests in ${pdpa.breach_detection?.scan_interval_minutes ?? 15} min window)`;

      const discoveredAt = new Date();
      const commDeadline = new Date(discoveredAt.getTime() + 72 * 60 * 60 * 1000); // +72h
      const subjDeadline = new Date(discoveredAt.getTime() + 7 * 24 * 60 * 60 * 1000); // +7d

      try {
        await pool.query(
          `INSERT INTO pdpa_breach_log
             (reported_by, description, affected_count_estimate, discovered_at, commissioner_deadline, subject_deadline)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          ['system:breach-detection', description, anomaly.total_records, discoveredAt, commDeadline, subjDeadline]
        );

        // Alert admin via WhatsApp
        notifyAdminBreachReport(
          description,
          anomaly.total_records,
          commDeadline,
          subjDeadline
        ).catch(() => {});

        logger.warn('Breach anomaly recorded', {
          source: anomaly.session_id || anomaly.ip_address,
          records: anomaly.total_records,
        });
      } catch (dbErr: any) {
        logger.error('Failed to record breach', { error: dbErr.message });
      }
    }
  } catch (err: any) {
    logger.error('Breach detection scan failed', { error: err.message });
  }
}

// ─── Scheduler ────────────────────────────────────────────────────

let breachDetectionTimer: ReturnType<typeof setInterval> | null = null;

export function startBreachDetectionScheduler(): void {
  const settings = configStore.getSettings() as any;
  const pdpa = settings.pdpa ?? {};
  const intervalMinutes = pdpa.breach_detection?.scan_interval_minutes ?? 15;
  const intervalMs = intervalMinutes * 60 * 1000;

  // Ensure table exists on startup
  dbReady.then(ok => {
    if (ok) ensureAccessLogTable().catch(err =>
      logger.error('Failed to create access log table', { error: err.message })
    );
  });

  if (breachDetectionTimer) {
    clearInterval(breachDetectionTimer);
  }

  breachDetectionTimer = setInterval(() => {
    runBreachDetection().catch(err =>
      logger.error('Scheduled breach detection failed', { error: err.message })
    );
  }, intervalMs);

  logger.info(`Breach detection scheduler started (every ${intervalMinutes} min)`);
}

export function stopBreachDetectionScheduler(): void {
  if (breachDetectionTimer) {
    clearInterval(breachDetectionTimer);
    breachDetectionTimer = null;
    logger.info('Breach detection scheduler stopped');
  }
}
