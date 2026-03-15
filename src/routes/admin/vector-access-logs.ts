/**
 * Admin API: Vector Store Access Logs & Namespace Audit
 *
 * US-966: OWASP LLM06 — Vector and Embedding Weaknesses.
 * Provides admin visibility into RAG retrieval audit trail and namespace health.
 *
 * Routes:
 *   GET  /vector-access-logs   — Query access log entries (90-day window)
 *   POST /vector-ns-audit      — Run a full namespace audit across all profiles
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { vectorAccessLogs } from '../../../shared/schema-tables.js';
import { desc, gte, eq, and } from 'drizzle-orm';
import { profileRegistry } from '../../assistant/profile-registry.js';
import { runNamespaceAudit } from '../../assistant/rag/ns-audit.js';
import type { HybridRetriever } from '../../assistant/rag/hybrid-retriever.js';

const router = Router();

// ─── GET /vector-access-logs ──────────────────────────────────────────

router.get('/vector-access-logs', async (req: Request, res: Response) => {
  const windowDays = Math.min(parseInt(req.query.days as string || '7', 10), 90);
  const propertyId = req.query.propertyId as string | undefined;
  const onlyCrossNamespace = req.query.crossNamespace === 'true';
  const onlyAttack = req.query.attack === 'true';
  const limit = Math.min(parseInt(req.query.limit as string || '100', 10), 500);

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const conditions = [gte(vectorAccessLogs.createdAt, since)];
  if (propertyId) conditions.push(eq(vectorAccessLogs.propertyId, propertyId));
  if (onlyCrossNamespace) conditions.push(eq(vectorAccessLogs.crossNamespaceDetected, true));
  if (onlyAttack) conditions.push(eq(vectorAccessLogs.similarityAttackSuspected, true));

  const rows = await db
    .select()
    .from(vectorAccessLogs)
    .where(and(...conditions))
    .orderBy(desc(vectorAccessLogs.createdAt))
    .limit(limit);

  res.json({
    windowDays,
    total: rows.length,
    logs: rows,
  });
});

// ─── POST /vector-ns-audit ────────────────────────────────────────────

router.post('/vector-ns-audit', async (_req: Request, res: Response) => {
  if (!profileRegistry.isInitialized()) {
    res.status(503).json({ error: 'Profile registry not initialized' });
    return;
  }

  // Build retriever map from all profiles
  const registrations = new Map<string, HybridRetriever>();
  for (const profile of profileRegistry.listProfiles()) {
    const retriever = profile.kb.getHybridRetriever();
    if (retriever.isReady) {
      registrations.set(profile.id, retriever);
    }
  }

  const result = await runNamespaceAudit(registrations, 90);

  res.status(result.passed ? 200 : 500).json(result);
});

export default router;
