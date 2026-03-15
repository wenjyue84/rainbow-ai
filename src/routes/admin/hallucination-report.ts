/**
 * Admin Hallucination Report (US-913)
 *
 * Provides hallucination detection statistics and weekly reports.
 *
 * Endpoints:
 *   GET /analytics/hallucination-report       — Weekly summary stats
 *   GET /analytics/hallucination-report/events — Recent flagged events (paginated)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getHallucinationStats } from '../../assistant/hallucination-detector.js';
import { pool } from '../../lib/db.js';

const router = Router();

/**
 * GET /analytics/hallucination-report
 * Returns weekly hallucination detection summary.
 * Query params: ?days=7&profile_id=pelangi
 */
router.get('/analytics/hallucination-report', async (req: Request, res: Response) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
    const profileId = req.query.profile_id as string || res.locals.tenantId || undefined;

    const stats = await getHallucinationStats(profileId, days);

    res.json({
      period: `${days} days`,
      ...stats,
      falsePositiveNote: 'Target: <5% false positive rate. Review flagged events to calibrate severity_threshold.',
    });
  } catch (err: any) {
    console.error('[HallucinationReport] Stats error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /analytics/hallucination-report/events
 * Returns recent hallucination events (paginated).
 * Query params: ?limit=20&offset=0&flagged_only=true&profile_id=pelangi
 */
router.get('/analytics/hallucination-report/events', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const flaggedOnly = req.query.flagged_only !== 'false';
    const profileId = req.query.profile_id as string || res.locals.tenantId || undefined;

    let query = `
      SELECT id, phone, profile_id, user_message, ai_response,
             is_factual_query, verdicts, contradictions, max_severity,
             action_taken, flagged, latency_ms, created_at
      FROM hallucination_events
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIdx = 1;

    if (flaggedOnly) {
      query += ` AND flagged = true`;
    }
    if (profileId) {
      query += ` AND profile_id = $${paramIdx++}`;
      params.push(profileId);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) FROM hallucination_events WHERE 1=1`;
    const countParams: any[] = [];
    let countIdx = 1;
    if (flaggedOnly) countQuery += ` AND flagged = true`;
    if (profileId) {
      countQuery += ` AND profile_id = $${countIdx++}`;
      countParams.push(profileId);
    }
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      events: result.rows,
      total: parseInt(countResult.rows[0]?.count || '0'),
      limit,
      offset,
    });
  } catch (err: any) {
    console.error('[HallucinationReport] Events error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
