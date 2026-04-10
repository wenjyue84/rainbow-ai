/**
 * Admin API: Booking Success Funnel Analyzer (US-322)
 *
 * GET /admin/metrics/booking-funnel?profile=pelangi&window=7d
 *
 * Tracks conversion metrics from intent classification → booking confirmation by profile.
 * Returns funnel structure showing drop-off points in the booking journey.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady } from '../../lib/db.js';
import { bookingStageTransitions } from '../../../shared/schema.js';
import { sql, and, gte, eq } from 'drizzle-orm';

const router = Router();

// ─── Booking funnel stages (in order) ────────────────────────────────
// These represent the canonical booking conversion funnel for per-profile analysis.
export const BOOKING_FUNNEL_STAGES = [
  'intent_matched',      // Stage 0: Intent classification detected booking intent
  'guest_confirmed',     // Stage 1: Guest accepted booking workflow prompt
  'booking_finalized',   // Stage 2: Booking confirmed and persisted
] as const;

export type BookingFunnelStage = (typeof BOOKING_FUNNEL_STAGES)[number];

// ─── Pure calculation functions (exported for testing) ──────────────

export interface FunnelStage {
  stage: BookingFunnelStage;
  count: number;
  confidence_score?: number;
}

export interface ConversionMetrics {
  stage: BookingFunnelStage;
  count: number;
  percentage: string;
  drop_from_previous: string;
}

/**
 * Build funnel with conversion % calculations.
 * Pure function — no side effects.
 */
export function buildFunnelWithMetrics(
  stageCounts: Record<BookingFunnelStage, number>,
  stageConfidences: Record<BookingFunnelStage, number>
): {
  funnel: FunnelStage[];
  conversions: ConversionMetrics[];
} {
  const firstStageName = BOOKING_FUNNEL_STAGES[0];
  const firstStageCount = stageCounts[firstStageName] ?? 0;

  const funnel: FunnelStage[] = BOOKING_FUNNEL_STAGES.map((stage) => ({
    stage,
    count: stageCounts[stage] ?? 0,
    confidence_score: stageConfidences[stage] ?? undefined,
  }));

  const conversions: ConversionMetrics[] = [];
  for (let i = 0; i < BOOKING_FUNNEL_STAGES.length; i++) {
    const stage = BOOKING_FUNNEL_STAGES[i];
    const stageCount = stageCounts[stage] ?? 0;
    const percentage =
      firstStageCount > 0
        ? ((stageCount / firstStageCount) * 100).toFixed(1)
        : '0.0';

    let dropFromPrevious = '0.0';
    if (i > 0) {
      const prevStage = BOOKING_FUNNEL_STAGES[i - 1];
      const prevCount = stageCounts[prevStage] ?? 0;
      if (prevCount > 0) {
        dropFromPrevious = (((prevCount - stageCount) / prevCount) * 100).toFixed(1);
      }
    }

    conversions.push({
      stage,
      count: stageCount,
      percentage: `${percentage}%`,
      drop_from_previous: i === 0 ? 'N/A' : `${dropFromPrevious}%`,
    });
  }

  return { funnel, conversions };
}

// ─── GET /admin/metrics/booking-funnel ──────────────────────────────
router.get('/metrics/booking-funnel', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({
        success: true,
        profiles: [],
        warning: 'Database connection unavailable.',
      });
    }

    const profileId = (req.query.profile as string) || (res.locals.profileId as string) || undefined;
    const windowParam = (req.query.window as string) || '7d';

    // Parse window parameter (e.g., '7d' → 7 days, '30d' → 30 days)
    const match = windowParam.match(/^(\d+)([dhm])$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid window format. Use "7d", "30d", "24h", etc.' });
    }
    const [, numStr, unit] = match;
    const num = parseInt(numStr);
    let days = num;
    if (unit === 'h') {
      days = Math.ceil(num / 24);
    } else if (unit === 'm') {
      days = Math.ceil(num / 1440);
    }
    days = Math.min(365, Math.max(1, days));

    const since = new Date();
    since.setDate(since.getDate() - days);

    // Query: Count transitions per stage per profile
    const transitionsQuery = db
      .select({
        profile: bookingStageTransitions.profile,
        stage: bookingStageTransitions.toStage,
        count: sql<number>`count(*)::int`,
        avgConfidence: sql<number>`AVG(${bookingStageTransitions.confidence})`,
      })
      .from(bookingStageTransitions)
      .where(
        and(
          gte(bookingStageTransitions.timestamp, since),
          profileId ? eq(bookingStageTransitions.profile, profileId) : sql`true`
        )
      )
      .groupBy(bookingStageTransitions.profile, bookingStageTransitions.toStage);

    const transitions = await transitionsQuery;

    // Build per-profile results
    const profileMap = new Map<string, {
      stageCounts: Record<BookingFunnelStage, number>;
      stageConfidences: Record<BookingFunnelStage, number>;
    }>();

    for (const row of transitions) {
      const pid = row.profile ?? 'unknown';
      if (!profileMap.has(pid)) {
        profileMap.set(pid, {
          stageCounts: { intent_matched: 0, guest_confirmed: 0, booking_finalized: 0 },
          stageConfidences: { intent_matched: 0, guest_confirmed: 0, booking_finalized: 0 },
        });
      }
      const entry = profileMap.get(pid)!;
      const stage = row.stage as BookingFunnelStage;
      if (BOOKING_FUNNEL_STAGES.includes(stage)) {
        entry.stageCounts[stage] = row.count ?? 0;
        if (row.avgConfidence) {
          entry.stageConfidences[stage] = row.avgConfidence;
        }
      }
    }

    const profiles = Array.from(profileMap.entries()).map(([pid, data]) => {
      const { funnel, conversions } = buildFunnelWithMetrics(
        data.stageCounts,
        data.stageConfidences
      );

      return {
        profile_id: pid,
        period_days: days,
        funnel,
        conversions,
      };
    });

    return res.json({
      success: true,
      window: windowParam,
      profiles,
    });
  } catch (err) {
    console.error('[analytics-booking-funnel] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
