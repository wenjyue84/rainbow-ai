/**
 * model-rollback-controller.ts — Intent classification accuracy monitoring and auto-rollback
 *
 * Tracks classification accuracy over time and automatically rolls back to the previous
 * model version if accuracy drops >5% below the baseline threshold.
 */

import { db } from '../../lib/db.js';
import { modelAccuracyHistory } from '../../../shared/schema-tables.js';
import type { InsertModelAccuracyRecord } from '../../../shared/schema-tables.js';
import { desc, sql } from 'drizzle-orm';

// ─── Constants ────────────────────────────────────────────────────────────

const ACCURACY_DROP_THRESHOLD = 0.05; // 5% drop triggers rollback
const DEFAULT_BASELINE_ACCURACY = 0.85; // 85% baseline if not configured

// ─── Types ───────────────────────────────────────────────────────────────

export interface ModelAccuracyMetrics {
  profileId: string;
  modelVersion: string;
  accuracyScore: number;
  messagesTested: number;
}

export interface RollbackStatus {
  currentModelVersion: string;
  baselineAccuracy: number;
  currentAccuracy: number | null;
  lastAccuracyCheckAt: Date | null;
  rollbackTriggered: boolean;
  rollbackHistory: Array<{
    timestamp: Date;
    fromVersion: string;
    toVersion: string;
    reason: string;
  }>;
}

// ─── Model Rollback Controller ───────────────────────────────────────────

/**
 * Records a classification accuracy measurement.
 * Automatically triggers rollback if accuracy drops >5% below baseline.
 */
export async function recordAccuracyMetric(
  metrics: ModelAccuracyMetrics,
  baselineAccuracy?: number
): Promise<void> {
  try {
    const baseline = baselineAccuracy || DEFAULT_BASELINE_ACCURACY;
    const accuracyDropThreshold = baseline - ACCURACY_DROP_THRESHOLD;

    // Store the metric in database
    await db.insert(modelAccuracyHistory).values({
      profileId: metrics.profileId,
      modelVersion: metrics.modelVersion,
      accuracyScore: metrics.accuracyScore,
      messagesTested: metrics.messagesTested,
    });

    // Check if rollback should be triggered
    if (metrics.accuracyScore < accuracyDropThreshold) {
      await triggerModelRollback(
        metrics.profileId,
        metrics.modelVersion,
        metrics.accuracyScore,
        baseline
      );
    }
  } catch (error) {
    console.error('[ModelRollback] Error recording accuracy metric:', error);
  }
}

/**
 * Triggers automatic rollback to the previous model version.
 * Sets ACTIVE_MODEL_VERSION env var and logs the rollback event.
 */
async function triggerModelRollback(
  profileId: string,
  currentVersion: string,
  currentAccuracy: number,
  baseline: number
): Promise<void> {
  try {
    const previousVersion = await getPreviousModelVersion(currentVersion);
    if (!previousVersion) {
      console.warn(
        `[ModelRollback] No previous model version found for rollback. Current: ${currentVersion}`
      );
      return;
    }

    // Update environment variable
    process.env.ACTIVE_MODEL_VERSION = previousVersion;

    // Log rollback event
    console.error(
      `[ModelRollback] ROLLBACK TRIGGERED for ${profileId}:
      - From version: ${currentVersion} (accuracy: ${(currentAccuracy * 100).toFixed(2)}%)
      - To version: ${previousVersion}
      - Baseline: ${(baseline * 100).toFixed(2)}%
      - Drop threshold: ${(ACCURACY_DROP_THRESHOLD * 100).toFixed(1)}%`
    );

    // Store rollback event (if audit table is available)
    await storeRollbackEvent(profileId, currentVersion, previousVersion);
  } catch (error) {
    console.error('[ModelRollback] Error triggering rollback:', error);
  }
}

/**
 * Gets the previous model version from accuracy history.
 * Returns the most recent version before the current one.
 */
