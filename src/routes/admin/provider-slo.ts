/**
 * provider-slo.ts — Admin API for LLM provider latency SLO tracking (US-996)
 *
 * Exposes the current provider priority order including any latency-based demotions,
 * per-provider P95 latency, and SLO configuration.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, serverError } from './http-utils.js';
import { getProviders } from '../../assistant/ai-provider-manager.js';
import { latencySLOTracker } from '../../assistant/latency-slo-tracker.js';

const router = Router();

/**
 * GET /analytics/provider-slo
 *
 * Returns current provider priority order with SLO status for each provider.
 * Demoted providers appear after all healthy providers.
 */
router.get('/analytics/provider-slo', (_req: Request, res: Response) => {
  try {
    const providers = getProviders();
    const sloStatuses = latencySLOTracker.getAllStatuses();
    const config = latencySLOTracker.getConfig();

    const providerOrder = providers.map((p, index) => {
      const slo = sloStatuses[p.id];
      return {
        rank: index + 1,
        id: p.id,
        name: p.name,
        configuredPriority: p.priority,
        demoted: slo?.demoted ?? false,
        p95Ms: slo?.p95Ms ?? null,
        sampleCount: slo?.sampleCount ?? 0,
        consecutiveFastCalls: slo?.consecutiveFastCalls ?? 0,
        demotedAt: slo?.demotedAt ?? null,
        withinSLO: slo ? (slo.p95Ms === null || slo.p95Ms <= config.slowThresholdMs) : true,
      };
    });

    ok(res, {
      config: {
        windowSize: config.windowSize,
        slowThresholdMs: config.slowThresholdMs,
        recoveryWindow: config.recoveryWindow,
      },
      providers: providerOrder,
    });
  } catch (err: any) {
    serverError(res, err);
  }
});

/**
 * POST /analytics/provider-slo/reset
 *
 * Reset SLO tracking for a specific provider or all providers.
 * Body: { providerId?: string }
 */
router.post('/analytics/provider-slo/reset', (req: Request, res: Response) => {
  try {
    const { providerId } = req.body ?? {};
    if (providerId && typeof providerId === 'string') {
      latencySLOTracker.reset(providerId);
      ok(res, { reset: providerId });
    } else {
      latencySLOTracker.resetAll();
      ok(res, { reset: 'all' });
    }
  } catch (err: any) {
    serverError(res, err);
  }
});

export default router;
