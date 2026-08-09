/**
 * US-376: Intent Classification Hard-Case Review Queue — Admin API
 *
 * GET  /admin/api/hard-cases?profile=pelangi&limit=20
 *   Returns low-confidence predictions (50-70%) sorted by newest first.
 *
 * POST /admin/api/hard-cases/:id/label?intent=booking
 *   Records an admin-provided ground truth label for retraining.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { hardCaseQueue } from '../../../shared/schema-tables.js';
import { eq, and, desc } from 'drizzle-orm';
import { ok, badRequest, notFound, serverError } from './http-utils.js';

const router = Router();

/**
 * GET /admin/api/hard-cases
 *
 * Query params:
 *   profile  — filter by profile (default: all)
 *   limit    — max rows to return (default: 20, max: 100)
 */
router.get('/api/hard-cases', async (req: Request, res: Response) => {
  try {
    const profileFilter = typeof req.query.profile === 'string' ? req.query.profile : null;
    const rawLimit = parseInt(String(req.query.limit ?? '20'), 10);
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 100);

    const conditions = [];
    if (profileFilter) conditions.push(eq(hardCaseQueue.profile, profileFilter));

    const rows = await db
      .select()
      .from(hardCaseQueue)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(hardCaseQueue.createdAt))
      .limit(limit);

    return ok(res, { hardCases: rows, count: rows.length });
  } catch (err: any) {
    return serverError(res, err);
  }
});

/**
 * POST /admin/api/hard-cases/:id/label
 *
 * Query params:
 *   intent — the correct intent label provided by admin
 */
router.post('/api/hard-cases/:id/label', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const intent = typeof req.query.intent === 'string' ? req.query.intent.trim() : null;

    if (!intent) {
      return badRequest(res, 'Query param "intent" is required');
    }

    const rows = await db
      .select({ id: hardCaseQueue.id })
      .from(hardCaseQueue)
      .where(eq(hardCaseQueue.id, id))
      .limit(1);

    if (rows.length === 0) {
      return notFound(res, 'Hard case not found');
    }

    await db
      .update(hardCaseQueue)
      .set({ adminLabel: intent })
      .where(eq(hardCaseQueue.id, id));

    return ok(res, { id, adminLabel: intent, updated: true });
  } catch (err: any) {
    return serverError(res, err);
  }
});

export default router;
