/**
 * US-158 / US-159: Intent Classifier Regression Detector
 *
 * US-158: Detects when intent classification accuracy drops unexpectedly by
 * comparing rolling windows.
 * US-159: Stores baselines in intent_classifier_baselines table and creates
 * regression_alerts records when accuracy drops >5% from stored baseline.
 */

import cron from 'node-cron';
import { db } from '../db.js';
import { intentPredictions, intentClassifierBaselines, regressionAlerts } from '../../../shared/schema.js';
import { and, gte, isNotNull, sql, eq } from 'drizzle-orm';

export interface RegressionCheckResult {
  status: 'regression_detected' | 'healthy';
  intent: string;
  previousAccuracy: number;
  currentAccuracy: number;
  accuracyDrop: number;
}

export interface AllIntentsRegressionResult {
  overallStatus: 'regression_detected' | 'healthy';
  intents: RegressionCheckResult[];
  timestamp: string;
}

/**
 * Calculate accuracy for an intent within a specific time window
 */
export async function calculateIntentAccuracy(
  intent: string,
  startDate: Date,
  endDate: Date,
  profile?: string,
  _retried: boolean = false
): Promise<{ total: number; correct: number; accuracy: number } | null> {
  try {
    const conditions = [
      sql`${intentPredictions.predictedIntent} = ${intent}`,
      gte(intentPredictions.createdAt, startDate),
      sql`${intentPredictions.createdAt} <= ${endDate}`,
      isNotNull(intentPredictions.wasCorrect), // Only count validated predictions
    ];

    if (profile && !_retried) {
      conditions.push(sql`${intentPredictions.profile} = ${profile}`);
    }

    const results = await db
      .select({
        total: sql<number>`count(*)::int`,
        correct: sql<number>`count(*) filter (where ${intentPredictions.wasCorrect} = true)::int`,
      })
      .from(intentPredictions)
      .where(and(...conditions));

    if (!results[0] || results[0].total === 0) {
      return null;
    }

    const { total, correct } = results[0];
    const accuracy = (correct / total) * 100;

    return {
      total,
      correct,
      accuracy: Math.round(accuracy * 100) / 100, // Round to 2 decimals
    };
  } catch (error: any) {
    // Gracefully handle case where profile column doesn't exist (test environments)
    if (!_retried && profile && error.message?.includes('does not exist')) {
      console.warn(`[Regression Detector] Profile column not available; retrying without profile filter`);
      // Retry without profile filter (only once)
      return calculateIntentAccuracy(intent, startDate, endDate, profile, true);
    }
    console.error(`[Regression Detector] Error calculating accuracy for intent "${intent}":`, error);
    throw error;
  }
}

/**
 * Get all intents that have at least one validated prediction in the recent window
 */
export async function getIntentsInWindow(startDate: Date, endDate: Date, profile?: string, _retried: boolean = false): Promise<string[]> {
  try {
    const conditions = [
      gte(intentPredictions.createdAt, startDate),
      sql`${intentPredictions.createdAt} <= ${endDate}`,
      isNotNull(intentPredictions.wasCorrect),
    ];

    if (profile && !_retried) {
      conditions.push(sql`${intentPredictions.profile} = ${profile}`);
    }

    const results = await db
      .select({
        intent: intentPredictions.predictedIntent,
      })
      .from(intentPredictions)
      .where(and(...conditions))
      .groupBy(intentPredictions.predictedIntent);

    return results.map(r => r.intent);
  } catch (error: any) {
    // Gracefully handle case where profile column doesn't exist (test environments)
    if (!_retried && profile && (error.message?.includes('does not exist') || error.cause?.message?.includes('does not exist'))) {
      console.warn(`[Regression Detector] Profile column not available; retrying without profile filter`);
      // Retry without profile filter (only once)
      return getIntentsInWindow(startDate, endDate, undefined, true);
    }
    console.error('[Regression Detector] Error getting intents in window:', error);
    throw error;
  }
}

/**
 * Detect regression for a single intent by comparing current window accuracy to baseline
 */
