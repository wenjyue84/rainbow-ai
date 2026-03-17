/**
 * PDPA Breach Notification Workflow (US-839 / US-020)
 *
 * POST   /api/rainbow/security/breach-report                  — Create a new breach record
 * GET    /api/rainbow/security/breach-report                   — List all breach records with deadline status
 * PATCH  /api/rainbow/security/breach-report/:id               — Update commissioner/subject notification timestamps
 * GET    /api/rainbow/security/breach-incidents                 — Active incidents with 72-hour countdown timers
 * PATCH  /api/rainbow/security/breach-incidents/:id/acknowledge — DPO acknowledgement
 *
 * Malaysia's amended PDPA (Phase 3, June 2025) mandates:
 * - Commissioner notification within 72 hours of breach discovery
 * - Affected data subject notification within 7 days
 * - 60-hour escalation alert if DPO has not acknowledged
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { pool, dbReady } from '../../lib/db.js';
import { badRequest, serverError } from './http-utils.js';
import { notifyAdminBreachReport } from '../../lib/admin-notifier.js';
import { sendDpoBreachEmail } from '../../lib/dpo-email.js';
import { configStore } from '../../assistant/config-store.js';
import { createModuleLogger } from '../../lib/logger.js';

const router = Router();
const logger = createModuleLogger('BreachReport');

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

async function ensureIncidentsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS breach_incidents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      breach_log_id UUID REFERENCES pdpa_breach_log(id) ON DELETE CASCADE,
      breach_type TEXT NOT NULL DEFAULT 'manual_report',
      data_categories TEXT[] NOT NULL DEFAULT '{}',
      estimated_affected INTEGER NOT NULL DEFAULT 0,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      dpo_notified_at TIMESTAMPTZ,
      acknowledged_at TIMESTAMPTZ,
      escalated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// Run on module load — non-blocking
dbReady.then(ok => {
  if (ok) {
    ensureBreachTable().catch(() => {});
    ensureIncidentsTable().catch(() => {});
  }
});

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

function countdownHours(from: Date, base: Date): number {
  return Math.max(0, Math.round((from.getTime() - base.getTime()) / 3_600_000));
}

function formatIncident(row: any) {
  const detectedAt = new Date(row.detected_at);
  const commissionerDeadline = new Date(detectedAt.getTime() + 72 * 60 * 60 * 1000);
  const now = new Date();
  return {
    id: row.id,
    breach_log_id: row.breach_log_id,
    breach_type: row.breach_type,
    data_categories: row.data_categories,
    estimated_affected: row.estimated_affected,
    detected_at: row.detected_at,
    dpo_notified_at: row.dpo_notified_at,
    acknowledged_at: row.acknowledged_at,
    escalated_at: row.escalated_at,
    created_at: row.created_at,
    countdown: {
      commissioner_deadline: commissionerDeadline,
      hours_remaining: countdownHours(commissionerDeadline, now),
      status: deadlineStatus(commissionerDeadline, row.acknowledged_at),
      escalation_threshold_hours: 60,
      hours_since_detection: Math.round((now.getTime() - detectedAt.getTime()) / 3_600_000),
    },
  };
}

/** Read DPO email from settings — used when creating notifications */
function getDpoEmail(): string {
  const settings = configStore.getSettings() as any;
  return settings?.pdpa?.dpo_email ?? '';
}

