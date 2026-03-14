/**
 * Admin API: KPI Analytics (US-811)
 *
 * GET /analytics/kpis?profileId=pelangi&days=7 — CSAT, resolution rate, handoff rate, fallback rate
 *
 * Alert thresholds: CSAT < 80%, Resolution rate < 60%
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady } from '../../lib/db.js';
import { rainbowFeedback, rainbowConversations, rainbowMessages, escalationEvents } from '../../../shared/schema.js';
import { sql, and, gte, eq } from 'drizzle-orm';

const router = Router();

const ALERT_THRESHOLDS = {
  csat: 80,           // Alert if CSAT < 80%
  resolutionRate: 60, // Alert if resolution rate < 60%
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

    // Run all four KPI queries in parallel
    const [csatResult, conversationCount, escalationCount, fallbackResult] = await Promise.all([
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
    ]);

    const csat = csatResult[0];
    const conversations = conversationCount[0];
    const escalations = escalationCount[0];
    const fallback = fallbackResult[0];

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
    handoffRate: { rate: null, totalEscalations: 0, uniqueConversationsEscalated: 0 },
    fallbackRate: { rate: null, totalUserMessages: 0, unknownMessages: 0 },
  };
}

export default router;
