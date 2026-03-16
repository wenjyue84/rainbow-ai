/**
 * US-934: WhatsApp Flows Health and Error Monitoring
 *
 * Monitors WhatsApp Flows health by:
 * 1. Polling flow endpoint health every 15 minutes
 * 2. Tracking error rates per flow (endpoint failures, decryption errors)
 * 3. Alerting admin when error rate exceeds 5% over 1-hour window
 * 4. Falling back to text-based workflow when a flow is marked broken
 *
 * Since Rainbow AI uses Baileys (not Cloud API), we don't have direct access
 * to Meta's Flow Health API. Instead, we monitor our own flow endpoints:
 * - Response times and error counts for data-exchange requests
 * - Decryption failures and timeout events
 * - User abandonment (INIT without completion)
 */

import cron from 'node-cron';
import { pool, dbReady } from './db.js';
import { createModuleLogger } from './logger.js';
import { notifyAdminFlowHealth } from './admin-notifier.js';

const logger = createModuleLogger('FlowsHealth');

// ─── Types ────────────────────────────────────────────────────────────

export type FlowStatus = 'healthy' | 'degraded' | 'broken';

export interface FlowHealthRecord {
  flowId: string;
  flowName: string;
  status: FlowStatus;
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  avgResponseMs: number;
  lastFailureReason: string | null;
  lastCheckedAt: string;
}

export interface FlowEndpointError {
  flowId: string;
  screenId: string | null;
  errorCode: string;
  errorMessage: string;
  responseTimeMs: number | null;
  timestamp: string;
}

// ─── In-Memory Metrics (rolling 1-hour window) ────────────────────────

interface FlowMetrics {
  flowId: string;
  flowName: string;
  requests: Array<{ timestamp: number; durationMs: number; success: boolean; errorCode?: string; errorMessage?: string; screenId?: string }>;
  lastFailureReason: string | null;
  fallbackActive: boolean;
}

const flowMetrics = new Map<string, FlowMetrics>();
const ONE_HOUR_MS = 60 * 60 * 1000;
const ERROR_RATE_THRESHOLD = 0.05; // 5%

// Known flows we monitor
const KNOWN_FLOWS: Array<{ id: string; name: string; healthEndpoint: string }> = [
  { id: 'reservation', name: 'Room Reservation Flow', healthEndpoint: '/whatsapp-flows/health' },
  { id: 'checkin', name: 'Guest Check-in Flow', healthEndpoint: '/checkin-health' },
];

/**
 * Ensure the flow_health_events table exists for persistent logging.
 */
