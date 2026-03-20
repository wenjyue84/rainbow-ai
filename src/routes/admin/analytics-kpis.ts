/**
 * Admin API: KPI Analytics (US-811, US-901, US-902)
 *
 * GET /analytics/kpis?profileId=pelangi&days=7 — CSAT, resolution rate, handoff rate, fallback rate, containment rate, order accuracy
 * GET /analytics/kpis/containment?profileId=pelangi — multi-period (24h, 7d, 30d) containment + 30-day trend sparkline
 * GET /analytics/kpis/containment/escalated?profileId=pelangi&days=7 — drill-down: escalated conversation IDs
 *
 * Alert thresholds: CSAT < 80%, Resolution rate < 60%, Containment rate < 70%, Order accuracy < 90% (configurable)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady } from '../../lib/db.js';
import { rainbowFeedback, rainbowConversations, rainbowMessages, escalationEvents, orderAccuracyEvents } from '../../../shared/schema.js';
import { sql, and, gte, eq, isNotNull, notInArray } from 'drizzle-orm';

const router = Router();

const ALERT_THRESHOLDS = {
  csat: 80,           // Alert if CSAT < 80%
  resolutionRate: 60, // Alert if resolution rate < 60%
  containmentRate: 70, // US-901: Alert if containment rate < 70%
  orderAccuracy: 90,  // US-902: Alert if order accuracy < 90%
};

// GET /analytics/kpis
router.get('/analytics/kpis', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({
        success: true,
        kpis: emptyKpis(),
        alerts: [],
        warning: 'Database connection unavailable.',
      });
    }

    const profileId = (req.query.profileId as string) || (res.locals.profileId as string) || undefined;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Run core KPI queries in parallel; wrap optional tables in individual try-catch
    // so missing tables/columns don't crash the entire endpoint
    const [csatResult, conversationCount, escalationCount, fallbackResult, faithfulnessResult, orderAccuracyResult, msgPerConvoResult] = await Promise.all([
      // 1. CSAT — from rainbow_feedback
      db
        .select({
          total: sql<number>`count(*)::int`,
          thumbsUp: sql<number>`count(*) filter (where rating = 1)::int`,
        })
        .from(rainbowFeedback)
        .where(and(
          gte(rainbowFeedback.createdAt, since),
          profileId ? sql`true` : sql`true`, // rainbow_feedback has no profileId column; filter by joining if needed
        )),

      // 2. Total conversations in period
      db
        .select({
          total: sql<number>`count(*)::int`,
        })
        .from(rainbowConversations)
        .where(and(
          gte(rainbowConversations.updatedAt, since),
          profileId ? eq(rainbowConversations.profileId, profileId) : sql`true`,
        )),

      // 3. Escalation events in period (for handoff rate and resolution rate)
      db
        .select({
          total: sql<number>`count(*)::int`,
          uniqueJids: sql<number>`count(distinct jid)::int`,
        })
        .from(escalationEvents)
        .where(and(
          gte(escalationEvents.createdAt, since),
          profileId ? eq(escalationEvents.profileId, profileId) : sql`true`,
        )),

      // 4. Fallback rate — messages with unknown intent vs total user messages
      db
        .select({
          totalUserMessages: sql<number>`count(*) filter (where role = 'user')::int`,
          unknownMessages: sql<number>`count(*) filter (where role = 'user' and (intent = 'unknown' or intent = 'unknown_intent'))::int`,
        })
        .from(rainbowMessages)
        .where(and(
          gte(rainbowMessages.timestamp, since),
          profileId ? eq(rainbowMessages.profileId, profileId) : sql`true`,
        )),

      // 5. US-899: Faithfulness rate — table/column may not exist yet
      db
        .select({
          totalChecked: sql<number>`count(*) filter (where faithfulness_score is not null)::int`,
          lowFaithfulness: sql<number>`count(*) filter (where faithfulness_score is not null and faithfulness_score < 0.7)::int`,
          avgScore: sql<number>`avg(faithfulness_score) filter (where faithfulness_score is not null)`,
        })
        .from(rainbowMessages)
        .where(and(
          gte(rainbowMessages.timestamp, since),
          eq(rainbowMessages.role, 'assistant'),
          profileId ? eq(rainbowMessages.profileId, profileId) : sql`true`,
        ))
        .catch(() => [{ totalChecked: 0, lowFaithfulness: 0, avgScore: null }]),

      // 6. US-902: Order accuracy — table may not exist yet (graceful fallback)
      db
        .select({
          totalConfirmed: sql<number>`count(*) filter (where event_type = 'order_confirmed')::int`,
          totalCorrected: sql<number>`count(*) filter (where event_type = 'order_corrected')::int`,
          totalSentToKitchen: sql<number>`count(*) filter (where event_type = 'sent_to_kitchen')::int`,
        })
        .from(orderAccuracyEvents)
        .where(and(
          gte(orderAccuracyEvents.createdAt, since),
          profileId ? eq(orderAccuracyEvents.profileId, profileId) : sql`true`,
        ))
        .catch(() => [{ totalConfirmed: 0, totalCorrected: 0, totalSentToKitchen: 0 }]),

      // 7. US-023: Avg assistant messages per conversation (billing KPI — per-message pricing)
      // Counts outbound assistant messages grouped by phone, then averages across distinct phones.
      db.execute(sql`
        SELECT COALESCE(AVG(msg_count), 0)::float AS avg_msgs_per_convo,
               COALESCE(SUM(msg_count), 0)::int   AS total_assistant_msgs,
               COUNT(*)::int                       AS distinct_conversations
        FROM (
          SELECT phone, COUNT(*) AS msg_count
          FROM rainbow_messages
          WHERE role = 'assistant'
            AND deleted_at IS NULL
            AND timestamp >= ${since}
            ${profileId ? sql`AND profile_id = ${profileId}` : sql``}
          GROUP BY phone
        ) sub
      `),
    ]);

    const csat = csatResult[0];
    const conversations = conversationCount[0];
    const escalations = escalationCount[0];
    const fallback = fallbackResult[0];
    const faithfulness = faithfulnessResult[0];
    const orderAccuracy = orderAccuracyResult[0];
    const msgPerConvoRow = (msgPerConvoResult as any).rows?.[0] ?? (msgPerConvoResult as any)[0] ?? {};
    const avgMsgsPerConvo: number | null = msgPerConvoRow.avg_msgs_per_convo != null
      ? parseFloat(Number(msgPerConvoRow.avg_msgs_per_convo).toFixed(2))
      : null;

    // Calculate rates
    const csatScore = csat.total > 0 ? (csat.thumbsUp / csat.total) * 100 : null;
    const totalConvos = conversations.total;
    const escalatedConvos = escalations.uniqueJids;
    const resolvedByAI = totalConvos - escalatedConvos;
    const resolutionRate = totalConvos > 0 ? (resolvedByAI / totalConvos) * 100 : null;
    const handoffRate = totalConvos > 0 ? (escalatedConvos / totalConvos) * 100 : null;
    const fallbackRate = fallback.totalUserMessages > 0
      ? (fallback.unknownMessages / fallback.totalUserMessages) * 100
      : null;
    const lowFaithfulnessRate = faithfulness.totalChecked > 0
      ? (faithfulness.lowFaithfulness / faithfulness.totalChecked) * 100
      : null;

    // US-901: Containment rate = (conversations without escalation) / total * 100
    const containedConvos = totalConvos - escalatedConvos;
    const containmentRate = totalConvos > 0 ? (containedConvos / totalConvos) * 100 : null;

    // US-902: Order accuracy rate = (confirmed orders without correction) / total confirmed × 100
    const accurateOrders = orderAccuracy.totalConfirmed - orderAccuracy.totalCorrected;
    const orderAccuracyRate = orderAccuracy.totalConfirmed > 0
      ? (accurateOrders / orderAccuracy.totalConfirmed) * 100
      : null;

    // Generate alerts
    const alerts: Array<{ metric: string; value: number; threshold: number; message: string }> = [];
    if (csatScore !== null && csatScore < ALERT_THRESHOLDS.csat) {
      alerts.push({
        metric: 'csat',
        value: parseFloat(csatScore.toFixed(1)),
        threshold: ALERT_THRESHOLDS.csat,
        message: `CSAT score (${csatScore.toFixed(1)}%) is below ${ALERT_THRESHOLDS.csat}% threshold`,
      });
    }
    if (resolutionRate !== null && resolutionRate < ALERT_THRESHOLDS.resolutionRate) {
      alerts.push({
        metric: 'resolutionRate',
        value: parseFloat(resolutionRate.toFixed(1)),
        threshold: ALERT_THRESHOLDS.resolutionRate,
        message: `Resolution rate (${resolutionRate.toFixed(1)}%) is below ${ALERT_THRESHOLDS.resolutionRate}% threshold`,
      });
    }
    if (containmentRate !== null && containmentRate < ALERT_THRESHOLDS.containmentRate) {
      alerts.push({
        metric: 'containmentRate',
        value: parseFloat(containmentRate.toFixed(1)),
        threshold: ALERT_THRESHOLDS.containmentRate,
        message: `Containment rate (${containmentRate.toFixed(1)}%) is below ${ALERT_THRESHOLDS.containmentRate}% threshold`,
      });
    }
    // US-902: Order accuracy alert
    if (orderAccuracyRate !== null && orderAccuracyRate < ALERT_THRESHOLDS.orderAccuracy) {
      alerts.push({
        metric: 'orderAccuracyRate',
        value: parseFloat(orderAccuracyRate.toFixed(1)),
        threshold: ALERT_THRESHOLDS.orderAccuracy,
        message: `Order accuracy rate (${orderAccuracyRate.toFixed(1)}%) is below ${ALERT_THRESHOLDS.orderAccuracy}% threshold`,
      });
    }

    res.json({
      success: true,
      profileId: profileId || 'all',
      days,
      kpis: {
        csat: {
          score: csatScore !== null ? parseFloat(csatScore.toFixed(1)) : null,
          total: csat.total,
          thumbsUp: csat.thumbsUp,
          threshold: ALERT_THRESHOLDS.csat,
          alert: csatScore !== null && csatScore < ALERT_THRESHOLDS.csat,
        },
        resolutionRate: {
          rate: resolutionRate !== null ? parseFloat(resolutionRate.toFixed(1)) : null,
          totalConversations: totalConvos,
          resolvedByAI,
          escalated: escalatedConvos,
          threshold: ALERT_THRESHOLDS.resolutionRate,
          alert: resolutionRate !== null && resolutionRate < ALERT_THRESHOLDS.resolutionRate,
        },
        containmentRate: {
          rate: containmentRate !== null ? parseFloat(containmentRate.toFixed(1)) : null,
          totalConversations: totalConvos,
          contained: containedConvos,
          escalated: escalatedConvos,
          threshold: ALERT_THRESHOLDS.containmentRate,
          alert: containmentRate !== null && containmentRate < ALERT_THRESHOLDS.containmentRate,
        },
        handoffRate: {
          rate: handoffRate !== null ? parseFloat(handoffRate.toFixed(1)) : null,
          totalEscalations: escalations.total,
          uniqueConversationsEscalated: escalatedConvos,
        },
        fallbackRate: {
          rate: fallbackRate !== null ? parseFloat(fallbackRate.toFixed(1)) : null,
          totalUserMessages: fallback.totalUserMessages,
          unknownMessages: fallback.unknownMessages,
        },
        faithfulness: {
          lowFaithfulnessRate: lowFaithfulnessRate !== null ? parseFloat(lowFaithfulnessRate.toFixed(1)) : null,
          avgScore: faithfulness.avgScore !== null ? parseFloat(Number(faithfulness.avgScore).toFixed(3)) : null,
          totalChecked: faithfulness.totalChecked,
          lowFaithfulnessCount: faithfulness.lowFaithfulness,
        },
        // US-902: Order accuracy rate
        orderAccuracyRate: {
          rate: orderAccuracyRate !== null ? parseFloat(orderAccuracyRate.toFixed(1)) : null,
          totalConfirmedOrders: orderAccuracy.totalConfirmed,
          correctedOrders: orderAccuracy.totalCorrected,
          accurateOrders,
          sentToKitchen: orderAccuracy.totalSentToKitchen,
          threshold: ALERT_THRESHOLDS.orderAccuracy,
          alert: orderAccuracyRate !== null && orderAccuracyRate < ALERT_THRESHOLDS.orderAccuracy,
        },
        // US-023: Avg messages per conversation — billing KPI for per-message pricing (July 2025+)
        avgMsgsPerConversation: {
          avg: avgMsgsPerConvo,
          totalAssistantMessages: Number(msgPerConvoRow.total_assistant_msgs ?? 0),
          distinctConversations: Number(msgPerConvoRow.distinct_conversations ?? 0),
          note: 'Outbound assistant messages only. Each message billed individually under WhatsApp July 2025+ per-message pricing.',
        },
      },
      alerts,
    });
  } catch (error) {
    console.error('[Analytics KPIs] Failed to fetch KPIs:', error);
    res.status(500).json({ error: 'Failed to retrieve KPI analytics' });
  }
});

function emptyKpis() {
  return {
    csat: { score: null, total: 0, thumbsUp: 0, threshold: 80, alert: false },
    resolutionRate: { rate: null, totalConversations: 0, resolvedByAI: 0, escalated: 0, threshold: 60, alert: false },
    containmentRate: { rate: null, totalConversations: 0, contained: 0, escalated: 0, threshold: 70, alert: false },
    handoffRate: { rate: null, totalEscalations: 0, uniqueConversationsEscalated: 0 },
    fallbackRate: { rate: null, totalUserMessages: 0, unknownMessages: 0 },
    faithfulness: { lowFaithfulnessRate: null, avgScore: null, totalChecked: 0, lowFaithfulnessCount: 0 },
    orderAccuracyRate: { rate: null, totalConfirmedOrders: 0, correctedOrders: 0, accurateOrders: 0, sentToKitchen: 0, threshold: 90, alert: false },
    avgMsgsPerConversation: { avg: null, totalAssistantMessages: 0, distinctConversations: 0, note: 'Outbound assistant messages only.' },
  };
}

// ── US-901: Containment rate multi-period + trend sparkline ──────────

/** Helper: compute containment rate for a given time window */
async function computeContainment(profileId: string | undefined, since: Date) {
  const [convoResult, escResult] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(rainbowConversations)
      .where(and(
        gte(rainbowConversations.updatedAt, since),
        profileId ? eq(rainbowConversations.profileId, profileId) : sql`true`,
      )),
    db
      .select({ uniqueJids: sql<number>`count(distinct jid)::int` })
      .from(escalationEvents)
      .where(and(
        gte(escalationEvents.createdAt, since),
        profileId ? eq(escalationEvents.profileId, profileId) : sql`true`,
      )),
  ]);
  const total = convoResult[0].total;
  const escalated = escResult[0].uniqueJids;
  const contained = total - escalated;
  const rate = total > 0 ? parseFloat(((contained / total) * 100).toFixed(1)) : null;
  return { rate, totalConversations: total, contained, escalated };
}

