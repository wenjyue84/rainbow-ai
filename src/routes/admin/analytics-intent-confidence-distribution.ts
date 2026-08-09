/**
 * Admin API: Per-Intent Confidence Percentile Distribution (US-359)
 *
 * GET /admin/analytics/intent-confidence-distribution?profileId=pelangi&days=30
 *
 * Returns p50, p95, p99 confidence percentiles per intent across all profiles.
 * Helps identify which intents struggle most and guide classifier retraining.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady } from '../../lib/db.js';
import { intentAnalytics } from '../../../shared/schema.js';
import { and, gte, eq } from 'drizzle-orm';
import { calculateConfidencePercentiles } from '../../lib/analytics/confidence-percentile.js';

const router = Router();

/**
 * GET /admin/analytics/intent-confidence-distribution
 *
 * Query params:
 * - profileId: optional, filter by profile (default: all profiles)
 * - days: optional, days to look back (default: 30, max: 90)
 *
 * Response:
 * {
 *   success: true,
 *   profileId: "pelangi" | null,
 *   period: { days: 30, since: "2026-02-22T..." },
 *   intents: {
 *     "booking": { p50: 0.87, p95: 0.98, p99: 0.99, sampleCount: 245, min: 0.55, max: 0.99, mean: 0.85 },
 *     "inquiry": { p50: 0.92, p95: 0.99, p99: 1.0, sampleCount: 189, ... },
 *     ...
 *   },
 *   allProfiles: [
 *     { profile: "pelangi", intents: { "booking": {...} } },
 *     { profile: "makan", intents: { "booking": {...} } },
 *     ...
 *   ]
 * }
 */
router.get('/admin/analytics/intent-confidence-distribution', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({
        success: true,
        profileId: null,
        period: { days: 30, since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
        intents: {},
        allProfiles: [],
        warning: 'Database connection unavailable.',
      });
    }

    const profileId = (req.query.profileId as string) || null;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 30));
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Fetch all intent analytics in period
    const query = db.select().from(intentAnalytics);

    // Apply filters
    const conditions = [gte(intentAnalytics.createdAt, since)];
    if (profileId) {
      conditions.push(eq(intentAnalytics.profileId, profileId));
    }

    const rows = await query.where(and(...conditions));

    // Group by profileId and intentType
    const byProfile = new Map<string, Map<string, number[]>>();

    for (const row of rows) {
      const prof = row.profileId || 'unknown';
      if (!byProfile.has(prof)) {
        byProfile.set(prof, new Map());
      }

      const intentMap = byProfile.get(prof)!;
      if (!intentMap.has(row.intentType)) {
        intentMap.set(row.intentType, []);
      }

      intentMap.get(row.intentType)!.push(row.confidence);
    }

    // Calculate percentiles for each profile/intent combination
    const allProfiles = Array.from(byProfile.entries()).map(([prof, intentMap]) => {
      const intents: Record<string, any> = {};

      for (const [intent, confidences] of intentMap) {
        intents[intent] = calculateConfidencePercentiles(confidences);
      }

      return {
        profile: prof,
        intents,
      };
    });

    // If specific profileId requested, also return top-level intents for that profile
    let profileIntents: Record<string, any> = {};
    if (profileId && byProfile.has(profileId)) {
      const intentMap = byProfile.get(profileId)!;
      for (const [intent, confidences] of intentMap) {
        profileIntents[intent] = calculateConfidencePercentiles(confidences);
      }
    } else if (!profileId && byProfile.size > 0) {
      // Return aggregated across all profiles
      const allConfidencesByIntent = new Map<string, number[]>();
      for (const intentMap of byProfile.values()) {
        for (const [intent, confidences] of intentMap) {
          if (!allConfidencesByIntent.has(intent)) {
            allConfidencesByIntent.set(intent, []);
          }
          allConfidencesByIntent.get(intent)!.push(...confidences);
        }
      }

      for (const [intent, confidences] of allConfidencesByIntent) {
        profileIntents[intent] = calculateConfidencePercentiles(confidences);
      }
    }

    return res.json({
      success: true,
      profileId: profileId || null,
      period: { days, since: since.toISOString() },
      intents: profileIntents,
      allProfiles,
    });
  } catch (err: any) {
    console.error('Intent confidence distribution error:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch confidence distribution',
      message: err?.message || 'Unknown error',
    });
  }
});

export default router;
