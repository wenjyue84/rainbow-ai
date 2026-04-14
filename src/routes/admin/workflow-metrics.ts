/**
 * Admin API: Booking Workflow Step Duration SLA Monitoring (US-623)
 *
 * GET /api/rainbow/metrics/workflow-metrics?profile=pelangi
 *   Returns workflow step metrics with SLA analysis
 *   {
 *     success: true,
 *     profile: "pelangi",
 *     steps: [{
 *       name: "collect_guest_name",
 *       avgDuration_ms: 45000,
 *       p95Duration_ms: 120000,
 *       slaViolations: 3,
 *       totalSamples: 150,
 *       trend: "stable"
 *     }, ...]
 *   }
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getProfileMetrics } from '../../lib/workflow-metrics.js';
import { createModuleLogger } from '../../lib/logger.js';

const router = Router();
const logger = createModuleLogger('WorkflowMetricsAdmin');

/**
 * GET /api/rainbow/metrics/workflow-metrics?profile=pelangi
 *
 * Returns aggregated workflow step metrics for a profile.
 * Includes average duration, P95, SLA violations, and trend analysis.
 */
router.get('/workflow-metrics', async (req: Request, res: Response) => {
  try {
    const profile = (req.query.profile as string) || 'pelangi';

    if (!profile) {
      return res.status(400).json({
        success: false,
        error: 'Profile ID is required (use ?profile=profileId)',
      });
    }

    const steps = await getProfileMetrics(profile);

    return res.json({
      success: true,
      profile,
      timestamp: new Date().toISOString(),
      steps,
      summary: {
        totalSteps: steps.length,
        totalSamples: steps.reduce((sum, s) => sum + s.totalSamples, 0),
        totalSlaViolations: steps.reduce((sum, s) => sum + s.slaViolations, 0),
        worstPerformingStep: steps.reduce((worst, step) => {
          if (!worst || step.avgDuration_ms > worst.avgDuration_ms) return step;
          return worst;
        }, null),
      },
    });
  } catch (error) {
    logger.error('Failed to get workflow metrics', {
      profile: req.params.profile,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve workflow metrics',
    });
  }
});

export default router;