// GET /analytics/kpis/containment — multi-period (24h, 7d, 30d) + 30-day trend sparkline
router.get('/analytics/kpis/containment', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({
        success: true,
        periods: { '24h': null, '7d': null, '30d': null },
        trend: [],
        threshold: ALERT_THRESHOLDS.containmentRate,
        warning: 'Database connection unavailable.',
      });
    }

    const profileId = (req.query.profileId as string) || (res.locals.profileId as string) || undefined;
    const now = new Date();

    const since24h = new Date(now); since24h.setDate(since24h.getDate() - 1);
    const since7d = new Date(now); since7d.setDate(since7d.getDate() - 7);
    const since30d = new Date(now); since30d.setDate(since30d.getDate() - 30);

    // Run multi-period containment + trend in parallel
    const [period24h, period7d, period30d, trendResult] = await Promise.all([
      computeContainment(profileId, since24h),
      computeContainment(profileId, since7d),
      computeContainment(profileId, since30d),
      // 30-day daily trend sparkline
      db.execute(sql`
        WITH days AS (
          SELECT generate_series(
            date_trunc('day', now() - interval '29 days'),
            date_trunc('day', now()),
            '1 day'
          )::date AS day
        ),
        daily_convos AS (
          SELECT date_trunc('day', updated_at)::date AS day, count(*)::int AS total
          FROM rainbow_conversations
          WHERE updated_at >= now() - interval '30 days'
            ${profileId ? sql`AND profile_id = ${profileId}` : sql``}
          GROUP BY 1
        ),
        daily_escalated AS (
          SELECT date_trunc('day', created_at)::date AS day, count(distinct jid)::int AS escalated
          FROM escalation_events
          WHERE created_at >= now() - interval '30 days'
            ${profileId ? sql`AND profile_id = ${profileId}` : sql``}
          GROUP BY 1
        )
        SELECT
          d.day::text AS date,
          COALESCE(dc.total, 0)::int AS total,
          COALESCE(de.escalated, 0)::int AS escalated,
          CASE WHEN COALESCE(dc.total, 0) > 0
            THEN round(((COALESCE(dc.total, 0) - COALESCE(de.escalated, 0))::numeric / COALESCE(dc.total, 0)) * 100, 1)
            ELSE null
          END AS rate
        FROM days d
        LEFT JOIN daily_convos dc ON dc.day = d.day
        LEFT JOIN daily_escalated de ON de.day = d.day
        ORDER BY d.day
      `),
    ]);

    const trend = (trendResult.rows as any[]).map((row: any) => ({
      date: row.date.substring(0, 10), // YYYY-MM-DD
      total: Number(row.total),
      escalated: Number(row.escalated),
      rate: row.rate !== null ? parseFloat(Number(row.rate).toFixed(1)) : null,
    }));

    res.json({
      success: true,
      profileId: profileId || 'all',
      periods: {
        '24h': period24h,
        '7d': period7d,
        '30d': period30d,
      },
      trend,
      threshold: ALERT_THRESHOLDS.containmentRate,
    });
  } catch (error) {
    console.error('[Analytics KPIs] Failed to fetch containment rate:', error);
    res.status(500).json({ error: 'Failed to retrieve containment rate analytics' });
  }
});

