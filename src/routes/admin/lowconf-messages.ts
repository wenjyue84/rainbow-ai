/**
 * US-280: Low-Confidence Intent Archival — Admin API
 *
 * GET  /api/admin/lowconf-messages?profile=pelangi&reviewed=false&limit=20
 *   Returns messages archived with confidence < 0.5, optionally filtered by
 *   profile and reviewed status.
 *
 * POST /api/admin/lowconf-messages/:id/correct
 *   Body: { correct_intent: string }
 *   Submits a QA correction for a low-confidence message.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { rainbowLowconfMessages } from '../../../shared/schema-tables.js';
import { eq, isNull, isNotNull, and, desc } from 'drizzle-orm';
import { ok, badRequest, notFound, serverError } from './http-utils.js';

const router = Router();

/**
 * GET /api/admin/lowconf-messages
 *
 * Query params:
 *   profile  — filter by profile id (default: all)
 *   reviewed — "true" | "false" (default: all)
 *   limit    — max rows to return (default: 20, max: 100)
 */
router.get('/lowconf-messages', async (req: Request, res: Response) => {
  try {
    const profileFilter = typeof req.query.profile === 'string' ? req.query.profile : null;
    const reviewedFilter = typeof req.query.reviewed === 'string' ? req.query.reviewed : null;
    const rawLimit = parseInt(String(req.query.limit ?? '20'), 10);
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 100);

    const conditions = [];
    if (profileFilter) conditions.push(eq(rainbowLowconfMessages.profile, profileFilter));
    if (reviewedFilter === 'false') conditions.push(isNull(rainbowLowconfMessages.reviewedAt));
    if (reviewedFilter === 'true') conditions.push(isNotNull(rainbowLowconfMessages.reviewedAt));

    const rows = await db
      .select()
      .from(rainbowLowconfMessages)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(rainbowLowconfMessages.createdAt))
      .limit(limit);

    return ok(res, { messages: rows, count: rows.length });
  } catch (err: any) {
    return serverError(res, err);
  }
});

/**
 * POST /api/admin/lowconf-messages/:id/correct
 *
 * Body: { correct_intent: string }
 */
router.post('/lowconf-messages/:id/correct', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) return badRequest(res, 'Invalid message id');

    const { correct_intent } = req.body ?? {};
    if (!correct_intent || typeof correct_intent !== 'string' || !correct_intent.trim()) {
      return badRequest(res, 'correct_intent is required');
    }

    const [existing] = await db
      .select({ id: rainbowLowconfMessages.id })
      .from(rainbowLowconfMessages)
      .where(eq(rainbowLowconfMessages.id, id))
      .limit(1);

    if (!existing) return notFound(res, 'lowconf message');

    await db
      .update(rainbowLowconfMessages)
      .set({ correctIntent: correct_intent.trim(), reviewedAt: new Date() })
      .where(eq(rainbowLowconfMessages.id, id));

    return ok(res, { id, correct_intent: correct_intent.trim() });
  } catch (err: any) {
    return serverError(res, err);
  }
});

export default router;
