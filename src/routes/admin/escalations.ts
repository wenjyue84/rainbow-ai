/**
 * Admin API: Escalation Events (US-429, US-836, US-914)
 *
 * GET /escalations              — List recent escalation events
 * GET /escalations/:id          — Get single escalation event with summary
 * GET /escalations/handoffs/open — Open handoffs with SLA status (US-836)
 * GET /escalations/analytics/pickup — P90 escalation-to-pickup time (US-914)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { pool } from '../../lib/db.js';
import { escalationEvents } from '../../../shared/schema-tables.js';
import { eq, desc } from 'drizzle-orm';
import { getOpenHandoffs } from '../../lib/handoff-sla.js';

const router = Router();

// Express 5: async errors auto-propagate to error-handling middleware

// GET /escalations — List recent escalation events
router.get('/escalations', async (_req: Request, res: Response) => {
  const limit = Math.min(parseInt(_req.query.limit as string) || 50, 200);
  const rows = await db.select()
    .from(escalationEvents)
    .orderBy(desc(escalationEvents.createdAt))
    .limit(limit);

  res.json({ escalations: rows });
});

// GET /escalations/handoffs/open — Open handoffs with SLA status (US-836)
router.get('/escalations/handoffs/open', async (_req: Request, res: Response) => {
  const handoffs = await getOpenHandoffs();
  res.json({ handoffs });
});

// GET /escalations/analytics/pickup — P90 escalation-to-pickup time (US-914)
// Returns P50/P90/P99 time-to-first-human-response in seconds, last 7d and 30d.
router.get('/escalations/analytics/pickup', async (_req: Request, res: Response) => {
  const result = await pool.query(`
    SELECT
      PERCENTILE_CONT(0.50) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (human_responded_at - created_at))
      ) AS p50_7d,
      PERCENTILE_CONT(0.90) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (human_responded_at - created_at))
      ) AS p90_7d,
      PERCENTILE_CONT(0.99) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (human_responded_at - created_at))
      ) AS p99_7d,
      COUNT(*) FILTER (WHERE human_responded_at IS NOT NULL) AS responded_count_7d,
      COUNT(*) AS total_count_7d
    FROM escalation_events
    WHERE created_at >= NOW() - INTERVAL '7 days'
  `);

  const result30d = await pool.query(`
    SELECT
      PERCENTILE_CONT(0.50) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (human_responded_at - created_at))
      ) AS p50_30d,
      PERCENTILE_CONT(0.90) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (human_responded_at - created_at))
      ) AS p90_30d,
      COUNT(*) FILTER (WHERE human_responded_at IS NOT NULL) AS responded_count_30d,
      COUNT(*) AS total_count_30d
    FROM escalation_events
    WHERE created_at >= NOW() - INTERVAL '30 days'
  `);

  const row7d = result.rows[0] ?? {};
  const row30d = result30d.rows[0] ?? {};

  res.json({
    pickupTimeSeconds: {
      last7d: {
        p50: row7d.p50_7d !== null ? Math.round(Number(row7d.p50_7d)) : null,
        p90: row7d.p90_7d !== null ? Math.round(Number(row7d.p90_7d)) : null,
        p99: row7d.p99_7d !== null ? Math.round(Number(row7d.p99_7d)) : null,
        respondedCount: Number(row7d.responded_count_7d ?? 0),
        totalCount: Number(row7d.total_count_7d ?? 0),
      },
      last30d: {
        p50: row30d.p50_30d !== null ? Math.round(Number(row30d.p50_30d)) : null,
        p90: row30d.p90_30d !== null ? Math.round(Number(row30d.p90_30d)) : null,
        respondedCount: Number(row30d.responded_count_30d ?? 0),
        totalCount: Number(row30d.total_count_30d ?? 0),
      },
    },
    description: 'Escalation-to-first-human-response time in seconds',
  });
});

// GET /escalations/:id — Get single escalation event with summary
router.get('/escalations/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid escalation ID' });
    return;
  }

  const rows = await db.select()
    .from(escalationEvents)
    .where(eq(escalationEvents.id, id))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: 'Escalation event not found' });
    return;
  }

  res.json({ escalation: rows[0] });
});

export default router;
