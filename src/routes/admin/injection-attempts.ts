/**
 * Admin API: Prompt Injection Attempts (US-927)
 *
 * GET /injection-attempts — Count, 7-day trend, and recent attempts
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getInjectionAttemptStats } from '../../lib/prompt-injection-log.js';

const router = Router();

// GET /injection-attempts — Injection Attempts panel data
router.get('/injection-attempts', async (req: Request, res: Response) => {
  const days = Math.min(parseInt(req.query.days as string) || 7, 90);
  const stats = await getInjectionAttemptStats(days);
  res.json(stats);
});

export default router;
