/**
 * Admin API: Booking Conversion Rate Analytics (US-292)
 *
 * GET /analytics/booking-conversion-rates?profileId=pelangi&days=30
 *
 * Tracks which profiles have lowest booking confirmation rates and identifies
 * workflow steps where guests abandon the process most. Enables targeted
 * workflow improvements by profile.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady } from '../../lib/db.js';
import { rainbowMessages } from '../../../shared/schema.js';
import { sql, and, gte, eq } from 'drizzle-orm';

const router = Router();

// ─── Booking workflow steps in order (funnel) ────────────────────────
// These are the canonical workflow steps for booking conversion tracking.
export const BOOKING_FUNNEL_STEPS = [
  'select-room',
  'enter-dates',
  'confirm-payment',
  'finalize',
] as const;

export type BookingFunnelStep = (typeof BOOKING_FUNNEL_STEPS)[number];

// ─── Pure calculation functions (exported for testing) ──────────────

export interface BookingConversionInput {
  bookingConversations: number;
  completedBookings: number;
  abandonmentStepBreakdown: Record<string, number>;
}

export interface BookingConversionMetrics {
  bookingConversations: number;
  completedBookings: number;
  completionRate: string;
  abandonmentRate: string;
  abandonmentStepBreakdown: Record<string, number>;
}

/**
 * Calculate booking conversion metrics from raw counts.
 * Pure function — no side effects, fully testable.
 */
export function calculateConversionMetrics(
  input: BookingConversionInput
): BookingConversionMetrics {
  const { bookingConversations, completedBookings, abandonmentStepBreakdown } = input;
  const completionRate =
    bookingConversations > 0
      ? ((completedBookings / bookingConversations) * 100).toFixed(1)
      : '0.0';
  const abandonmentRate =
    bookingConversations > 0
      ? (((bookingConversations - completedBookings) / bookingConversations) * 100).toFixed(1)
      : '0.0';

  return {
    bookingConversations,
    completedBookings,
    completionRate: `${completionRate}%`,
    abandonmentRate: `${abandonmentRate}%`,
    abandonmentStepBreakdown,
  };
}

export interface FunnelStep {
  step: string;
  reached: number;
  reachedPct: string;
}

/**
 * Build a funnel visualization showing % of guests reaching each step.
 * Pure function — no side effects.
 */
export function buildFunnel(
  totalInitiations: number,
  stepCounts: Record<string, number>
): FunnelStep[] {
  return BOOKING_FUNNEL_STEPS.map((step) => {
    const reached = stepCounts[step] ?? 0;
    const reachedPct =
      totalInitiations > 0
        ? ((reached / totalInitiations) * 100).toFixed(1)
        : '0.0';
    return { step, reached, reachedPct: `${reachedPct}%` };
  });
}

