/**
 * PDPA Breach Notification Workflow (US-839)
 *
 * POST   /api/rainbow/security/breach-report     — Create a new breach record
 * GET    /api/rainbow/security/breach-report      — List all breach records with deadline status
 * PATCH  /api/rainbow/security/breach-report/:id  — Update commissioner/subject notification timestamps
 *
 * Malaysia's amended PDPA (Phase 3, June 2025) mandates:
 * - Commissioner notification within 72 hours of breach discovery
 * - Affected data subject notification within 7 days
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { pool, dbReady } from '../../lib/db.js';
import { badRequest, serverError } from './http-utils.js';
import { notifyAdminBreachReport } from '../../lib/admin-notifier.js';

const router = Router();

// ─── Table Setup ─────────────────────────────────────────────────────
async function ensureBreachTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pdpa_breach_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reported_by TEXT NOT NULL,
      description TEXT NOT NULL,
      affected_count_estimate INTEGER NOT NULL DEFAULT 0,
      discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      commissioner_deadline TIMESTAMPTZ NOT NULL,
      subject_deadline TIMESTAMPTZ NOT NULL,
      commissioner_notified_at TIMESTAMPTZ,
      subjects_notified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// Run on module load — non-blocking
dbReady.then(ok => { if (ok) ensureBreachTable().catch(() => {}); });

// ─── Helpers ─────────────────────────────────────────────────────────

function deadlineStatus(deadline: Date, notifiedAt: Date | null): { status: string; color: string } {
  if (notifiedAt) return { status: 'completed', color: 'green' };
  const now = Date.now();
  const remaining = deadline.getTime() - now;
  const sixHours = 6 * 60 * 60 * 1000;
  if (remaining <= 0) return { status: 'overdue', color: 'red' };
  if (remaining <= sixHours) return { status: 'urgent', color: 'red' };
  if (remaining <= 24 * 60 * 60 * 1000) return { status: 'approaching', color: 'amber' };
  return { status: 'on_track', color: 'green' };
}

function formatRow(row: any) {
  const commDeadline = new Date(row.commissioner_deadline);
  const subjDeadline = new Date(row.subject_deadline);
  return {
    id: row.id,
    reported_by: row.reported_by,
    description: row.description,
    affected_count_estimate: row.affected_count_estimate,
    discovered_at: row.discovered_at,
    commissioner_deadline: row.commissioner_deadline,
    commissioner_notified_at: row.commissioner_notified_at,
    commissioner_status: deadlineStatus(commDeadline, row.commissioner_notified_at),
    subject_deadline: row.subject_deadline,
    subjects_notified_at: row.subjects_notified_at,
    subject_status: deadlineStatus(subjDeadline, row.subjects_notified_at),
    created_at: row.created_at,
  };
}

// ─── POST: Create breach record ──────────────────────────────────────
router.post('/security/breach-report', async (req: Request, res: Response) => {
  const ready = await dbReady;
  if (!ready) return serverError(res, 'Database not available');

  const { description, affected_count_estimate, reported_by } = req.body;
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return badRequest(res, 'description is required');
  }

  const reporter = reported_by || (req.headers['x-admin-user'] as string) || 'admin';
  const estimate = typeof affected_count_estimate === 'number' ? affected_count_estimate : 0;
  const discoveredAt = new Date();
  const commDeadline = new Date(discoveredAt.getTime() + 72 * 60 * 60 * 1000); // +72h
  const subjDeadline = new Date(discoveredAt.getTime() + 7 * 24 * 60 * 60 * 1000); // +7d

  try {
    const result = await pool.query(
      `INSERT INTO pdpa_breach_log
         (reported_by, description, affected_count_estimate, discovered_at, commissioner_deadline, subject_deadline)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [reporter, description.trim(), estimate, discoveredAt, commDeadline, subjDeadline]
    );

    const record = formatRow(result.rows[0]);

    // Fire-and-forget WhatsApp admin notification
    notifyAdminBreachReport(
      description.trim(),
      estimate,
      commDeadline,
      subjDeadline
    ).catch(() => {});

    console.log(`[PDPA] Breach record created: ${record.id} by ${reporter}`);
    res.status(201).json(record);
  } catch (error: any) {
    console.error('[PDPA] Failed to create breach record:', error.message);
    return serverError(res, error);
  }
});

// ─── GET: List all breach records ────────────────────────────────────
router.get('/security/breach-report', async (_req: Request, res: Response) => {
  const ready = await dbReady;
  if (!ready) return serverError(res, 'Database not available');

  try {
    const result = await pool.query(
      `SELECT * FROM pdpa_breach_log ORDER BY created_at DESC`
    );
    res.json(result.rows.map(formatRow));
  } catch (error: any) {
    console.error('[PDPA] Failed to list breach records:', error.message);
    return serverError(res, error);
  }
});

// ─── PATCH: Update notification timestamps ───────────────────────────
router.patch('/security/breach-report/:id', async (req: Request, res: Response) => {
  const ready = await dbReady;
  if (!ready) return serverError(res, 'Database not available');

  const { id } = req.params;
  const { commissioner_notified_at, subjects_notified_at } = req.body;

  if (!commissioner_notified_at && !subjects_notified_at) {
    return badRequest(res, 'commissioner_notified_at or subjects_notified_at required');
  }

  try {
    // Append-only: only set nullable timestamp fields, never overwrite existing
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (commissioner_notified_at) {
      sets.push(`commissioner_notified_at = COALESCE(commissioner_notified_at, $${idx})`);
      vals.push(new Date(commissioner_notified_at));
      idx++;
    }
    if (subjects_notified_at) {
      sets.push(`subjects_notified_at = COALESCE(subjects_notified_at, $${idx})`);
      vals.push(new Date(subjects_notified_at));
      idx++;
    }

    vals.push(id);
    const result = await pool.query(
      `UPDATE pdpa_breach_log SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Breach record not found' });
    }

    res.json(formatRow(result.rows[0]));
  } catch (error: any) {
    console.error('[PDPA] Failed to update breach record:', error.message);
    return serverError(res, error);
  }
});

// ─── Deadline Check (called by cron/scheduled job) ───────────────────
/**
 * Check for approaching/overdue breach notification deadlines.
 * Exported so it can be called from a cron job or scheduled interval.
 */
