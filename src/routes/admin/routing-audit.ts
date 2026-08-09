/**
 * Admin API: Routing Integrity Audit (US-343)
 *
 * GET /audit/routing-violations?hours=24&profile_id=makan
 *   Returns all messages that were routed to the wrong profile within the given
 *   time window, with classifier metadata for root-cause analysis.
 *
 * GET /audit/routing-stats?hours=24
 *   Returns aggregate routing stats: total messages, violations, violation rate.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { routingAuditLogs } from '../../../shared/schema-tables.js';
import { and, gte, eq, desc, sql } from 'drizzle-orm';
import { createModuleLogger } from '../../lib/logger.js';

const logger = createModuleLogger('RoutingAuditAdmin');
const router = Router();

// ─── GET /audit/routing-violations ──────────────────────────────────────────

router.get('/audit/routing-violations', async (req: Request, res: Response) => {
  try {
    const hours = Math.min(Math.max(parseInt(req.query.hours as string) || 24, 1), 720);
    const profileId = req.query.profile_id as string | undefined;
    const limitVal = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offsetVal = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const conditions = [
      gte(routingAuditLogs.createdAt, since),
      eq(routingAuditLogs.isViolation, true),
    ];
    if (profileId) {
      conditions.push(eq(routingAuditLogs.sourceProfile, profileId));
    }

    const where = and(...conditions);

    const [rows, [countResult]] = await Promise.all([
      db.select()
        .from(routingAuditLogs)
        .where(where)
        .orderBy(desc(routingAuditLogs.createdAt))
        .limit(limitVal)
        .offset(offsetVal),
      db.select({ count: sql<number>`count(*)` })
        .from(routingAuditLogs)
        .where(where),
    ]);

    res.json({
      violations: rows.map(r => ({
        message_id: r.messageId,
        expected_profile: r.sourceProfile,
        actual_profile: r.targetProfile,
        classifier_confidence: r.classifierConfidence,
        classifier_match_result: r.classifierMatchResult,
        timestamp: r.createdAt,
      })),
      total: Number(countResult?.count ?? 0),
      hours,
      limit: limitVal,
      offset: offsetVal,
    });
  } catch (err: any) {
    logger.error(`GET /audit/routing-violations failed: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /audit/routing-stats ────────────────────────────────────────────────

router.get('/audit/routing-stats', async (req: Request, res: Response) => {
  try {
    const hours = Math.min(Math.max(parseInt(req.query.hours as string) || 24, 1), 720);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [statsRows] = await db
      .select({
        total: sql<number>`count(*)`,
        violations: sql<number>`sum(case when is_violation then 1 else 0 end)`,
      })
      .from(routingAuditLogs)
      .where(gte(routingAuditLogs.createdAt, since));

    const total = Number(statsRows?.total ?? 0);
    const violations = Number(statsRows?.violations ?? 0);
    const violationRate = total > 0 ? violations / total : 0;

    res.json({
      hours,
      total_messages: total,
      total_violations: violations,
      violation_rate: violationRate,
      violation_rate_pct: `${(violationRate * 100).toFixed(2)}%`,
    });
  } catch (err: any) {
    logger.error(`GET /audit/routing-stats failed: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
