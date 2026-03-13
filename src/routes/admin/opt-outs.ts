/**
 * Admin API: Opt-out management (US-403)
 *
 * GET /api/rainbow/opt-outs — Paginated list of opted-out phone numbers
 * DELETE /api/rainbow/opt-outs/:phone — Remove opt-out (admin override)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getOptOutList, recordOptIn } from '../../assistant/opt-out.js';

const router = Router();

// Express 5: async errors auto-propagate to error-handling middleware

// GET /api/rainbow/opt-outs
router.get('/opt-outs', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));

  const result = await getOptOutList(page, limit);
  res.json({ success: true, ...result });
});

// DELETE /api/rainbow/opt-outs/:phone — Admin can remove opt-out
router.delete('/opt-outs/:phone', async (req: Request, res: Response) => {
  const phone = req.params.phone;
  if (!phone) {
    res.status(400).json({ error: 'Phone number is required' });
    return;
  }
  await recordOptIn(phone);
  res.json({ success: true, message: `Opt-out removed for ${phone}` });
});

export default router;
