/**
 * profile-intent-drift.ts — Intent Classification Per-Profile Baseline Drift Detector
 *
 * Detects profile-specific model drift by tracking F1 score baselines
 * for intent classification and alerting on >5% drops from historical baseline.
 */

import { db } from '../lib/db.js';
import { intentClassificationDecisions } from '../../shared/index.js';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';

export interface DriftDetectionReport {
  profile_id: string;
  baseline_f1: number | null;
  current_f1: number;
  percent_change: number | null;
  alert_triggered: boolean;
  messages_analyzed_count: number;
  recommended_action: string;
}

/**
 * Calculate F1 score from classification results
 * F1 = 2 * (Precision * Recall) / (Precision + Recall)
 */
function calculateF1(
  classifications: Array<{ classifiedIntent: string; actualIntent: string | null }>
): number {
  if (classifications.length === 0) return 0;

  const intentMetrics = new Map<
    string,
    { tp: number; fp: number; fn: number }
  >();

  // Calculate TP, FP, FN per intent
  for (const { classifiedIntent, actualIntent } of classifications) {
    if (!intentMetrics.has(classifiedIntent)) {
      intentMetrics.set(classifiedIntent, { tp: 0, fp: 0, fn: 0 });
    }

    const metrics = intentMetrics.get(classifiedIntent)!;
    if (classifiedIntent === actualIntent) {
      metrics.tp++;
    } else {
      metrics.fp++;
    }
  }

  // Count FN for each actual intent
  for (const { actualIntent } of classifications) {
    if (actualIntent && !intentMetrics.has(actualIntent)) {
      intentMetrics.set(actualIntent, { tp: 0, fp: 0, fn: 0 });
    }
    if (actualIntent && actualIntent !== '') {
      const metrics = intentMetrics.get(actualIntent)!;
      const wasCorrect = classifications.some(
        (c) => c.classifiedIntent === actualIntent && c.actualIntent === actualIntent
      );
      if (!wasCorrect) {
        metrics.fn++;
      }
    }
  }

  // Calculate macro-average F1 across all intents
  let totalF1 = 0;
  let intentCount = 0;

  for (const { tp, fp, fn } of intentMetrics.values()) {
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    totalF1 += f1;
    intentCount++;
  }

  return intentCount > 0 ? totalF1 / intentCount : 0;
}

/**
 * Get baseline F1 score for a profile from database
 */
async function getBaselineF1(
  profileId: string,
  pool: Pool | typeof db
): Promise<number | null> {
  try {
    // Use raw query to get baseline
    const query = `
      SELECT f1_score FROM rainbow_intent_baselines
      WHERE profile_id = $1
      LIMIT 1
    `;

    const result = await (pool as Pool).query(query, [profileId]);
    if (result.rows.length > 0) {
      return result.rows[0].f1_score;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Compute and store baseline F1 from last 100 messages
 */
async function computeAndStoreBaseline(
  profileId: string,
  pool: Pool | typeof db
): Promise<number> {
  try {
    // Get last 100 messages for this profile ordered by timestamp descending
    const query = `
      SELECT classified_intent, actual_intent
      FROM intent_classification_decisions
      WHERE profile_name = $1
      ORDER BY timestamp DESC
      LIMIT 100
    `;

    const result = await (pool as Pool).query(query, [profileId]);
    const classifications = result.rows.map((row: any) => ({
      classifiedIntent: row.classified_intent,
      actualIntent: row.actual_intent,
    }));

    const f1Score = calculateF1(classifications);
    const messageCount = classifications.length;

    // Store or update baseline
    const upsertQuery = `
      INSERT INTO rainbow_intent_baselines (profile_id, f1_score, message_count, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (profile_id) DO UPDATE
      SET f1_score = $2, message_count = $3, updated_at = CURRENT_TIMESTAMP
    `;

    await (pool as Pool).query(upsertQuery, [profileId, f1Score, messageCount]);

    return f1Score;
  } catch {
    return 0;
  }
}

/**
 * Detect intent classification drift for a profile
 */
export async function detectIntentDrift(
  profileId: string,
  threshold: number = 0.05,
  pool?: Pool | typeof db
): Promise<DriftDetectionReport> {
  const queryPool = pool || (db as unknown as Pool);

  // Get last 100 messages for current F1 calculation
  const query = `
    SELECT classified_intent, actual_intent
    FROM intent_classification_decisions
    WHERE profile_name = $1
    ORDER BY timestamp DESC
    LIMIT 100
  `;

  const result = await (queryPool as Pool).query(query, [profileId]);
  const classifications = result.rows.map((row: any) => ({
    classifiedIntent: row.classified_intent,
    actualIntent: row.actual_intent,
  }));

  const currentF1 = calculateF1(classifications);
  const messagesAnalyzed = classifications.length;

  // Get baseline
  let baselineF1 = await getBaselineF1(profileId, queryPool);

  // If no baseline exists, compute and store one
  if (baselineF1 === null) {
    baselineF1 = await computeAndStoreBaseline(profileId, queryPool);
  }

  // Calculate percent change
  let percentChange: number | null = null;
  let alertTriggered = false;

  if (baselineF1 !== null && baselineF1 > 0) {
    percentChange = (currentF1 - baselineF1) / baselineF1;
    alertTriggered = currentF1 < baselineF1 * (1 - threshold);
  }

  const recommendedAction = alertTriggered
    ? `Audit profile data files (routing.json, intent-keywords.json) for cross-profile contamination. See: npm run check:contamination -- --profile ${profileId}`
    : 'No action required';

  return {
    profile_id: profileId,
    baseline_f1: baselineF1,
    current_f1: currentF1,
    percent_change: percentChange,
    alert_triggered: alertTriggered,
    messages_analyzed_count: messagesAnalyzed,
    recommended_action: recommendedAction,
  };
}

/**
 * CLI entry point for drift detection
 */
export async function runDriftDetectionCLI(): Promise<void> {
  const args = process.argv.slice(2);
  let profile = 'pelangi';
  let threshold = 0.05;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && i + 1 < args.length) {
      profile = args[i + 1];
      i++;
    } else if (args[i] === '--threshold' && i + 1 < args.length) {
      threshold = parseFloat(args[i + 1]);
      i++;
    }
  }

  try {
    const report = await detectIntentDrift(profile, threshold);
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.alert_triggered ? 1 : 0);
  } catch (error) {
    console.error('Error detecting drift:', error);
    process.exit(1);
  }
}
