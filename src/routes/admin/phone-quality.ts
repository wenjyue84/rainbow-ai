/**
 * Admin API: Phone Number Quality (US-458)
 *
 * GET  /analytics/phone-quality        — Current quality rating & status per profile
 * GET  /analytics/phone-quality/:id    — Quality state for a specific profile
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getQualityState, getAllQualityStates, isOutboundBlocked } from '../../lib/phone-quality.js';

const router = Router();

/** GET /analytics/phone-quality — all profiles */
router.get('/analytics/phone-quality', (_req: Request, res: Response) => {
  const states = getAllQualityStates();
  const profiles = Object.entries(states).map(([profileId, state]) => ({
    profileId,
    ...state,
    outboundBlocked: isOutboundBlocked(profileId),
  }));
  res.json({ profiles });
});

/** GET /analytics/phone-quality/:profileId — single profile */
router.get('/analytics/phone-quality/:profileId', (req: Request, res: Response) => {
  const { profileId } = req.params;
  const state = getQualityState(profileId);
  res.json({
    profileId,
    ...state,
    outboundBlocked: isOutboundBlocked(profileId),
  });
});

export default router;