async function getPreviousModelVersion(currentVersion: string): Promise<string | null> {
  try {
    // Query the database for models different from current
    const result = await (db as any)
      .select({ modelVersion: modelAccuracyHistory.modelVersion })
      .from(modelAccuracyHistory)
      .where(sql`${modelAccuracyHistory.modelVersion} != ${currentVersion}`)
      .orderBy(desc(modelAccuracyHistory.timestamp))
      .limit(1);

    return result[0]?.modelVersion || null;
  } catch (error) {
    console.error('[ModelRollback] Error getting previous version:', error);
    return null;
  }
}

/**
 * Stores a rollback event for audit purposes.
 * Currently logs to console; can be extended to store in database.
 */
async function storeRollbackEvent(
  profileId: string,
  fromVersion: string,
  toVersion: string
): Promise<void> {
  try {
    // Log the event for audit trail
    console.info(
      `[ModelRollback] AUDIT: Rollback event recorded - Profile: ${profileId}, From: ${fromVersion}, To: ${toVersion}`
    );
  } catch (error) {
    console.error('[ModelRollback] Error storing rollback event:', error);
  }
}

/**
 * Gets the current rollback status for a profile.
 */
export async function getRollbackStatus(profileId: string): Promise<RollbackStatus> {
  try {
    const currentModelVersion =
      process.env.ACTIVE_MODEL_VERSION || process.env.MODEL_VERSION || 'default';

    // Get latest accuracy metric for this profile using Drizzle ORM
    const latestResults = await (db as any)
      .select({
        accuracyScore: modelAccuracyHistory.accuracyScore,
        timestamp: modelAccuracyHistory.timestamp,
      })
      .from(modelAccuracyHistory)
      .where(sql`${modelAccuracyHistory.profileId} = ${profileId}`)
      .orderBy(desc(modelAccuracyHistory.timestamp))
      .limit(1);

    const currentRecord = latestResults[0];

    // For now, rollback history is logged to console/audit trail
    // Can be extended to query a separate audit table
    const rollbackHistory: Array<{
      timestamp: Date;
      fromVersion: string;
      toVersion: string;
      reason: string;
    }> = [];

    return {
      currentModelVersion,
      baselineAccuracy: DEFAULT_BASELINE_ACCURACY,
      currentAccuracy: currentRecord?.accuracyScore || null,
      lastAccuracyCheckAt: currentRecord?.timestamp ? new Date(currentRecord.timestamp) : null,
      rollbackTriggered: false, // Set to true when rollback actually triggered
      rollbackHistory,
    };
  } catch (error) {
    console.error('[ModelRollback] Error getting rollback status:', error);
    return {
      currentModelVersion: process.env.ACTIVE_MODEL_VERSION || 'unknown',
      baselineAccuracy: DEFAULT_BASELINE_ACCURACY,
      currentAccuracy: null,
      lastAccuracyCheckAt: null,
      rollbackTriggered: false,
      rollbackHistory: [],
    };
  }
}

/**
 * Gets model accuracy history for a given time window.
 */
export async function getAccuracyHistory(
  profileId: string,
  hoursBack: number = 24
): Promise<ModelAccuracyMetrics[]> {
  try {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const results = await (db as any)
      .select({
        profileId: modelAccuracyHistory.profileId,
        modelVersion: modelAccuracyHistory.modelVersion,
        accuracyScore: modelAccuracyHistory.accuracyScore,
        messagesTested: modelAccuracyHistory.messagesTested,
      })
      .from(modelAccuracyHistory)
      .where(
        sql`${modelAccuracyHistory.profileId} = ${profileId} AND ${modelAccuracyHistory.timestamp} >= ${cutoffTime}`
      )
      .orderBy(desc(modelAccuracyHistory.timestamp));

    return results || [];
  } catch (error) {
    console.error('[ModelRollback] Error getting accuracy history:', error);
    return [];
  }
}
