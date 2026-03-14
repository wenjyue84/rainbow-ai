/**
 * Admin API: Opt-out management (US-403, US-812)
 *
 * GET /api/rainbow/opt-outs              — Paginated list with compliance status
 * GET /api/rainbow/opt-outs/compliance   — Summary for admin warning banner
 * DELETE /api/rainbow/opt-outs/:phone    — Remove opt-out (admin override)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getOptOutList, recordOptIn, getOptOutComplianceSummary } from '../../assistant/opt-out.js';

const router = Router();

// Express 5: async errors auto-propagate to error-handling middleware

// GET /api/rainbow/opt-outs/compliance — US-812: compliance summary for warning banner
router.get('/opt-outs/compliance', async (req: Request, res: Response) => {
  const summary = await getOptOutComplianceSummary();
  res.json({ success: true, ...summary });
});

// GET /api/rainbow/opt-outs — list with compliance status
router.get('/opt-outs', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));

  const result = await getOptOutList(page, limit);
  res.json({ success: true, ...result });
});

// DELETE /api/rainbow/opt-outs/:phone — Admin can remove opt-out
router.delete('/opt-outs/:phone', async (req: Request, res: Response) => {
  const phone = req.params.phone as string;
  if (!phone) {
    res.status(400).json({ error: 'Phone number is required' });
    return;
  }
  await recordOptIn(phone);
  res.json({ success: true, message: `Opt-out removed for ${phone}` });
});

export default router;
