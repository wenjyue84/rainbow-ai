/**
 * Admin API: Escalation Events (US-429, US-836, US-914)
 *
 * GET /escalations                     — List recent escalation events
 * GET /escalations/:id                 — Get single escalation event with summary
 * GET /escalations/:id/context         — Full context handoff payload (US-914)
 * GET /escalations/handoffs/open       — Open handoffs with SLA status (US-836)
 * GET /escalations/analytics/pickup    — P90 pickup time analytics (US-914)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, pool } from '../../lib/db.js';
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

// GET /escalations/analytics/pickup — P90 pickup time analytics (US-914)
router.get('/escalations/analytics/pickup', async (_req: Request, res: Response) => {
  const days = Math.min(parseInt(_req.query.days as string) || 30, 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const result = await pool.query(
      `SELECT
        COUNT(*) AS total_escalations,
        COUNT(human_responded_at) AS total_pickups,
        ROUND(AVG(EXTRACT(EPOCH FROM (human_responded_at - created_at)))::numeric, 1) AS avg_pickup_seconds,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (human_responded_at - created_at))
        ) AS p50_pickup_seconds,
        PERCENTILE_CONT(0.9) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (human_responded_at - created_at))
        ) AS p90_pickup_seconds,
        PERCENTILE_CONT(0.95) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (human_responded_at - created_at))
        ) AS p95_pickup_seconds,
        COUNT(sla_breached_at) AS sla_breaches,
        ROUND(
          COUNT(human_responded_at)::numeric / NULLIF(COUNT(*), 0) * 100, 1
        ) AS pickup_rate_pct
      FROM escalation_events
      WHERE created_at >= $1
        AND human_responded_at IS NOT NULL`,
      [since]
    );

    // Daily breakdown for the period
    const dailyResult = await pool.query(
      `SELECT
        DATE(created_at) AS day,
        COUNT(*) AS escalations,
        COUNT(human_responded_at) AS pickups,
        ROUND(AVG(EXTRACT(EPOCH FROM (human_responded_at - created_at)))::numeric, 1) AS avg_pickup_seconds,
        PERCENTILE_CONT(0.9) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (human_responded_at - created_at))
        ) AS p90_pickup_seconds
      FROM escalation_events
      WHERE created_at >= $1
      GROUP BY DATE(created_at)
      ORDER BY day DESC
      LIMIT 30`,
      [since]
    );

    // Breakdown by trigger reason
    const triggerResult = await pool.query(
      `SELECT
        trigger,
        COUNT(*) AS count,
        COUNT(human_responded_at) AS pickups,
        ROUND(AVG(EXTRACT(EPOCH FROM (human_responded_at - created_at)))::numeric, 1) AS avg_pickup_seconds
      FROM escalation_events
      WHERE created_at >= $1
      GROUP BY trigger
      ORDER BY count DESC`,
      [since]
    );

    const stats = result.rows[0] || {};
    res.json({
      period_days: days,
      total_escalations: parseInt(stats.total_escalations) || 0,
      total_pickups: parseInt(stats.total_pickups) || 0,
      pickup_rate_pct: parseFloat(stats.pickup_rate_pct) || 0,
      avg_pickup_seconds: parseFloat(stats.avg_pickup_seconds) || 0,
      p50_pickup_seconds: parseFloat(stats.p50_pickup_seconds) || 0,
      p90_pickup_seconds: parseFloat(stats.p90_pickup_seconds) || 0,
      p95_pickup_seconds: parseFloat(stats.p95_pickup_seconds) || 0,
      sla_breaches: parseInt(stats.sla_breaches) || 0,
      daily_breakdown: dailyResult.rows,
      trigger_breakdown: triggerResult.rows,
    });
  } catch (err: any) {
    console.error('[Escalations] Analytics query failed:', err.message);
    res.status(500).json({ error: 'Failed to compute pickup analytics' });
  }
});

// GET /escalations/:id/context — Full context handoff payload (US-914)
router.get('/escalations/:id/context', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid escalation ID' });
    return;
  }

  // Fetch escalation event
  const rows = await db.select()
    .from(escalationEvents)
    .where(eq(escalationEvents.id, id))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: 'Escalation event not found' });
    return;
  }

  const event = rows[0];
  const jid = event.jid;

  // Fetch full conversation history from rainbow_messages
  let conversationHistory: Array<{ role: string; content: string; timestamp: string }> = [];
  try {
    const msgResult = await pool.query(
      `SELECT role, content, timestamp, staff_name
       FROM rainbow_messages
       WHERE phone = $1
       ORDER BY timestamp ASC
       LIMIT 100`,
      [jid]
    );
    conversationHistory = msgResult.rows.map((r: any) => ({
      role: r.role,
      content: r.content,
      timestamp: r.timestamp?.toISOString?.() || String(r.timestamp),
      ...(r.staff_name ? { staffName: r.staff_name } : {}),
    }));
  } catch (err: any) {
    console.warn('[Escalations] Failed to fetch conversation history:', err.message);
  }

  // Fetch customer contact details
  let customerName = jid;
  try {
    const contactResult = await pool.query(
      `SELECT push_name FROM rainbow_conversations WHERE phone = $1 LIMIT 1`,
      [jid]
    );
    if (contactResult.rows[0]?.push_name) {
      customerName = contactResult.rows[0].push_name;
    }
  } catch {
    // Fall back to JID
  }

  // Parse metadata
  let metadata: Record<string, any> = {};
  try {
    metadata = event.metadata ? JSON.parse(event.metadata) : {};
  } catch {
    // Invalid JSON, skip
  }

  // Build structured handoff payload per US-914 spec
  const handoffPayload = {
    escalation_id: event.id,
    case_id: metadata.caseId || null,
    customer_jid: jid,
    customer_name: customerName,
    profile_id: event.profileId,
    trigger_reason: event.trigger,
    trigger_detail: metadata.keywords || metadata.rules || null,
    ai_summary: event.summary || null,
    conversation_history: conversationHistory,
    collected_data: metadata,
    created_at: event.createdAt,
    sla_breached_at: event.slaBreachedAt || null,
    human_responded_at: event.humanRespondedAt || null,
    pickup_time_seconds: event.humanRespondedAt && event.createdAt
      ? Math.round((new Date(event.humanRespondedAt).getTime() - new Date(event.createdAt).getTime()) / 1000)
      : null,
  };

  res.json({ handoff: handoffPayload });
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