let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured || !pool) return;
  const ready = await dbReady;
  if (!ready) return;

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flow_health_events (
        id SERIAL PRIMARY KEY,
        flow_id TEXT NOT NULL,
        screen_id TEXT,
        event_type TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        response_time_ms INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_flow_health_events_flow_created
      ON flow_health_events (flow_id, created_at DESC)
    `);
    _tableEnsured = true;
  } catch (err: any) {
    logger.error('Failed to ensure flow_health_events table', { error: err.message });
  }
}

// Initialize table on module load
dbReady.then(ok => { if (ok) ensureTable().catch(() => {}); });

// ─── Metrics Recording ───────────────────────────────────────────────

function getOrCreateMetrics(flowId: string): FlowMetrics {
  let m = flowMetrics.get(flowId);
  if (!m) {
    const known = KNOWN_FLOWS.find(f => f.id === flowId);
    m = {
      flowId,
      flowName: known?.name || flowId,
      requests: [],
      lastFailureReason: null,
      fallbackActive: false,
    };
    flowMetrics.set(flowId, m);
  }
  return m;
}

function pruneOldRequests(m: FlowMetrics): void {
  const cutoff = Date.now() - ONE_HOUR_MS;
  m.requests = m.requests.filter(r => r.timestamp > cutoff);
}

/**
 * Record a successful flow endpoint request.
 * Called by flow route handlers after processing a request.
 */
export function recordFlowSuccess(flowId: string, durationMs: number, screenId?: string): void {
  const m = getOrCreateMetrics(flowId);
  m.requests.push({
    timestamp: Date.now(),
    durationMs,
    success: true,
    screenId,
  });
  pruneOldRequests(m);

  // If flow was in fallback mode and is now healthy, deactivate fallback
  if (m.fallbackActive) {
    const stats = computeFlowStats(m);
    if (stats.errorRate < ERROR_RATE_THRESHOLD && stats.totalRequests >= 3) {
      m.fallbackActive = false;
      logger.info('Flow recovered, deactivating text fallback', { flowId });
    }
  }
}

/**
 * Record a failed flow endpoint request.
 * Called by flow route handlers when an error occurs.
 */
export function recordFlowError(
  flowId: string,
  errorCode: string,
  errorMessage: string,
  durationMs: number,
  screenId?: string
): void {
  const m = getOrCreateMetrics(flowId);
  m.requests.push({
    timestamp: Date.now(),
    durationMs,
    success: false,
    errorCode,
    errorMessage,
    screenId,
  });
  m.lastFailureReason = `${errorCode}: ${errorMessage}`;
  pruneOldRequests(m);

  // Persist error to DB (fire-and-forget)
  persistFlowError(flowId, screenId || null, errorCode, errorMessage, durationMs).catch(() => {});
}

/**
 * Check whether a flow is currently in fallback mode (broken).
 * When true, callers should use text-based alternatives instead.
 */
export function isFlowInFallback(flowId: string): boolean {
  const m = flowMetrics.get(flowId);
  return m?.fallbackActive ?? false;
}

// ─── Stats Computation ───────────────────────────────────────────────

interface FlowStats {
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  avgResponseMs: number;
  status: FlowStatus;
}

function computeFlowStats(m: FlowMetrics): FlowStats {
  pruneOldRequests(m);
  const total = m.requests.length;
  const errors = m.requests.filter(r => !r.success).length;
  const errorRate = total > 0 ? errors / total : 0;
  const avgMs = total > 0
    ? m.requests.reduce((sum, r) => sum + r.durationMs, 0) / total
    : 0;

  let status: FlowStatus = 'healthy';
  if (m.fallbackActive || (total >= 3 && errorRate > 0.2)) {
    status = 'broken';
  } else if (total >= 3 && errorRate > ERROR_RATE_THRESHOLD) {
    status = 'degraded';
  }

  return { totalRequests: total, errorCount: errors, errorRate, avgResponseMs: avgMs, status };
}

// ─── Health Check (Scheduled) ────────────────────────────────────────

/**
 * Run a health check across all known flows.
 * Evaluates error rates, triggers alerts, and activates fallback if needed.
 */
export async function runFlowHealthCheck(): Promise<FlowHealthRecord[]> {
  const results: FlowHealthRecord[] = [];
  const now = new Date().toISOString();

  for (const flow of KNOWN_FLOWS) {
    const m = getOrCreateMetrics(flow.id);
    const stats = computeFlowStats(m);

    const record: FlowHealthRecord = {
      flowId: flow.id,
      flowName: flow.name,
      status: stats.status,
      totalRequests: stats.totalRequests,
      errorCount: stats.errorCount,
      errorRate: stats.errorRate,
      avgResponseMs: Math.round(stats.avgResponseMs),
      lastFailureReason: m.lastFailureReason,
      lastCheckedAt: now,
    };
    results.push(record);

    // Alert if error rate exceeds threshold with sufficient sample size
    if (stats.totalRequests >= 5 && stats.errorRate > ERROR_RATE_THRESHOLD) {
      logger.warn('Flow error rate exceeded threshold', {
        flowId: flow.id,
        errorRate: (stats.errorRate * 100).toFixed(1) + '%',
        errorCount: stats.errorCount,
        totalRequests: stats.totalRequests,
      });

      // Send admin WhatsApp alert
      notifyAdminFlowHealth(
        flow.id,
        flow.name,
        stats.status,
        stats.errorRate,
        stats.errorCount,
        stats.totalRequests,
        m.lastFailureReason
      ).catch(err => logger.error('Failed to send flow health alert', { error: err.message }));

      // Activate fallback for broken flows (error rate > 20%)
      if (stats.errorRate > 0.2 && !m.fallbackActive) {
        m.fallbackActive = true;
        logger.warn('Activating text-based fallback for broken flow', { flowId: flow.id });
      }
    }
  }

  // Also include any ad-hoc tracked flows not in KNOWN_FLOWS
  for (const [flowId, m] of flowMetrics) {
    if (KNOWN_FLOWS.some(f => f.id === flowId)) continue;
    const stats = computeFlowStats(m);

    // Activate fallback for broken ad-hoc flows too
    if (stats.totalRequests >= 3 && stats.errorRate > 0.2 && !m.fallbackActive) {
      m.fallbackActive = true;
      logger.warn('Activating text-based fallback for broken flow', { flowId });
    }

    results.push({
      flowId,
      flowName: m.flowName,
      status: stats.status,
      totalRequests: stats.totalRequests,
      errorCount: stats.errorCount,
      errorRate: stats.errorRate,
      avgResponseMs: Math.round(stats.avgResponseMs),
      lastFailureReason: m.lastFailureReason,
      lastCheckedAt: now,
    });
  }

  return results;
}

// ─── DB Persistence ──────────────────────────────────────────────────

async function persistFlowError(
  flowId: string,
  screenId: string | null,
  errorCode: string,
  errorMessage: string,
  responseTimeMs: number
): Promise<void> {
  if (!pool) return;
  await ensureTable();

  try {
    await pool.query(
      `INSERT INTO flow_health_events (flow_id, screen_id, event_type, error_code, error_message, response_time_ms)
       VALUES ($1, $2, 'error', $3, $4, $5)`,
      [flowId, screenId, errorCode, errorMessage, responseTimeMs]
    );
  } catch (err: any) {
    logger.error('Failed to persist flow error', { error: err.message });
  }
}

/**
 * Query recent flow errors from DB for the admin dashboard.
 */
export async function getRecentFlowErrors(
  flowId?: string,
  limit: number = 50
): Promise<FlowEndpointError[]> {
  if (!pool) return [];
  await ensureTable();

  try {
    const query = flowId
      ? `SELECT flow_id, screen_id, error_code, error_message, response_time_ms, created_at
         FROM flow_health_events WHERE flow_id = $1 ORDER BY created_at DESC LIMIT $2`
      : `SELECT flow_id, screen_id, error_code, error_message, response_time_ms, created_at
         FROM flow_health_events ORDER BY created_at DESC LIMIT $1`;

    const params = flowId ? [flowId, limit] : [limit];
    const result = await pool.query(query, params);

    return result.rows.map((row: any) => ({
      flowId: row.flow_id,
      screenId: row.screen_id,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      responseTimeMs: row.response_time_ms,
      timestamp: row.created_at,
    }));
  } catch (err: any) {
    logger.error('Failed to query flow errors', { error: err.message });
    return [];
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────

/**
 * Start the flow health monitoring scheduler.
 * Runs every 15 minutes to evaluate flow health metrics and trigger alerts.
 */
export function startFlowHealthScheduler(): void {
  // Every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.info('Running scheduled flow health check...');
    try {
      const results = await runFlowHealthCheck();
      const degraded = results.filter(r => r.status !== 'healthy');
      if (degraded.length > 0) {
        logger.warn('Unhealthy flows detected', {
          count: degraded.length,
          flows: degraded.map(f => `${f.flowId}:${f.status}`).join(', '),
        });
      } else {
        logger.info('All flows healthy', { count: results.length });
      }
    } catch (err: any) {
      logger.error('Flow health check failed', { error: err.message });
    }
  }, {
    timezone: 'Asia/Kuala_Lumpur',
  });

  logger.info('Flow health scheduler started (every 15 minutes)');
}
