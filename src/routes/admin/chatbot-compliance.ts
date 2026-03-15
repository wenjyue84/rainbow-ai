/**
 * Chatbot Compliance Admin API (US-942)
 *
 * GET /chatbot-compliance/audit       — Paginated compliance audit log
 * GET /chatbot-compliance/summary     — Aggregate stats (in_scope / off_topic / escalation)
 *
 * Supports WhatsApp 2026 task-specific chatbot policy review.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { queryComplianceAuditLog, getComplianceSummary } from '../../lib/compliance-audit.js';

const router = Router();

/**
 * GET /chatbot-compliance/audit?profileId=&category=&since=&limit=
 *
 * Returns recent compliance audit log entries ordered newest-first.
 * profileId — optional profile filter (e.g. "pelangi", "southern")
 * category  — optional filter: in_scope | off_topic | escalation
 * since     — optional ISO date string (e.g. 2026-01-01)
 * limit     — max records (default 100, max 500)
 */
router.get('/chatbot-compliance/audit', async (req: Request, res: Response) => {
  const profileId = typeof req.query.profileId === 'string' ? req.query.profileId : undefined;
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const sinceStr = typeof req.query.since === 'string' ? req.query.since : undefined;
  const limit = Math.min(parseInt((req.query.limit as string) || '100', 10), 500);

  const since = sinceStr ? new Date(sinceStr) : undefined;
  const intentCategory = (category === 'in_scope' || category === 'off_topic' || category === 'escalation')
    ? category
    : undefined;

  const rows = await queryComplianceAuditLog({ profileId, intentCategory, since, limit });
  res.json({ count: rows.length, entries: rows });
});

/**
 * GET /chatbot-compliance/summary?profileId=&since=
 *
 * Returns aggregate compliance stats: total, in_scope, off_topic, escalation, offTopicRate.
 */
router.get('/chatbot-compliance/summary', async (req: Request, res: Response) => {
  const profileId = typeof req.query.profileId === 'string' ? req.query.profileId : undefined;
  const sinceStr = typeof req.query.since === 'string' ? req.query.since : undefined;
  const since = sinceStr ? new Date(sinceStr) : undefined;

  const summary = await getComplianceSummary(profileId, since);
  res.json(summary);
});

export default router;
