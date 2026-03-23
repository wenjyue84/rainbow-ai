/**
 * Admin API: Booking Workflow Trace Timeline (US-309)
 *
 * GET /booking/:bookingId/trace — returns the execution trace for a booking,
 * ordered by creation time, with totals and error summary.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady } from '../../lib/db.js';
import { bookingWorkflowTraces } from '../../../shared/schema-tables.js';
import { eq, asc } from 'drizzle-orm';

const router = Router();

router.get('/booking/:bookingId/trace', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({ success: false, error: 'Database unavailable' });
    }

    const { bookingId } = req.params;

    const rows = await db
      .select()
      .from(bookingWorkflowTraces)
      .where(eq(bookingWorkflowTraces.bookingId, bookingId))
      .orderBy(asc(bookingWorkflowTraces.createdAt));

    const totalDurationMs = rows.reduce((sum, r) => sum + r.durationMs, 0);
    const errors = rows.filter((r) => r.errorMsg != null);

    return res.json({
      success: true,
      bookingId,
      totalSteps: rows.length,
      totalDurationMs,
      errorCount: errors.length,
      steps: rows.map((r) => ({
        step: r.stepName,
        durationMs: r.durationMs,
        input: r.inputJson,
        output: r.outputJson,
        error: r.errorMsg ?? null,
        at: r.createdAt,
      })),
    });
  } catch (err) {
    console.error('[booking-trace] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
