/**
 * model-rollback.ts — Admin API for model accuracy and rollback status
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getRollbackStatus,
  recordAccuracyMetric,
  getAccuracyHistory,
} from '../../assistant/models/model-rollback-controller.js';
import { ok, serverError } from './http-utils.js';

const router = Router();

/**
 * GET /admin/model-rollback-status
 *
 * Returns current model version, baseline accuracy, and rollback history.
 * Used to monitor if automatic rollback has been triggered due to accuracy degradation.
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const profileId = (req.query.profile as string) || 'pelangi';
    const status = await getRollbackStatus(profileId);

    ok(res, {
      profile: profileId,
      currentModelVersion: status.currentModelVersion,
      baselineAccuracy: status.baselineAccuracy,
      currentAccuracy: status.currentAccuracy,
      lastAccuracyCheckAt: status.lastAccuracyCheckAt,
      rollbackTriggered: status.rollbackTriggered,
      rollbackHistory: status.rollbackHistory,
    });
  } catch (error) {
    serverError(res, error);
  }
});

/**
 * POST /admin/model-rollback-record-accuracy
 *
 * Records a classification accuracy measurement.
 * If accuracy drops >5% below baseline, automatically triggers rollback.
 *
 * Body:
 *   {
 *     profileId: string (optional, default: 'pelangi')
 *     modelVersion: string
 *     accuracyScore: number (0.0-1.0)
 *     messagesTested: number
 *     baselineAccuracy?: number (optional)
 *   }
 */
router.post('/record-accuracy', async (req: Request, res: Response) => {
  try {
    const {
      profileId = 'pelangi',
      modelVersion,
      accuracyScore,
      messagesTested,
      baselineAccuracy,
    } = req.body;

    // Validate inputs
    if (!modelVersion || typeof accuracyScore !== 'number' || !messagesTested) {
      return res.status(400).json({
        error: 'Missing required fields: modelVersion, accuracyScore, messagesTested',
      });
    }

    if (accuracyScore < 0 || accuracyScore > 1) {
      return res.status(400).json({ error: 'accuracyScore must be between 0.0 and 1.0' });
    }

    if (messagesTested <= 0) {
      return res.status(400).json({ error: 'messagesTested must be > 0' });
    }

    await recordAccuracyMetric(
      { profileId, modelVersion, accuracyScore, messagesTested },
      baselineAccuracy
    );

    const status = await getRollbackStatus(profileId);

    ok(res, {
      message: 'Accuracy metric recorded',
      rollbackTriggered: status.rollbackTriggered,
      currentModelVersion: status.currentModelVersion,
    });
  } catch (error) {
    serverError(res, error);
  }
});

/**
 * GET /admin/model-rollback-history
 *
 * Returns accuracy history for a given time window.
 *
 * Query params:
 *   profile?: string (default: 'pelangi')
 *   hoursBack?: number (default: 24)
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const profileId = (req.query.profile as string) || 'pelangi';
    const hoursBack = parseInt((req.query.hoursBack as string) || '24', 10);

    if (hoursBack <= 0 || hoursBack > 8760) {
      return res
        .status(400)
        .json({ error: 'hoursBack must be between 1 and 8760 (1 year)' });
    }

    const history = await getAccuracyHistory(profileId, hoursBack);

    ok(res, {
      profile: profileId,
      timeWindow: `${hoursBack} hours`,
      entries: history,
      count: history.length,
    });
  } catch (error) {
    serverError(res, error);
  }
});

export default router;
