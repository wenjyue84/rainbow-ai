/**
 * US-247: Intent Classification Confidence Baseline Tracker
 *
 * GET /admin/api/intent-accuracy/baselines?profile=X
 *   Returns intents with current confidence vs baseline, flagging
 *   regressions >5% below baseline in the response.
 *
 * POST /admin/api/intent-accuracy/baselines/compute?profile=X&intent=Y
 *   Recomputes baseline for a specific profile+intent from recent analytics data.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { intentAccuracyBaselines, intentAnalytics } from '../../../shared/schema.js';
import { eq, and, desc, gte } from 'drizzle-orm';
import { ok, badRequest, serverError } from './http-utils.js';
import { computeIntentBaseline } from '../../assistant/intent-accuracy-baseline.js';

const router = Router();

/**
 * GET /admin/api/intent-accuracy/baselines?profile=X
 *
 * Returns all baseline rows for the given profile, sorted by mean_confidence asc
 * (lowest confidence first — regressions bubble to top).
 *
 * Each row includes a `regression` flag when current mean_confidence is >5%
 * below the stored baseline (i.e., the baseline itself has drifted down after recompute,
 * or when comparing live analytics vs stored baseline).
 */
router.get('/intent-accuracy/baselines', async (req: Request, res: Response) => {
  try {
    const profile = (req.query.profile as string) || 'pelangi';

    const baselines = await db
      .select()
      .from(intentAccuracyBaselines)
      .where(eq(intentAccuracyBaselines.profile, profile))
      .orderBy(intentAccuracyBaselines.meanConfidence);

    // For each baseline, check live analytics (last 7 days) to detect regressions
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const enriched = await Promise.all(baselines.map(async (baseline) => {
      const recentRows = await db
        .select({ confidence: intentAnalytics.confidence })
        .from(intentAnalytics)
        .where(and(
          eq(intentAnalytics.profileId, profile),
          eq(intentAnalytics.intentType, baseline.intent),
          gte(intentAnalytics.createdAt, sevenDaysAgo),
        ))
        .orderBy(desc(intentAnalytics.createdAt))
        .limit(100);

      const currentMean = recentRows.length > 0
        ? recentRows.reduce((s, r) => s + r.confidence, 0) / recentRows.length
        : null;

      const drop = currentMean !== null
        ? baseline.meanConfidence - currentMean
        : null;

      const regression = drop !== null && drop > 0.05;

      return {
        profile: baseline.profile,
        intent: baseline.intent,
        baseline_mean_confidence: baseline.meanConfidence,
        baseline_min_confidence: baseline.minConfidence,
        threshold: baseline.threshold,
        sample_count: baseline.sampleCount,
        last_updated: baseline.lastUpdated,
        current_mean_confidence: currentMean !== null
          ? Math.round(currentMean * 1000) / 1000
          : null,
        confidence_drop: drop !== null ? Math.round(drop * 1000) / 1000 : null,
        regression,
      };
    }));

    const regressionCount = enriched.filter(r => r.regression).length;

    return ok(res, {
      profile,
      baselines: enriched,
      total: enriched.length,
      regressions: regressionCount,
    });
  } catch (err: any) {
    return serverError(res, err);
  }
});

/**
 * POST /admin/api/intent-accuracy/baselines/compute?profile=X&intent=Y
 *
 * Recomputes and stores the baseline for a specific profile+intent
 * using the last 30 days of intent_analytics data.
 */
router.post('/intent-accuracy/baselines/compute', async (req: Request, res: Response) => {
  try {
    const profile = (req.query.profile as string) || 'pelangi';
    const intent = req.query.intent as string;

    if (!intent) {
      return badRequest(res, 'intent query param required');
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({ confidence: intentAnalytics.confidence })
      .from(intentAnalytics)
      .where(and(
        eq(intentAnalytics.profileId, profile),
        eq(intentAnalytics.intentType, intent),
        gte(intentAnalytics.createdAt, thirtyDaysAgo),
      ))
      .limit(500);

    if (rows.length === 0) {
      return badRequest(res, `No analytics data for profile=${profile} intent=${intent} in last 30 days`);
    }

    await computeIntentBaseline(profile, intent, rows);

    return ok(res, {
      profile,
      intent,
      sample_count: rows.length,
      message: 'Baseline computed and stored',
    });
  } catch (err: any) {
    return serverError(res, err);
  }
});

export default router;
