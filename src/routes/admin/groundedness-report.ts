/**
 * Admin Groundedness Report (US-993)
 *
 * Provides groundedness score histogram and stats for the admin dashboard.
 *
 * Endpoints:
 *   GET /analytics/groundedness-report          — Histogram + stats
 *   GET /analytics/groundedness-report/events   — Recent blocked events (paginated)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getGroundednessHistogram } from '../../assistant/groundedness-checker.js';
import { pool } from '../../lib/db.js';

const router = Router();

/**
 * GET /analytics/groundedness-report
 * Returns groundedness score histogram and summary statistics.
 * Query params: ?days=7&profile_id=pelangi
 */
router.get('/analytics/groundedness-report', async (req: Request, res: Response) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
    const profileId = req.query.profile_id as string || res.locals.tenantId || undefined;

    const histogram = await getGroundednessHistogram(profileId, days);

    res.json({
      period: `${days} days`,
      ...histogram,
      note: 'Groundedness score = fraction of response sentences supported by KB context. Responses below the configured threshold (default 0.6) are blocked.',
    });
  } catch (err: any) {
    console.error('[GroundednessReport] Stats error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /analytics/groundedness-report/events
 * Returns recent groundedness events (paginated).
 * Query params: ?limit=20&offset=0&blocked_only=true&profile_id=pelangi
 */
router.get('/analytics/groundedness-report/events', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const blockedOnly = req.query.blocked_only !== 'false';
    const profileId = req.query.profile_id as string || res.locals.tenantId || undefined;

    let query = `
      SELECT id, phone, profile_id, user_message, ai_response,
             groundedness_score, grounded_count, evaluated_count,
             threshold, blocked, latency_ms, created_at
      FROM groundedness_events
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIdx = 1;

    if (blockedOnly) {
      query += ` AND blocked = true`;
    }
    if (profileId) {
      query += ` AND profile_id = $${paramIdx++}`;
      params.push(profileId);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) FROM groundedness_events WHERE 1=1`;
    const countParams: any[] = [];
    let countIdx = 1;
    if (blockedOnly) countQuery += ` AND blocked = true`;
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
    console.error('[GroundednessReport] Events error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
