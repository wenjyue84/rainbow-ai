/**
 * Traces Admin API (US-427)
 *
 * GET /traces         — list recent conversation trace events
 * GET /traces?jid=&limit=  — filter by JID, paginate
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { queryTraces } from '../../lib/trace-collector.js';

const router = Router();

/**
 * GET /traces?jid=<phone>&limit=<n>
 *
 * Returns recent conversation trace records ordered newest-first.
 * jid     — optional WhatsApp JID filter
 * limit   — max records to return (default 50, max 500)
 */
// Express 5: async errors auto-propagate to error-handling middleware
router.get('/traces', async (req: Request, res: Response) => {
  const jid = typeof req.query.jid === 'string' ? req.query.jid : undefined;
  const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 500);

  const traces = await queryTraces({ jid, limit });
  res.json({ count: traces.length, traces });
});

export default router;