// ─── GET /analytics/booking-conversion-rates ─────────────────────────
router.get('/analytics/booking-conversion-rates', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({
        success: true,
        profiles: [],
        warning: 'Database connection unavailable.',
      });
    }

    const profileId = (req.query.profileId as string) || (res.locals.profileId as string) || undefined;
    const days = Math.min(365, Math.max(1, parseInt(req.query.days as string) || 30));
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Query 1: Count booking initiations per profile
    // A booking initiation = a message with intent = 'booking' and role = 'user'
    const initiationsQuery = db
      .select({
        profileId: rainbowMessages.profileId,
        count: sql<number>`count(distinct ${rainbowMessages.phone})::int`,
      })
      .from(rainbowMessages)
      .where(
        and(
          gte(rainbowMessages.timestamp, since),
          eq(rainbowMessages.intent, 'booking'),
          eq(rainbowMessages.role, 'user'),
          profileId ? eq(rainbowMessages.profileId, profileId) : sql`true`
        )
      )
      .groupBy(rainbowMessages.profileId);

    // Query 2: Count completed bookings per profile
    // A completed booking = a message with workflow_id containing 'booking' and step_id = 'finalize'
    const completionsQuery = db
      .select({
        profileId: rainbowMessages.profileId,
        count: sql<number>`count(distinct ${rainbowMessages.phone})::int`,
      })
      .from(rainbowMessages)
      .where(
        and(
          gte(rainbowMessages.timestamp, since),
          sql`${rainbowMessages.workflowId} ILIKE '%booking%'`,
          eq(rainbowMessages.stepId, 'finalize'),
          profileId ? eq(rainbowMessages.profileId, profileId) : sql`true`
        )
      )
      .groupBy(rainbowMessages.profileId);

    // Query 3: Step-level breakdown per profile for funnel + abandonment
    const stepsQuery = db
      .select({
        profileId: rainbowMessages.profileId,
        stepId: rainbowMessages.stepId,
        count: sql<number>`count(distinct ${rainbowMessages.phone})::int`,
      })
      .from(rainbowMessages)
      .where(
        and(
          gte(rainbowMessages.timestamp, since),
          sql`${rainbowMessages.workflowId} ILIKE '%booking%'`,
          sql`${rainbowMessages.stepId} IS NOT NULL`,
          profileId ? eq(rainbowMessages.profileId, profileId) : sql`true`
        )
      )
      .groupBy(rainbowMessages.profileId, rainbowMessages.stepId);

    const [initiations, completions, steps] = await Promise.all([
      initiationsQuery,
      completionsQuery,
      stepsQuery,
    ]);

    // Build per-profile results
    const profileMap = new Map<string, {
      initiations: number;
      completions: number;
      stepCounts: Record<string, number>;
    }>();

    for (const row of initiations) {
      const pid = row.profileId ?? 'unknown';
      if (!profileMap.has(pid)) {
        profileMap.set(pid, { initiations: 0, completions: 0, stepCounts: {} });
      }
      profileMap.get(pid)!.initiations = row.count;
    }

    for (const row of completions) {
      const pid = row.profileId ?? 'unknown';
      if (!profileMap.has(pid)) {
        profileMap.set(pid, { initiations: 0, completions: 0, stepCounts: {} });
      }
      profileMap.get(pid)!.completions = row.count;
    }

    for (const row of steps) {
      const pid = row.profileId ?? 'unknown';
      if (!profileMap.has(pid)) {
        profileMap.set(pid, { initiations: 0, completions: 0, stepCounts: {} });
      }
      const entry = profileMap.get(pid)!;
      if (row.stepId) {
        entry.stepCounts[row.stepId] = row.count;
      }
    }

    const profiles = Array.from(profileMap.entries()).map(([pid, data]) => {
      // Build abandonment step breakdown: for each step, how many guests
      // reached this step but didn't reach the next
      const abandonmentStepBreakdown: Record<string, number> = {};
      for (let i = 0; i < BOOKING_FUNNEL_STEPS.length - 1; i++) {
        const currentStep = BOOKING_FUNNEL_STEPS[i];
        const nextStep = BOOKING_FUNNEL_STEPS[i + 1];
        const currentCount = data.stepCounts[currentStep] ?? 0;
        const nextCount = data.stepCounts[nextStep] ?? 0;
        const abandoned = Math.max(0, currentCount - nextCount);
        if (abandoned > 0) {
          abandonmentStepBreakdown[currentStep] = abandoned;
        }
      }

      const metrics = calculateConversionMetrics({
        bookingConversations: data.initiations,
        completedBookings: data.completions,
        abandonmentStepBreakdown,
      });

      const funnel = buildFunnel(data.initiations, data.stepCounts);

      return {
        profile_id: pid,
        booking_conversations: metrics.bookingConversations,
        completed_bookings: metrics.completedBookings,
        completion_rate: metrics.completionRate,
        abandonment_rate: metrics.abandonmentRate,
        abandonment_step_breakdown: metrics.abandonmentStepBreakdown,
        funnel,
      };
    });

    return res.json({
      success: true,
      period_days: days,
      profiles,
    });
  } catch (err) {
    console.error('[analytics-booking-conversion] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