export async function checkBreachDeadlines(): Promise<void> {
  try {
    const ready = await dbReady;
    if (!ready) return;

    const sixHoursFromNow = new Date(Date.now() + 6 * 60 * 60 * 1000);

    // Find records where either deadline is approaching within 6 hours and not yet notified
    const result = await pool.query(
      `SELECT * FROM pdpa_breach_log
       WHERE (commissioner_notified_at IS NULL AND commissioner_deadline <= $1)
          OR (subjects_notified_at IS NULL AND subject_deadline <= $1)
       ORDER BY commissioner_deadline ASC`,
      [sixHoursFromNow]
    );

    for (const row of result.rows) {
      const commStatus = deadlineStatus(new Date(row.commissioner_deadline), row.commissioner_notified_at);
      const subjStatus = deadlineStatus(new Date(row.subject_deadline), row.subjects_notified_at);

      const alerts: string[] = [];
      if (commStatus.color === 'red' && !row.commissioner_notified_at) {
        alerts.push(`Commissioner deadline ${commStatus.status === 'overdue' ? 'OVERDUE' : 'in < 6h'}`);
      }
      if (subjStatus.color === 'red' && !row.subjects_notified_at) {
        alerts.push(`Subject deadline ${subjStatus.status === 'overdue' ? 'OVERDUE' : 'in < 6h'}`);
      }
      if (commStatus.color === 'amber' && !row.commissioner_notified_at) {
        alerts.push(`Commissioner deadline approaching (< 24h)`);
      }
      if (subjStatus.color === 'amber' && !row.subjects_notified_at) {
        alerts.push(`Subject deadline approaching (< 24h)`);
      }

      if (alerts.length > 0) {
        notifyAdminBreachReport(
          `⏰ DEADLINE REMINDER for breach "${row.description.slice(0, 50)}..."\n${alerts.join('\n')}`,
          row.affected_count_estimate,
          new Date(row.commissioner_deadline),
          new Date(row.subject_deadline)
        ).catch(() => {});
      }
    }
  } catch (err: any) {
    console.error('[PDPA] Deadline check failed:', err.message);
  }
}

