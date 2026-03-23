/**
 * Admin API: Escalation Quality Feedback Loop (US-295)
 *
 * POST /escalations/:escalationId/feedback  — Submit staff feedback on an escalation
 * GET  /analytics/escalation-insights       — Dashboard of failure patterns & recommendations
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, pool } from '../../lib/db.js';
import { escalationFeedback, escalationEvents } from '../../../shared/schema-tables.js';
import { eq, desc } from 'drizzle-orm';

const router = Router();

const VALID_FEEDBACK_TYPES = [
  'intent_misclassified',
  'missing_knowledge',
  'wrong_workflow',
  'poor_response',
  'other',
] as const;

const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

// POST /escalations/:escalationId/feedback — Submit structured feedback
router.post('/escalations/:escalationId/feedback', async (req: Request, res: Response) => {
  const escalationId = parseInt(req.params.escalationId as string, 10);
  if (isNaN(escalationId)) {
    res.status(400).json({ error: 'Invalid escalation ID' });
    return;
  }

  const { feedback_type, correct_intent, severity, notes, staff_id } = req.body || {};

  // Validate required field
  if (!feedback_type || !VALID_FEEDBACK_TYPES.includes(feedback_type)) {
    res.status(400).json({
      error: `feedback_type is required and must be one of: ${VALID_FEEDBACK_TYPES.join(', ')}`,
    });
    return;
  }

  // Validate severity if provided
  const effectiveSeverity = severity || 'medium';
  if (!VALID_SEVERITIES.includes(effectiveSeverity)) {
    res.status(400).json({
      error: `severity must be one of: ${VALID_SEVERITIES.join(', ')}`,
    });
    return;
  }

  // Verify escalation exists
  const escalation = await db.select()
    .from(escalationEvents)
    .where(eq(escalationEvents.id, escalationId))
    .limit(1);

  if (escalation.length === 0) {
    res.status(404).json({ error: 'Escalation event not found' });
    return;
  }

  const profileId = escalation[0].profileId || 'pelangi';

  // Insert feedback
  const [inserted] = await db.insert(escalationFeedback).values({
    escalationId,
    profileId,
    staffId: staff_id || null,
    feedbackType: feedback_type,
    correctIntent: correct_intent || null,
    severity: effectiveSeverity,
    notes: notes || null,
  }).returning();

  res.status(201).json({ feedback: inserted });
});

// GET /analytics/escalation-insights — Dashboard of failure patterns
router.get('/analytics/escalation-insights', async (req: Request, res: Response) => {
  const days = Math.min(parseInt(req.query.days as string) || 30, 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    // Most common failure types
    const typeBreakdown = await pool.query(
      `SELECT
        feedback_type,
        COUNT(*) AS count,
        ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 1) AS pct
      FROM escalation_feedback
      WHERE created_at >= $1
      GROUP BY feedback_type
      ORDER BY count DESC`,
      [since]
    );

    // Severity distribution
    const severityBreakdown = await pool.query(
      `SELECT
        severity,
        COUNT(*) AS count,
        ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 1) AS pct
      FROM escalation_feedback
      WHERE created_at >= $1
      GROUP BY severity
      ORDER BY
        CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END`,
      [since]
    );

    // Misclassified intents — what intents are being incorrectly matched
    const misclassifiedIntents = await pool.query(
      `SELECT
        ef.correct_intent,
        ee.trigger AS original_trigger,
        COUNT(*) AS count
      FROM escalation_feedback ef
      JOIN escalation_events ee ON ee.id = ef.escalation_id
      WHERE ef.created_at >= $1
        AND ef.feedback_type = 'intent_misclassified'
        AND ef.correct_intent IS NOT NULL
      GROUP BY ef.correct_intent, ee.trigger
      ORDER BY count DESC
      LIMIT 20`,
      [since]
    );

    // Generate actionable recommendations
    const recommendations = generateRecommendations(
      typeBreakdown.rows,
      misclassifiedIntents.rows,
    );

    // Total feedback count
    const totalResult = await pool.query(
      `SELECT COUNT(*) AS total FROM escalation_feedback WHERE created_at >= $1`,
      [since]
    );

    res.json({
      period_days: days,
      total_feedback: parseInt(totalResult.rows[0]?.total) || 0,
      failure_patterns: typeBreakdown.rows.map((r: any) => ({
        feedback_type: r.feedback_type,
        count: parseInt(r.count),
        percentage: parseFloat(r.pct) || 0,
      })),
      severity_distribution: severityBreakdown.rows.map((r: any) => ({
        severity: r.severity,
        count: parseInt(r.count),
        percentage: parseFloat(r.pct) || 0,
      })),
      misclassified_intents: misclassifiedIntents.rows.map((r: any) => ({
        correct_intent: r.correct_intent,
        original_trigger: r.original_trigger,
        count: parseInt(r.count),
      })),
      recommendations,
    });
  } catch (err: any) {
    console.error('[EscalationFeedback] Insights query failed:', err.message);
    res.status(500).json({ error: 'Failed to compute escalation insights' });
  }
});

/**
 * Generate actionable recommendations from feedback data.
 * Produces suggestions like "booking intent misclassified 8 times, suggest adding 'date' keyword".
 */
export function generateRecommendations(
  typeRows: Array<{ feedback_type: string; count: string }>,
  misclassifiedRows: Array<{ correct_intent: string; original_trigger: string; count: string }>,
): Array<{ type: string; message: string; priority: string }> {
  const recommendations: Array<{ type: string; message: string; priority: string }> = [];

  // Check for high-volume misclassifications
  for (const row of misclassifiedRows) {
    const count = parseInt(row.count);
    if (count >= 3) {
      const priority = count >= 10 ? 'high' : count >= 5 ? 'medium' : 'low';
      recommendations.push({
        type: 'keyword_addition',
        message: `${row.correct_intent} intent misclassified ${count} times (triggered as '${row.original_trigger}'), suggest reviewing keyword mappings for '${row.correct_intent}'`,
        priority,
      });
    }
  }

  // Check for dominant feedback types
  for (const row of typeRows) {
    const count = parseInt(row.count);
    if (row.feedback_type === 'missing_knowledge' && count >= 3) {
      recommendations.push({
        type: 'knowledge_gap',
        message: `${count} escalations due to missing knowledge — review knowledge base for coverage gaps`,
        priority: count >= 10 ? 'high' : 'medium',
      });
    }
    if (row.feedback_type === 'wrong_workflow' && count >= 3) {
      recommendations.push({
        type: 'routing_fix',
        message: `${count} escalations triggered wrong workflow — audit intent-to-workflow routing rules`,
        priority: count >= 8 ? 'high' : 'medium',
      });
    }
  }

  return recommendations;
}

export default router;
