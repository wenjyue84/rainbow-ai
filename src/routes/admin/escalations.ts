/**
 * Admin API: Escalation Events (US-429)
 *
 * GET /escalations        — List recent escalation events
 * GET /escalations/:id    — Get single escalation event with summary
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { escalationEvents } from '../../../shared/schema-tables.js';
import { eq, desc } from 'drizzle-orm';

const router = Router();

// GET /escalations — List recent escalation events
router.get('/escalations', async (_req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(_req.query.limit as string) || 50, 200);
    const rows = await db.select()
      .from(escalationEvents)
      .orderBy(desc(escalationEvents.createdAt))
      .limit(limit);

    res.json({ escalations: rows });
  } catch (err: any) {
    console.error('[Admin/Escalations] List error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /escalations/:id — Get single escalation event with summary
router.get('/escalations/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid escalation ID' });
      return;
    }

    const rows = await db.select()
      .from(escalationEvents)
      .where(eq(escalationEvents.id, id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: 'Escalation event not found' });
      return;
    }

    res.json({ escalation: rows[0] });
  } catch (err: any) {
    console.error('[Admin/Escalations] Get error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
