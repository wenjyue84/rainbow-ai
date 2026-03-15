/**
 * analytics-llm-validation.ts — Admin endpoint for LLM validation error rate metrics
 *
 * US-933: Schema-check structured AI responses before downstream use.
 * Exposes validation success/failure rates per context and overall.
 * Target: < 1% validation error rate.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getValidationMetrics } from '../../assistant/llm-validation-metrics.js';

const router = Router();

/**
 * GET /analytics/llm-validation
 *
 * Returns:
 * - overall: { totalCalls, schemaPass, schemaFail, recovered, errorRate }
 * - byContext: per-context breakdown
 * - recentFailures: last 50 validation failure events
 * - target: 0.01 (1% error rate target)
 * - withinTarget: boolean
 */
router.get('/analytics/llm-validation', (_req: Request, res: Response) => {
  const metrics = getValidationMetrics();
  const TARGET_ERROR_RATE = 0.01;

  res.json({
    ...metrics,
    target: TARGET_ERROR_RATE,
    withinTarget: metrics.overall.errorRate <= TARGET_ERROR_RATE,
  });
});

export default router;