export async function detectIntentRegression(
  intent: string,
  currentWindowDays: number,
  baselineWindowDays: number,
  threshold: number = 0.05,
  profile?: string
): Promise<RegressionCheckResult | null> {
  try {
    const now = new Date();

    // Current window: last N days
    const currentStart = new Date(now.getTime() - currentWindowDays * 24 * 60 * 60 * 1000);
    const currentEnd = now;

    // Baseline window: N days before current window
    const baselineEnd = currentStart;
    const baselineStart = new Date(baselineEnd.getTime() - baselineWindowDays * 24 * 60 * 60 * 1000);

    const currentAccuracyData = await calculateIntentAccuracy(intent, currentStart, currentEnd, profile);
    const baselineAccuracyData = await calculateIntentAccuracy(intent, baselineStart, baselineEnd, profile);

    // If either window has no data, skip
    if (!currentAccuracyData || !baselineAccuracyData) {
      return null;
    }

    const drop = (baselineAccuracyData.accuracy - currentAccuracyData.accuracy) / 100;
    const isRegression = drop >= threshold;

    return {
      status: isRegression ? 'regression_detected' : 'healthy',
      intent,
      previousAccuracy: Math.round(baselineAccuracyData.accuracy * 100) / 100,
      currentAccuracy: Math.round(currentAccuracyData.accuracy * 100) / 100,
      accuracyDrop: Math.round(drop * 10000) / 100, // Convert to percentage
    };
  } catch (error) {
    console.error(`[Regression Detector] Error detecting regression for intent "${intent}":`, error);
    throw error;
  }
}

/**
 * Run regression check across all intents in the recent window
 */
export async function checkRegressions(
  days: number = 7,
  threshold: number = 0.05,
  profile?: string
): Promise<AllIntentsRegressionResult> {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // Get all intents with data in the recent window
    const intents = await getIntentsInWindow(windowStart, now, profile);

    // Check regression for each intent
    const results: RegressionCheckResult[] = [];
    for (const intent of intents) {
      const result = await detectIntentRegression(intent, days, days, threshold, profile);
      if (result) {
        results.push(result);
      }
    }

    // Overall status: regression if ANY intent has regression
    const overallStatus = results.some(r => r.status === 'regression_detected') ? 'regression_detected' : 'healthy';

    return {
      overallStatus,
      intents: results,
      timestamp: now.toISOString(),
    };
  } catch (error) {
    console.error('[Regression Detector] Error checking regressions:', error);
    throw error;
  }
}

/**
 * US-159: Update intent_classifier_baselines table with 7-day rolling accuracy
 * Queries intentPredictions for the last `days` days and upserts one row per (profile, intent).
 */
export async function updateBaselines(days: number = 7): Promise<number> {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // Aggregate accuracy per (profile, intent) over the window
    const rows = await db
      .select({
        profileId: sql<string>`coalesce(${intentPredictions.profile}, 'default')`,
        intentType: intentPredictions.predictedIntent,
        total: sql<number>`count(*)::int`,
        correct: sql<number>`count(*) filter (where ${intentPredictions.wasCorrect} = true)::int`,
      })
      .from(intentPredictions)
      .where(
        and(
          gte(intentPredictions.createdAt, windowStart),
          isNotNull(intentPredictions.wasCorrect),
        )
      )
      .groupBy(
        sql`coalesce(${intentPredictions.profile}, 'default')`,
        intentPredictions.predictedIntent,
      );

    let upserted = 0;
    for (const row of rows) {
      if (!row.intentType || row.total === 0) continue;
      const accuracyPct = Math.round((row.correct / row.total) * 10000) / 100;

      await db
        .insert(intentClassifierBaselines)
        .values({
          profileId: row.profileId,
          intentType: row.intentType,
          accuracyPct,
          sampleCount: row.total,
          baselineDate: now,
        })
        .onConflictDoUpdate({
          target: [intentClassifierBaselines.profileId, intentClassifierBaselines.intentType],
          set: {
            accuracyPct,
            sampleCount: row.total,
            baselineDate: now,
            updatedAt: now,
          },
        });
      upserted++;
    }

    console.log(`[Regression Detector] Updated ${upserted} baselines`);
    return upserted;
  } catch (error) {
    console.error('[Regression Detector] Error updating baselines:', error);
    throw error;
  }
}

/**
 * US-159: Detect regressions by comparing current accuracy against stored baselines.
 * Creates/resolves regression_alerts records accordingly.
 * Returns number of active regressions detected.
 */
