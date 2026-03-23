/**
 * Per-Intent Confidence Threshold Configuration Admin API (US-297)
 *
 * Allow admins to configure minimum confidence thresholds per intent per profile,
 * enabling profile-specific tuning for improved classification accuracy.
 *
 * GET  /thresholds/:profile           — list all per-intent thresholds for a profile
 * POST /thresholds/:profile/:intent   — set min_confidence for a specific intent+profile
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { badRequest, serverError } from './http-utils.js';
import {
  getThresholdsForProfile,
  upsertThreshold,
} from '../../lib/intent-thresholds.js';

const router = Router();

// ─── GET /thresholds/:profile — list all thresholds for a profile ────
router.get('/thresholds/:profile', async (req: Request, res: Response) => {
  try {
    const { profile } = req.params;
    if (!profile || typeof profile !== 'string') {
      return badRequest(res, 'profile parameter required');
    }
    const thresholds = await getThresholdsForProfile(profile);
    res.json({ profile, thresholds });
  } catch (err: any) {
    serverError(res, err?.message || 'Failed to fetch thresholds');
  }
});

// ─── POST /thresholds/:profile/:intent — set min_confidence ─────────
router.post('/thresholds/:profile/:intent', async (req: Request, res: Response) => {
  try {
    const { profile, intent } = req.params;
    if (!profile || typeof profile !== 'string') {
      return badRequest(res, 'profile parameter required');
    }
    if (!intent || typeof intent !== 'string') {
      return badRequest(res, 'intent parameter required');
    }

    const { min_confidence } = req.body;
    if (min_confidence === undefined || min_confidence === null) {
      return badRequest(res, 'min_confidence is required');
    }
    if (typeof min_confidence !== 'number' || min_confidence < 0.0 || min_confidence > 1.0) {
      return badRequest(res, 'min_confidence must be a number between 0.0 and 1.0');
    }

    const result = await upsertThreshold(profile, intent, min_confidence);
    res.json({
      success: true,
      threshold: result,
    });
  } catch (err: any) {
    serverError(res, err?.message || 'Failed to set threshold');
  }
});

export default router;