// ─── POST: Create breach record ──────────────────────────────────────
router.post('/security/breach-report', async (req: Request, res: Response) => {
  const ready = await dbReady;
  if (!ready) return serverError(res, 'Database not available');

  const { description, affected_count_estimate, reported_by, breach_type, data_categories } = req.body;
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return badRequest(res, 'description is required');
  }

  const reporter = reported_by || (req.headers['x-admin-user'] as string) || 'admin';
  const estimate = typeof affected_count_estimate === 'number' ? affected_count_estimate : 0;
  const categories: string[] = Array.isArray(data_categories) ? data_categories : [];
  const bType: string = typeof breach_type === 'string' ? breach_type : 'manual_report';
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

    // Create breach_incident record for US-020 pipeline
    const incidentResult = await pool.query(
      `INSERT INTO breach_incidents
         (breach_log_id, breach_type, data_categories, estimated_affected, detected_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [record.id, bType, categories, estimate, discoveredAt]
    );
    const incidentId: string = incidentResult.rows[0].id;

    // Send DPO email notification (US-020 — within 15 minutes of breach)
    const dpoEmail = getDpoEmail();
    if (dpoEmail) {
      sendDpoBreachEmail({
        incidentId,
        breachType: bType,
        detectedAt: discoveredAt,
        estimatedAffected: estimate,
        dataCategories: categories,
        description: description.trim(),
        dpoEmail,
        commissionerDeadline: commDeadline,
      }).then(sent => {
        if (sent) {
          pool.query(
            `UPDATE breach_incidents SET dpo_notified_at = NOW() WHERE id = $1`,
            [incidentId]
          ).catch(() => {});
        }
      }).catch(() => {});
    }

    // Fire-and-forget WhatsApp admin notification
    notifyAdminBreachReport(
      description.trim(),
      estimate,
      commDeadline,
      subjDeadline
    ).catch(() => {});

    logger.info('Breach record created', { id: record.id, reporter });
    res.status(201).json({ ...record, incident_id: incidentId });
  } catch (error: any) {
    logger.error('Failed to create breach record', { error: error.message });
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
    logger.error('Failed to list breach records', { error: error.message });
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
    logger.error('Failed to update breach record', { error: error.message });
    return serverError(res, error);
  }
});

// ─── GET: Active breach incidents with countdown timers ──────────────
router.get('/security/breach-incidents', async (_req: Request, res: Response) => {
  const ready = await dbReady;
  if (!ready) return serverError(res, 'Database not available');

  try {
    const result = await pool.query(
      `SELECT * FROM breach_incidents
       WHERE acknowledged_at IS NULL
       ORDER BY detected_at ASC`
    );
    const allResult = await pool.query(
      `SELECT * FROM breach_incidents
       WHERE acknowledged_at IS NOT NULL
       ORDER BY detected_at DESC
       LIMIT 20`
    );
    res.json({
      active: result.rows.map(formatIncident),
      recent_resolved: allResult.rows.map(formatIncident),
    });
  } catch (error: any) {
    logger.error('Failed to list breach incidents', { error: error.message });
    return serverError(res, error);
  }
});

// ─── PATCH: Acknowledge breach incident ─────────────────────────────
router.patch('/security/breach-incidents/:id/acknowledge', async (req: Request, res: Response) => {
  const ready = await dbReady;
  if (!ready) return serverError(res, 'Database not available');

  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE breach_incidents
       SET acknowledged_at = COALESCE(acknowledged_at, NOW())
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Breach incident not found' });
    }

    logger.info('Breach incident acknowledged', { id });
    res.json(formatIncident(result.rows[0]));
  } catch (error: any) {
    logger.error('Failed to acknowledge breach incident', { error: error.message });
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
    logger.error('Deadline check failed', { error: err.message });
  }
}

/**
 * Check breach_incidents for the 60-hour escalation rule.
 * Sends escalation alerts to all staff phones if DPO has not acknowledged within 60h.
 * Exported so it can be called from a scheduled interval.
 */
export async function checkBreachEscalations(): Promise<void> {
  try {
    const ready = await dbReady;
    if (!ready) return;

    const sixtyHoursAgo = new Date(Date.now() - 60 * 60 * 60 * 1000);

    // Find incidents: unacknowledged, not yet escalated, detected > 60h ago
    const result = await pool.query(
      `SELECT * FROM breach_incidents
       WHERE acknowledged_at IS NULL
         AND escalated_at IS NULL
         AND detected_at <= $1`,
      [sixtyHoursAgo]
    );

    for (const row of result.rows) {
      const detectedAt = new Date(row.detected_at);
      const hoursSince = Math.round((Date.now() - detectedAt.getTime()) / 3_600_000);
      const remaining = Math.max(0, 72 - hoursSince);

      const message =
        `🚨 *PDPA BREACH ESCALATION — ${remaining}h REMAINING*\n\n` +
        `Incident: ${row.id}\n` +
        `Breach Type: ${row.breach_type}\n` +
        `Detected: ${detectedAt.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })} MYT\n` +
        `Affected: ~${row.estimated_affected} individuals\n\n` +
        `⚠️ DPO has NOT acknowledged this breach after 60 hours.\n` +
        `Commissioner notification deadline is in ${remaining} hours.\n\n` +
        `Acknowledge: PATCH /api/rainbow/security/breach-incidents/${row.id}/acknowledge`;

      try {
        // Mark escalated before sending to prevent duplicate sends on next tick
        await pool.query(
          `UPDATE breach_incidents SET escalated_at = NOW() WHERE id = $1`,
          [row.id]
        );

        // Notify via WhatsApp (all admin phones via existing notifier)
        await notifyAdminBreachReport(
          message,
          row.estimated_affected,
          new Date(detectedAt.getTime() + 72 * 60 * 60 * 1000),
          new Date(detectedAt.getTime() + 7 * 24 * 60 * 60 * 1000)
        );

        logger.warn('Breach escalation sent', { incidentId: row.id, hoursSince });
      } catch (err: any) {
        // Reset escalated_at on failure so it retries next run
        await pool.query(
          `UPDATE breach_incidents SET escalated_at = NULL WHERE id = $1`,
          [row.id]
        ).catch(() => {});
        logger.error('Failed to send breach escalation', { id: row.id, error: err.message });
      }
    }
  } catch (err: any) {
    logger.error('Breach escalation check failed', { error: err.message });
  }
}

export default router;