export async function detectAndPersistRegressions(
  days: number = 7,
  threshold: number = 0.05
): Promise<number> {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // Get all stored baselines
    const baselines = await db.select().from(intentClassifierBaselines);
    if (baselines.length === 0) {
      console.log('[Regression Detector] No baselines stored yet; skipping regression check');
      return 0;
    }

    // Compute current accuracy for each (profile, intent) pair
    const currentRows = await db
      .select({
        profileId: sql<string>`coalesce(${intentPredictions.profile}, 'default')`,
        intentType: intentPredictions.predictedIntent,
        total: sql<number>`count(*)::int`,
        correct: sql<number>`count(*) filter (where ${intentPredictions.wasCorrect} = true)::int`,
      })
      .from(intentPredictions)
      .where(
        and(
          gte(intentPredictions.createdAt, windowStart),
          isNotNull(intentPredictions.wasCorrect),
        )
      )
      .groupBy(
        sql`coalesce(${intentPredictions.profile}, 'default')`,
        intentPredictions.predictedIntent,
      );

    const currentMap = new Map<string, { accuracy: number; total: number }>();
    for (const row of currentRows) {
      if (!row.intentType || row.total === 0) continue;
      const key = `${row.profileId}::${row.intentType}`;
      const accuracy = Math.round((row.correct / row.total) * 10000) / 100;
      currentMap.set(key, { accuracy, total: row.total });
    }

    let activeRegressions = 0;

    for (const baseline of baselines) {
      const key = `${baseline.profileId}::${baseline.intentType}`;
      const current = currentMap.get(key);

      if (!current) continue; // No current data for this intent

      const drop = (baseline.accuracyPct - current.accuracy) / 100;
      const isRegression = drop >= threshold;

      if (isRegression) {
        // Insert a new active regression alert (avoid duplicating active alerts)
        const existing = await db
          .select({ id: regressionAlerts.id })
          .from(regressionAlerts)
          .where(
            and(
              eq(regressionAlerts.profileId, baseline.profileId),
              eq(regressionAlerts.intentType, baseline.intentType),
              eq(regressionAlerts.status, 'active'),
            )
          );

        if (existing.length === 0) {
          const accuracyDrop = Math.round(drop * 10000) / 100;
          await db.insert(regressionAlerts).values({
            profileId: baseline.profileId,
            intentType: baseline.intentType,
            baselineAccuracy: baseline.accuracyPct,
            currentAccuracy: current.accuracy,
            accuracyDrop,
            status: 'active',
            detectedAt: now,
          });
          console.warn(
            `[Regression Detector] WARN: "${baseline.intentType}" (${baseline.profileId}) dropped ` +
            `from ${baseline.accuracyPct}% to ${current.accuracy}% (${accuracyDrop}pp)`
          );
        }
        activeRegressions++;
      } else {
        // Resolve any active alerts for this intent if accuracy recovered
        await db
          .update(regressionAlerts)
          .set({ status: 'resolved', resolvedAt: now, updatedAt: now })
          .where(
            and(
              eq(regressionAlerts.profileId, baseline.profileId),
              eq(regressionAlerts.intentType, baseline.intentType),
              eq(regressionAlerts.status, 'active'),
            )
          );
      }
    }

    return activeRegressions;
  } catch (error) {
    console.error('[Regression Detector] Error detecting/persisting regressions:', error);
    throw error;
  }
}

/**
 * Start daily regression detection scheduler (US-158 AC2 + US-159)
 * Runs daily at a configurable time, logs WARN-level alerts for regressions
 */
export function startRegressionDetectionScheduler(
  cronTime: string = '0 2 * * *',
  days: number = 7,
  threshold: number = 0.05
): void {
  cron.schedule(cronTime, async () => {
    try {
      console.log('[Regression Detector] Running daily regression check...');

      // US-159: Update baselines first, then detect regressions from stored baselines
      await updateBaselines(days);
      const activeCount = await detectAndPersistRegressions(days, threshold);

      // US-158: Also run in-memory rolling-window check for backward compat
      const result = await checkRegressions(days, threshold);

      if (result.overallStatus === 'regression_detected' || activeCount > 0) {
        for (const regressionResult of result.intents) {
          if (regressionResult.status === 'regression_detected') {
            const message = `[Regression Detector] ⚠️ WARN: Intent "${regressionResult.intent}" accuracy dropped ` +
              `from ${regressionResult.previousAccuracy}% to ${regressionResult.currentAccuracy}% ` +
              `(${regressionResult.accuracyDrop}% drop)`;
            console.warn(message);
          }
        }
      } else {
        console.log('[Regression Detector] ✓ All intents healthy');
      }

      console.log(`[Regression Detector] Daily check complete. Active regressions: ${activeCount}. Timestamp: ${result.timestamp}`);
    } catch (error) {
      console.error('[Regression Detector] Error in scheduled regression check:', error);
    }
  }, {
    timezone: 'Asia/Kuala_Lumpur',
  });

  console.log(`[Regression Detector] Daily regression detection scheduled (${cronTime})`);
}
