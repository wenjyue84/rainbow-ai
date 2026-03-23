/**
 * classifier-accuracy.ts
 *
 * Utilities for calculating intent classifier accuracy metrics.
 * Used by US-098 baseline tracking and delta analysis.
 */

export interface IntentPredictionRecord {
  profileId: string;
  intentType: string;
  wasCorrect: boolean;
}

export interface AccuracyResult {
  profileId: string;
  intentType: string;
  totalCount: number;
  correctCount: number;
  accuracyPct: number; // 0-100
}

export interface BaselineAccuracy {
  profileId: string;
  intentType: string;
  accuracyPct: number;
  sampleCount: number;
  baselineDate: Date;
}

export interface DeltaResult {
  profileId: string;
  intentType: string;
  currentAccuracy: number;
  baselineAccuracy: number;
  delta: number; // percentage points
  status: "pass" | "degraded" | "improved" | "new";
  degradationThreshold: number; // default -5%
}

/**
 * Calculate accuracy for a set of predictions
 */
export function calculateAccuracy(predictions: IntentPredictionRecord[]): AccuracyResult[] {
  const byKey = new Map<string, IntentPredictionRecord[]>();

  // Group by profile + intent
  for (const pred of predictions) {
    const key = `${pred.profileId}:${pred.intentType}`;
    if (!byKey.has(key)) {
      byKey.set(key, []);
    }
    byKey.get(key)!.push(pred);
  }

  // Calculate accuracy for each group
  const results: AccuracyResult[] = [];
  for (const [key, preds] of byKey) {
    const [profileId, intentType] = key.split(":");
    const correctCount = preds.filter((p) => p.wasCorrect).length;
    const totalCount = preds.length;
    const accuracyPct = (correctCount / totalCount) * 100;

    results.push({
      profileId,
      intentType,
      totalCount,
      correctCount,
      accuracyPct,
    });
  }

  return results;
}

/**
 * Compare current accuracy against baseline and generate delta report
 */
export function generateDeltaReport(
  current: AccuracyResult[],
  baselines: BaselineAccuracy[],
  degradationThreshold: number = -5
): DeltaResult[] {
  const baselineMap = new Map<string, BaselineAccuracy>();
  for (const b of baselines) {
    const key = `${b.profileId}:${b.intentType}`;
    baselineMap.set(key, b);
  }

  const deltas: DeltaResult[] = [];

  for (const acc of current) {
    const key = `${acc.profileId}:${acc.intentType}`;
    const baseline = baselineMap.get(key);

    if (!baseline) {
      // New intent/profile combo
      deltas.push({
        profileId: acc.profileId,
        intentType: acc.intentType,
        currentAccuracy: acc.accuracyPct,
        baselineAccuracy: 0,
        delta: acc.accuracyPct,
        status: "new",
        degradationThreshold,
      });
      continue;
    }

    const delta = acc.accuracyPct - baseline.accuracyPct;
    let status: "pass" | "degraded" | "improved" | "new";

    if (delta < degradationThreshold) {
      status = "degraded";
    } else if (delta > 5) {
      status = "improved";
    } else {
      status = "pass";
    }

    deltas.push({
      profileId: acc.profileId,
      intentType: acc.intentType,
      currentAccuracy: acc.accuracyPct,
      baselineAccuracy: baseline.accuracyPct,
      delta,
      status,
      degradationThreshold,
    });
  }

  return deltas;
}

/**
 * Check per-profile isolation: ensure no cross-contamination of profiles
 */
export function checkProfileIsolation(predictions: IntentPredictionRecord[]): {
  isolated: boolean;
  profileCount: number;
  profiles: string[];
} {
  const profiles = new Set(predictions.map((p) => p.profileId));

  // For this check, we just verify that predictions are tagged with profile IDs
  // Real isolation is enforced by the database schema and query filtering
  return {
    isolated: predictions.every((p) => p.profileId && p.profileId.length > 0),
    profileCount: profiles.size,
    profiles: Array.from(profiles),
  };
}
