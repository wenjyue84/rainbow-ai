/**
 * Admin Misinformation Report (US-955)
 *
 * OWASP LLM09 misinformation guardrail analytics — daily counts of
 * factual queries blocked due to missing KB grounding, plus combined
 * hallucination + groundedness + misinformation overview.
 *
 * Endpoints:
 *   GET /analytics/misinformation-report         — Summary stats + daily breakdown
 *   GET /analytics/misinformation-report/events   — Recent blocked events (paginated)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getMisinformationStats } from '../../assistant/misinformation-guardrail.js';
import { pool } from '../../lib/db.js';

const router = Router();

/**
 * GET /analytics/misinformation-report
 * Returns misinformation guardrail summary with daily counts.
 * Query params: ?days=7&profile_id=pelangi
 */
router.get('/analytics/misinformation-report', async (req: Request, res: Response) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
    const profileId = req.query.profile_id as string || res.locals.tenantId || undefined;

    const stats = await getMisinformationStats(profileId, days);

    res.json({
      period: `${days} days`,
      owasp: 'LLM09:2025 Misinformation',
      ...stats,
      note: 'Factual queries (pricing, availability, policy, hours, contact) are blocked when no KB context is retrieved. This prevents the AI from guessing or hallucinating operational facts.',
    });
  } catch (err: any) {
    console.error('[MisinformationReport] Stats error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /analytics/misinformation-report/events
 * Returns recent misinformation guardrail events (paginated).
 * Query params: ?limit=20&offset=0&blocked_only=true&profile_id=pelangi
 */
router.get('/analytics/misinformation-report/events', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const blockedOnly = req.query.blocked_only !== 'false';
    const profileId = req.query.profile_id as string || res.locals.tenantId || undefined;

    // Ensure table exists before querying
    await pool.query(`
      CREATE TABLE IF NOT EXISTS misinformation_events (
        id SERIAL PRIMARY KEY,
        phone TEXT,
        profile_id TEXT,
        user_message TEXT,
        intent TEXT,
        is_factual_query BOOLEAN NOT NULL DEFAULT false,
        retrieval_used BOOLEAN NOT NULL DEFAULT false,
        source_documents TEXT[],
        block_reason TEXT,
        grounding_confidence REAL NOT NULL DEFAULT 0,
        blocked BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    let query = `
      SELECT id, phone, profile_id, user_message, intent,
             is_factual_query, retrieval_used, source_documents,
             block_reason, grounding_confidence, blocked, created_at
      FROM misinformation_events
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

    // Total count for pagination
    let countQuery = `SELECT COUNT(*) FROM misinformation_events WHERE 1=1`;
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
    console.error('[MisinformationReport] Events error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