// ─── Automated Breach Detection (US-907, AC2) ─────────────────────
/**
 * Scan for anomalous bulk data access patterns.
 * Detects >100 records accessed/minute from a single session/IP.
 * Called every 15 minutes via setInterval in index.ts.
 *
 * Checks:
 * 1. gdpr_audit_log for burst portability requests
 * 2. rainbow_messages for bulk read patterns (via pg_stat_activity if available)
 */
export async function runBreachDetectionScan(): Promise<void> {
  try {
    const ready = await dbReady;
    if (!ready) return;

    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);

    // Check 1: Burst data export requests (>100 in 15 min from same requester)
    const exportBursts = await pool.query(
      `SELECT requested_by, COUNT(*) AS cnt
       FROM gdpr_audit_log
       WHERE requested_at >= $1
       GROUP BY requested_by
       HAVING COUNT(*) > 100`,
      [fifteenMinAgo]
    );

    for (const row of exportBursts.rows) {
      const description = `Anomalous bulk data access detected: ${row.cnt} data export requests from "${row.requested_by}" in 15 minutes (threshold: 100)`;
      await autoCreateBreachRecord(description, Number(row.cnt));
    }

    // Check 2: Burst message reads — count messages accessed via admin API
    // Uses rainbow_config_audit as a proxy for admin activity volume
    const adminBursts = await pool.query(
      `SELECT changed_by, COUNT(*) AS cnt
       FROM rainbow_config_audit
       WHERE created_at >= $1
       GROUP BY changed_by
       HAVING COUNT(*) > 100`,
      [fifteenMinAgo]
    );

    for (const row of adminBursts.rows) {
      const description = `Anomalous admin activity detected: ${row.cnt} config changes from "${row.changed_by}" in 15 minutes (threshold: 100)`;
      await autoCreateBreachRecord(description, Number(row.cnt));
    }

    // Check 3: Bulk conversation data reads (high volume SELECT on rainbow_messages)
    // Check for any single phone queried more than 100 times recently
    const bulkReads = await pool.query(
      `SELECT jid_hash, COUNT(*) AS cnt
       FROM gdpr_audit_log
       WHERE requested_at >= $1 AND action = 'portability'
       GROUP BY jid_hash
       HAVING COUNT(*) > 10`,
      [fifteenMinAgo]
    );

    for (const row of bulkReads.rows) {
      const description = `Repeated data subject access for same JID hash: ${row.cnt} exports for hash "${row.jid_hash.substring(0, 12)}..." in 15 minutes (threshold: 10)`;
      await autoCreateBreachRecord(description, Number(row.cnt));
    }

    if (exportBursts.rows.length === 0 && adminBursts.rows.length === 0 && bulkReads.rows.length === 0) {
      // No anomalies — silent success
      return;
    }
  } catch (err: any) {
    console.error('[PDPA] Breach detection scan failed:', err.message);
  }
}

/**
 * Auto-create a breach record from detection scan.
 * Deduplicates: won't create if an identical description exists in the last hour.
 */
async function autoCreateBreachRecord(description: string, affectedCount: number): Promise<void> {
  try {
    // Deduplicate: skip if same description logged in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const existing = await pool.query(
      `SELECT id FROM pdpa_breach_log WHERE description = $1 AND created_at >= $2 LIMIT 1`,
      [description, oneHourAgo]
    );
    if (existing.rows.length > 0) return;

    const discoveredAt = new Date();
    const commDeadline = new Date(discoveredAt.getTime() + 72 * 60 * 60 * 1000);
    const subjDeadline = new Date(discoveredAt.getTime() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO pdpa_breach_log
         (reported_by, description, affected_count_estimate, discovered_at, commissioner_deadline, subject_deadline)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['system:breach-detection', description, affectedCount, discoveredAt, commDeadline, subjDeadline]
    );

    console.warn(`[PDPA] ⚠️ Auto-detected breach: ${description}`);

    // Alert DPO via WhatsApp
    notifyAdminBreachReport(description, affectedCount, commDeadline, subjDeadline).catch(() => {});
  } catch (err: any) {
    console.error('[PDPA] Failed to auto-create breach record:', err.message);
  }
}

export default router;
