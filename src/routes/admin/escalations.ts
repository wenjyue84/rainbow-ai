/**
 * Admin API: Escalation Events (US-429, US-836)
 *
 * GET /escalations              — List recent escalation events
 * GET /escalations/:id          — Get single escalation event with summary
 * GET /escalations/handoffs/open — Open handoffs with SLA status (US-836)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { escalationEvents } from '../../../shared/schema-tables.js';
import { eq, desc } from 'drizzle-orm';
import { getOpenHandoffs } from '../../lib/handoff-sla.js';

const router = Router();

// Express 5: async errors auto-propagate to error-handling middleware

// GET /escalations — List recent escalation events
router.get('/escalations', async (_req: Request, res: Response) => {
  const limit = Math.min(parseInt(_req.query.limit as string) || 50, 200);
  const rows = await db.select()
    .from(escalationEvents)
    .orderBy(desc(escalationEvents.createdAt))
    .limit(limit);

  res.json({ escalations: rows });
});

// GET /escalations/handoffs/open — Open handoffs with SLA status (US-836)
router.get('/escalations/handoffs/open', async (_req: Request, res: Response) => {
  const handoffs = await getOpenHandoffs();
  res.json({ handoffs });
});

// GET /escalations/:id — Get single escalation event with summary
router.get('/escalations/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
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
});

export default router;