// GET /analytics/kpis/containment/escalated — drill-down: list escalated conversation IDs
router.get('/analytics/kpis/containment/escalated', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({ success: true, escalated: [], warning: 'Database connection unavailable.' });
    }

    const profileId = (req.query.profileId as string) || (res.locals.profileId as string) || undefined;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
    const since = new Date();
    since.setDate(since.getDate() - days);

    const result = await db
      .select({
        jid: escalationEvents.jid,
        trigger: escalationEvents.trigger,
        createdAt: escalationEvents.createdAt,
      })
      .from(escalationEvents)
      .where(and(
        gte(escalationEvents.createdAt, since),
        profileId ? eq(escalationEvents.profileId, profileId) : sql`true`,
      ))
      .orderBy(sql`created_at DESC`)
      .limit(200);

    // Deduplicate by jid, keep most recent escalation per conversation
    const seen = new Map<string, typeof result[0]>();
    for (const row of result) {
      if (!seen.has(row.jid)) {
        seen.set(row.jid, row);
      }
    }

    res.json({
      success: true,
      profileId: profileId || 'all',
      days,
      escalated: Array.from(seen.values()).map((row) => ({
        conversationId: row.jid,
        trigger: row.trigger,
        escalatedAt: row.createdAt,
      })),
      total: seen.size,
    });
  } catch (error) {
    console.error('[Analytics KPIs] Failed to fetch escalated conversations:', error);
    res.status(500).json({ error: 'Failed to retrieve escalated conversations' });
  }
});

// Exported for testing
export const _testExports = { computeContainment, ALERT_THRESHOLDS };

export default router;
