/**
 * Admin API: Intent Confidence Variance Analytics (US-491)
 *
 * GET /admin/analytics/intent-variance?minSamples=50&profileId=pelangi&sinceDays=90
 *   Returns JSON with variance stats, CV threshold alerts, and intent stability scores
 *
 * Tracks confidence score variance per intent to identify unreliable classifications
 * requiring keyword refinement.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { dbReady } from '../../lib/db.js';
import {
  calculateIntentVariance,
  flagUnstableIntents,
  type VarianceCalculationOptions,
} from '../../lib/intent-confidence-variance.js';
import { createModuleLogger } from '../../lib/logger.js';

const router = Router();
const logger = createModuleLogger('AnalyticsIntentVariance');

/**
 * GET /admin/analytics/intent-variance
 *
 * Query params:
 *   minSamples=50     — Minimum samples per intent (default: 50)
 *   profileId=pelangi — Filter by profile (optional)
 *   sinceDays=90      — Time window in days (default: 90)
 *
 * Response:
 *   {
 *     success: true,
 *     timestamp: "2026-04-11T15:30:00Z",
 *     totalIntents: 145,
 *     intentsAnalyzed: 87,
 *     minSamplesThreshold: 50,
 *     unstableIntentsCount: 12,
 *     cvThreshold: 0.15,
 *     intents: [
 *       {
 *         intent: "checkout_info",
 *         sampleCount: 523,
 *         minConfidence: 0.42,
 *         maxConfidence: 0.98,
 *         meanConfidence: 0.78,
 *         variance: 0.0342,
 *         stdDeviation: 0.185,
 *         coefficientOfVariation: 0.237,
 *         isUnstable: true
 *       },
 *       ...
 *     ]
 *   }
 */
router.get('/intent-variance', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({
        success: true,
        warning: 'Database connection unavailable.',
        timestamp: new Date().toISOString(),
        totalIntents: 0,
        intentsAnalyzed: 0,
        unstableIntentsCount: 0,
        intents: [],
      });
    }

    // Parse query parameters
    const minSamples = Math.max(10, parseInt(req.query.minSamples as string) || 50);
    const profileId = req.query.profileId as string | undefined;
    const sinceDays = Math.max(1, parseInt(req.query.sinceDays as string) || 90);

    const options: VarianceCalculationOptions = {
      minSamples,
      profileId,
      sinceDays,
    };

    logger.debug('Computing intent confidence variance', { options });

    // Compute variance statistics
    const report = await calculateIntentVariance(options);

    // Identify unstable intents
    const unstable = flagUnstableIntents(report.intents, { cvThreshold: 0.15 });

    logger.info(
      `Computed variance for ${report.intentsAnalyzed} intents; ` +
        `${unstable.length} unstable (CV > 0.15)`,
      {
        totalIntents: report.totalIntents,
        analyzed: report.intentsAnalyzed,
        unstable: unstable.length,
        profileId,
      },
    );

    return res.json({
      success: true,
      ...report,
      alertedIntents: unstable.map((s) => ({
        intent: s.intent,
        coefficientOfVariation: s.coefficientOfVariation,
        sampleCount: s.sampleCount,
        meanConfidence: s.meanConfidence,
        stdDeviation: s.stdDeviation,
        recommendation: `Review keyword definitions for "${s.intent}" — high variance (CV=${s.coefficientOfVariation.toFixed(3)}) indicates inconsistent classification. Keywords may overlap with other intents or be too broad.`,
      })),
    });
  } catch (error) {
    logger.error('Intent variance endpoint error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to compute intent variance',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
