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
router.get('/traces', async (req: Request, res: Response) => {
  const jid = typeof req.query.jid === 'string' ? req.query.jid : undefined;
  const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 500);

  try {
    const traces = await queryTraces({ jid, limit });
    res.json({ count: traces.length, traces });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
