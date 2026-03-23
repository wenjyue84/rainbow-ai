/**
 * Admin API: Fallback Response Effectiveness Analysis (US-300)
 *
 * GET /admin/fallback-analysis/:profile
 *   Calculates effectiveness ratio per fallback template for the given profile.
 *   Templates with <60% resolution rate are flagged as low-quality.
 *
 * POST /admin/fallback-analysis/record-escalation
 *   Records an escalation event for a fallback template.
 *
 * POST /admin/fallback-analysis/record-resolution
 *   Records a resolution for a fallback template.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { fallbackResponseMetrics } from '../../../shared/schema.js';
import { eq, and, sql } from 'drizzle-orm';

const router = Router();

/** Resolution rate threshold below which a template is flagged as low-quality */
const LOW_QUALITY_THRESHOLD = 0.60;

/**
 * Record an escalation for a fallback template (upsert).
 * Exported for use by the message pipeline when a fallback triggers an escalation.
 */
export async function recordFallbackEscalation(
  profileId: string,
  templateId: string,
): Promise<void> {
  await db
    .insert(fallbackResponseMetrics)
    .values({
      profileId,
      templateId,
      escalationCount: 1,
      resolutionCount: 0,
    })
    .onConflictDoUpdate({
      target: [fallbackResponseMetrics.profileId, fallbackResponseMetrics.templateId],
      set: {
        escalationCount: sql`${fallbackResponseMetrics.escalationCount} + 1`,
        timestamp: sql`now()`,
      },
    });
}

/**
 * Record a resolution for a fallback template (upsert).
 * Called when a fallback conversation is resolved without further escalation.
 */
export async function recordFallbackResolution(
  profileId: string,
  templateId: string,
): Promise<void> {
  await db
    .insert(fallbackResponseMetrics)
    .values({
      profileId,
      templateId,
      escalationCount: 0,
      resolutionCount: 1,
    })
    .onConflictDoUpdate({
      target: [fallbackResponseMetrics.profileId, fallbackResponseMetrics.templateId],
      set: {
        resolutionCount: sql`${fallbackResponseMetrics.resolutionCount} + 1`,
        timestamp: sql`now()`,
      },
    });
}

/**
 * Calculate effectiveness ratio for a template.
 * effectiveness = resolution_count / (escalation_count + resolution_count)
 */
function calculateEffectiveness(escalationCount: number, resolutionCount: number): number {
  const total = escalationCount + resolutionCount;
  if (total === 0) return 0;
  return resolutionCount / total;
}

/**
 * Suggest a replacement description based on template quality.
 */
function getRecommendation(effectiveness: number, templateId: string): string {
  if (effectiveness < 0.3) {
    return `Template "${templateId}" has very low effectiveness (${(effectiveness * 100).toFixed(1)}%). Consider replacing with a more specific response or adding intent coverage.`;
  }
  if (effectiveness < LOW_QUALITY_THRESHOLD) {
    return `Template "${templateId}" is underperforming (${(effectiveness * 100).toFixed(1)}%). Review recent escalations to identify improvement areas.`;
  }
  return '';
}

// GET /admin/fallback-analysis/:profile — Effectiveness ratio per template
router.get('/fallback-analysis/:profile', async (req: Request, res: Response) => {
  try {
    const { profile } = req.params;
    if (!profile || typeof profile !== 'string') {
      res.status(400).json({ error: 'Profile parameter is required' });
      return;
    }

    const metrics = await db
      .select()
      .from(fallbackResponseMetrics)
      .where(eq(fallbackResponseMetrics.profileId, profile));

    const templates = metrics.map((m) => {
      const effectiveness = calculateEffectiveness(m.escalationCount, m.resolutionCount);
      const isLowQuality = effectiveness < LOW_QUALITY_THRESHOLD;
      const recommendation = isLowQuality ? getRecommendation(effectiveness, m.templateId) : undefined;

      return {
        template_id: m.templateId,
        escalation_count: m.escalationCount,
        resolution_count: m.resolutionCount,
        effectiveness_ratio: Math.round(effectiveness * 1000) / 1000, // 3 decimal places
        low_quality: isLowQuality,
        ...(recommendation ? { recommendation } : {}),
      };
    });

    // Sort by effectiveness ascending (worst first)
    templates.sort((a, b) => a.effectiveness_ratio - b.effectiveness_ratio);

    res.json({
      profile,
      templates,
      summary: {
        total_templates: templates.length,
        low_quality_count: templates.filter((t) => t.low_quality).length,
      },
    });
  } catch (err: any) {
    console.error('[FallbackAnalysis] Query failed:', err.message);
    res.status(500).json({ error: 'Failed to compute fallback analysis' });
  }
});

// POST /admin/fallback-analysis/record-escalation — Record escalation metric
router.post('/fallback-analysis/record-escalation', async (req: Request, res: Response) => {
  try {
    const { profile_id, template_id } = req.body;
    if (!profile_id || !template_id) {
      res.status(400).json({ error: 'profile_id and template_id are required' });
      return;
    }

    await recordFallbackEscalation(profile_id, template_id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[FallbackAnalysis] Record escalation failed:', err.message);
    res.status(500).json({ error: 'Failed to record escalation' });
  }
});

// POST /admin/fallback-analysis/record-resolution — Record resolution metric
router.post('/fallback-analysis/record-resolution', async (req: Request, res: Response) => {
  try {
    const { profile_id, template_id } = req.body;
    if (!profile_id || !template_id) {
      res.status(400).json({ error: 'profile_id and template_id are required' });
      return;
    }

    await recordFallbackResolution(profile_id, template_id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[FallbackAnalysis] Record resolution failed:', err.message);
    res.status(500).json({ error: 'Failed to record resolution' });
  }
});

export default router;
