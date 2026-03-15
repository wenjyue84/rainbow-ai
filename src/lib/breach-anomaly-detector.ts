/**
 * Breach Anomaly Detector (US-907 AC2)
 *
 * Runs every 15 minutes scanning for anomalous bulk data access patterns:
 * - >100 records/minute fetched from a single session/IP
 * - Alerts DPO via WhatsApp notification
 * - Auto-logs detected anomalies to pdpa_breach_log (incident response log, AC3)
 *
 * Malaysia PDPA Amendment Act 2024: 72-hour breach notification requirement.
 */
import cron from 'node-cron';
import { pool, dbReady } from './db.js';
import { notifyAdminBreachReport } from './admin-notifier.js';
import { configStore } from '../assistant/config-store.js';

// ─── Constants ───────────────────────────────────────────────────────

const ANOMALY_THRESHOLD_RECORDS_PER_MIN = 100;
const CHECK_WINDOW_MINUTES = 15; // How far back to look each scan
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between alerts for same session

// In-memory dedup: sessionKey → last alerted timestamp
const alertedSessions = new Map<string, number>();

// ─── Table setup ─────────────────────────────────────────────────────

async function ensureAccessLogTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pdpa_data_access_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_key TEXT NOT NULL,
      phone TEXT,
      endpoint TEXT NOT NULL,
      records_accessed INTEGER NOT NULL DEFAULT 1,
      accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pdpa_access_log_session
      ON pdpa_data_access_log (session_key, accessed_at)
  `).catch(() => {});
}

// ─── Core scan ────────────────────────────────────────────────────────

export interface AnomalyResult {
  detected: boolean;
  sessions: Array<{
    session_key: string;
    records_per_minute: number;
    total_records: number;
    window_minutes: number;
  }>;
  scanned_at: string;
}

export async function scanForAnomalies(): Promise<AnomalyResult> {
  const ready = await dbReady;
  if (!ready) {
    return { detected: false, sessions: [], scanned_at: new Date().toISOString() };
  }

  const windowStart = new Date(Date.now() - CHECK_WINDOW_MINUTES * 60 * 1000);

  try {
    const result = await pool.query<{
      session_key: string;
      total_records: string;
      records_per_minute: string;
    }>(
      `SELECT
         session_key,
         SUM(records_accessed) AS total_records,
         ROUND(SUM(records_accessed)::numeric / $1, 2) AS records_per_minute
       FROM pdpa_data_access_log
       WHERE accessed_at >= $2
       GROUP BY session_key
       HAVING ROUND(SUM(records_accessed)::numeric / $1, 2) > $3`,
      [CHECK_WINDOW_MINUTES, windowStart, ANOMALY_THRESHOLD_RECORDS_PER_MIN]
    );

    const anomalous = result.rows.map(r => ({
      session_key: r.session_key,
      records_per_minute: parseFloat(r.records_per_minute),
      total_records: parseInt(r.total_records, 10),
      window_minutes: CHECK_WINDOW_MINUTES,
    }));

    if (anomalous.length === 0) {
      return { detected: false, sessions: [], scanned_at: new Date().toISOString() };
    }

    // Alert for each new anomalous session (respecting cooldown)
    const now = Date.now();
    for (const session of anomalous) {
      const lastAlerted = alertedSessions.get(session.session_key) ?? 0;
      if (now - lastAlerted < COOLDOWN_MS) continue;

      alertedSessions.set(session.session_key, now);

      // Auto-log to pdpa_breach_log (AC3: incident response log)
      const discoveredAt = new Date();
      const commDeadline = new Date(discoveredAt.getTime() + 72 * 60 * 60 * 1000);
      const subjDeadline = new Date(discoveredAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      const description = `[AUTO] Anomalous bulk data access detected: session ${session.session_key} accessed ${session.total_records} records in ${session.window_minutes}min (${session.records_per_minute} records/min, threshold: ${ANOMALY_THRESHOLD_RECORDS_PER_MIN})`;

      await pool.query(
        `INSERT INTO pdpa_breach_log
           (reported_by, description, affected_count_estimate, discovered_at,
            commissioner_deadline, subject_deadline)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['anomaly-detector', description, session.total_records, discoveredAt, commDeadline, subjDeadline]
      ).catch((err: any) => {
        console.error('[AnomalyDetector] Failed to log incident:', err.message);
      });

      // Alert DPO via WhatsApp notification
      notifyAdminBreachReport(description, session.total_records, commDeadline, subjDeadline).catch(() => {});

      console.warn(`[AnomalyDetector] 🚨 Breach anomaly: session ${session.session_key} — ${session.records_per_minute} records/min`);
    }

    return { detected: true, sessions: anomalous, scanned_at: new Date().toISOString() };
  } catch (err: any) {
    // Table may not exist yet (first run before any access logging)
    if (err.code === '42P01') {
      return { detected: false, sessions: [], scanned_at: new Date().toISOString() };
    }
    console.error('[AnomalyDetector] Scan failed:', err.message);
    return { detected: false, sessions: [], scanned_at: new Date().toISOString() };
  }
}

// ─── Access logging helper (call from request middleware) ─────────────

export async function logDataAccess(
  sessionKey: string,
  endpoint: string,
  recordsAccessed: number,
  phone?: string
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO pdpa_data_access_log (session_key, phone, endpoint, records_accessed)
       VALUES ($1, $2, $3, $4)`,
      [sessionKey, phone ?? null, endpoint, recordsAccessed]
    );
  } catch (err: any) {
    // Non-fatal — access logging should never break request flow
    if (err.code !== '42P01') {
      console.error('[AnomalyDetector] Access log insert failed:', err.message);
    }
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────

export function startAnomalyDetectionScheduler(): void {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      const result = await scanForAnomalies();
      if (result.detected) {
        console.warn(`[AnomalyDetector] Scan complete — ${result.sessions.length} anomalous session(s) detected`);
      }
    } catch (err: any) {
      console.error('[AnomalyDetector] Scheduled scan failed:', err.message);
    }
  });

  // Setup table on first start
  dbReady.then(ok => {
    if (ok) ensureAccessLogTable().catch(() => {});
  });

  console.log('[AnomalyDetector] 15-minute breach anomaly detection scheduler started');
}

export default { startAnomalyDetectionScheduler, scanForAnomalies, logDataAccess };
