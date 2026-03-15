/**
 * Admin API: Hallucination Detection Report (US-913)
 *
 * GET /analytics/hallucination-report?profileId=pelangi&days=7
 *   Weekly/configurable report showing:
 *   - Total responses checked vs skipped (non-factual bypass rate)
 *   - Hallucination detection rate (% of checked responses with severity > 0)
 *   - Top flagged response categories (price, time, quantity, contact)
 *   - Action breakdown (block, body, header, none)
 *   - Recent hallucination events (from escalation_events with trigger='hallucination')
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady } from '../../lib/db.js';
import { rainbowMessages, escalationEvents } from '../../../shared/schema.js';
import { sql, and, gte, eq, isNotNull } from 'drizzle-orm';

const router = Router();

// GET /analytics/hallucination-report
router.get('/analytics/hallucination-report', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({
        success: true,
        report: emptyReport(),
        warning: 'Database connection unavailable.',
      });
    }

    const profileId = (req.query.profileId as string) || (res.locals.profileId as string) || undefined;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
    const since = new Date();
    since.setDate(since.getDate() - days);

    const profileFilter = profileId
      ? sql`AND profile_id = ${profileId}`
      : sql``;

    // Run queries in parallel
    const [summaryResult, categoryResult, recentEvents] = await Promise.all([
      // 1. Summary stats: checked, skipped, action breakdown
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE role = 'assistant' AND hallucination_action IS NOT NULL)::int AS checked_count,
          COUNT(*) FILTER (WHERE role = 'assistant' AND hallucination_action IS NULL AND faithfulness_score IS NOT NULL)::int AS skipped_count,
          COUNT(*) FILTER (WHERE hallucination_severity > 0)::int AS detected_count,
          COUNT(*) FILTER (WHERE hallucination_action = 'block')::int AS blocked_count,
          COUNT(*) FILTER (WHERE hallucination_action = 'body')::int AS body_disclaimer_count,
          COUNT(*) FILTER (WHERE hallucination_action = 'header')::int AS header_disclaimer_count,
          COUNT(*) FILTER (WHERE hallucination_action = 'none' AND hallucination_severity > 0)::int AS logged_only_count,
          COALESCE(AVG(hallucination_severity) FILTER (WHERE hallucination_severity > 0), 0)::real AS avg_severity
        FROM rainbow_messages
        WHERE timestamp >= ${since}
          ${profileFilter}
      `),

      // 2. Top flagged categories from escalation_events with trigger='hallucination'
      db.execute(sql`
        SELECT
          metadata::json->>'topCategory' AS category,
          COUNT(*)::int AS count
        FROM escalation_events
        WHERE trigger = 'hallucination'
          AND created_at >= ${since}
          ${profileId ? sql`AND profile_id = ${profileId}` : sql``}
          AND metadata IS NOT NULL
        GROUP BY metadata::json->>'topCategory'
        ORDER BY count DESC
        LIMIT 10
      `),

      // 3. Recent hallucination events (last 20)
      db.execute(sql`
        SELECT
          jid,
          profile_id,
          metadata,
          created_at
        FROM escalation_events
        WHERE trigger = 'hallucination'
          AND created_at >= ${since}
          ${profileId ? sql`AND profile_id = ${profileId}` : sql``}
        ORDER BY created_at DESC
        LIMIT 20
      `),
    ]);

    const summary = (summaryResult.rows as any[])[0] || {};
    const checkedCount = Number(summary.checked_count || 0);
    const detectedCount = Number(summary.detected_count || 0);

    const report = {
      period: { days, since: since.toISOString() },
      summary: {
        checkedResponses: checkedCount,
        skippedResponses: Number(summary.skipped_count || 0),
        bypassRate: checkedCount > 0
          ? 0
          : 100, // If nothing checked, 100% bypass
        detectedCount,
        detectionRate: checkedCount > 0
          ? parseFloat(((detectedCount / checkedCount) * 100).toFixed(1))
          : 0,
        avgSeverity: parseFloat(Number(summary.avg_severity || 0).toFixed(2)),
      },
      actions: {
        blocked: Number(summary.blocked_count || 0),
        bodyDisclaimer: Number(summary.body_disclaimer_count || 0),
        headerDisclaimer: Number(summary.header_disclaimer_count || 0),
        loggedOnly: Number(summary.logged_only_count || 0),
      },
      topCategories: (categoryResult.rows as any[]).map((r: any) => ({
        category: r.category || 'unknown',
        count: Number(r.count),
      })),
      recentEvents: (recentEvents.rows as any[]).map((r: any) => {
        let meta: any = {};
        try { meta = JSON.parse(r.metadata || '{}'); } catch { /* ignore */ }
        return {
          jid: r.jid,
          profileId: r.profile_id,
          contradictions: meta.contradictions || [],
          topCategory: meta.topCategory || null,
          latencyMs: meta.latencyMs || null,
          createdAt: r.created_at,
        };
      }),
    };

    // Recalculate bypass rate correctly
    const totalAssistant = report.summary.checkedResponses + report.summary.skippedResponses;
    report.summary.bypassRate = totalAssistant > 0
      ? parseFloat(((report.summary.skippedResponses / totalAssistant) * 100).toFixed(1))
      : 0;

    return res.json({ success: true, report });
  } catch (err: any) {
    console.error('[HallucinationReport] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

function emptyReport() {
  return {
    period: { days: 7, since: new Date().toISOString() },
    summary: {
      checkedResponses: 0,
      skippedResponses: 0,
      bypassRate: 0,
      detectedCount: 0,
      detectionRate: 0,
      avgSeverity: 0,
    },
    actions: { blocked: 0, bodyDisclaimer: 0, headerDisclaimer: 0, loggedOnly: 0 },
    topCategories: [],
    recentEvents: [],
  };
}

export default router;
