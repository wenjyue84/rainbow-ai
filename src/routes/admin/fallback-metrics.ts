/**
 * Admin API: Fallback Response Effectiveness Metrics (US-077)
 *
 * GET /admin/fallback-metrics
 *   Returns top 5 fallback templates sorted by escalation_rate DESC,
 *   showing which templates most often precede escalations.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { pool } from '../../lib/db.js';

const router = Router();

// GET /admin/fallback-metrics — Top 5 escalation-prone fallback templates
router.get('/fallback-metrics', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT
        fallback_response_template_id AS template_id,
        COUNT(*) AS total_escalations,
        COUNT(CASE WHEN escalation_within_2_msgs = true THEN 1 END) AS escalations_within_2_msgs,
        ROUND(
          COUNT(CASE WHEN escalation_within_2_msgs = true THEN 1 END)::numeric
          / NULLIF(COUNT(*), 0) * 100,
          1
        ) AS escalation_rate,
        MIN(created_at) AS first_seen,
        MAX(created_at) AS last_seen
      FROM escalation_events
      WHERE fallback_response_template_id IS NOT NULL
      GROUP BY fallback_response_template_id
      ORDER BY escalation_rate DESC
      LIMIT 5`
    );

    res.json({
      templates: result.rows.map((r: any) => ({
        template_id: r.template_id,
        total_escalations: parseInt(r.total_escalations) || 0,
        escalations_within_2_msgs: parseInt(r.escalations_within_2_msgs) || 0,
        escalation_rate: parseFloat(r.escalation_rate) || 0,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
      })),
    });
  } catch (err: any) {
    console.error('[FallbackMetrics] Query failed:', err.message);
    res.status(500).json({ error: 'Failed to compute fallback metrics' });
  }
});

export default router;
