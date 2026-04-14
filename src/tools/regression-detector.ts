/**
 * regression-detector.ts — Intent Classification Performance Regression Analysis
 *
 * Compares current 7-day accuracy window against previous 7-day baseline.
 * Detects per-intent regressions and flags when accuracy drops > 2%.
 */

import { IntentAccuracyData } from '../lib/analytics.js';

export interface RegressionAnalysis {
  profileId: string;
  accuracyCurrent: number; // overall accuracy for current period
  accuracyBaseline: number; // overall accuracy for baseline period
  regressionPct: number; // percentage point change (current - baseline)
  hasRegression: boolean; // true if regression > 2%
  flaggedIntents: FlaggedIntent[];
  perIntentBreakdown: PerIntentResult[];
}

export interface FlaggedIntent {
  intentType: string;
  baselineAccuracy: number;
  currentAccuracy: number;
  delta: number; // percentage point change
}

export interface PerIntentResult {
  intentType: string;
  baselineAccuracy: number;
  currentAccuracy: number;
  delta: number;
  isFlagged: boolean;
}

const REGRESSION_THRESHOLD = 2; // 2 percentage points

/**
 * Calculate regression by comparing current accuracy to baseline accuracy.
 *
 * @param profile Profile ID for context
 * @param currentData Accuracy data from current period (7-day window)
 * @param baselineData Accuracy data from baseline period (previous 7-day window)
 * @returns RegressionAnalysis with per-intent breakdown and flagged intents
 */
export function calculateRegression(
  profile: string,
  currentData: IntentAccuracyData[],
  baselineData: IntentAccuracyData[]
): RegressionAnalysis {
  // Build lookup maps for easy comparison
  const baselineMap = new Map<string, IntentAccuracyData>();
  for (const item of baselineData) {
    baselineMap.set(item.intentType, item);
  }

  // Calculate overall accuracy for each period
  let currentTotalCount = 0;
  let currentCorrectCount = 0;
  for (const item of currentData) {
    currentTotalCount += item.totalCount;
    currentCorrectCount += item.correctCount;
  }
  const accuracyCurrent = currentTotalCount > 0 ? (currentCorrectCount / currentTotalCount) * 100 : 0;

  let baselineTotalCount = 0;
  let baselineCorrectCount = 0;
  for (const item of baselineData) {
    baselineTotalCount += item.totalCount;
    baselineCorrectCount += item.correctCount;
  }
  const accuracyBaseline = baselineTotalCount > 0 ? (baselineCorrectCount / baselineTotalCount) * 100 : 0;

  const regressionPct = accuracyCurrent - accuracyBaseline;
  const hasRegression = regressionPct < -REGRESSION_THRESHOLD;

  // Analyze per-intent regressions
  const flaggedIntents: FlaggedIntent[] = [];
  const perIntentBreakdown: PerIntentResult[] = [];

  for (const current of currentData) {
    const baseline = baselineMap.get(current.intentType);
    const baselineAccuracy = baseline?.accuracyPct ?? 0;
    const delta = current.accuracyPct - baselineAccuracy;
    const isFlagged = delta < -REGRESSION_THRESHOLD;

    if (isFlagged) {
      flaggedIntents.push({
        intentType: current.intentType,
        baselineAccuracy: baselineAccuracy,
        currentAccuracy: current.accuracyPct,
        delta: delta,
      });
    }

    perIntentBreakdown.push({
      intentType: current.intentType,
      baselineAccuracy: baselineAccuracy,
      currentAccuracy: current.accuracyPct,
      delta: delta,
      isFlagged: isFlagged,
    });
  }

  // Also include intents in baseline but not in current (completely missing now)
  for (const baseline of baselineData) {
    if (!currentData.some(c => c.intentType === baseline.intentType)) {
      const delta = 0 - baseline.accuracyPct;
      flaggedIntents.push({
        intentType: baseline.intentType,
        baselineAccuracy: baseline.accuracyPct,
        currentAccuracy: 0,
        delta: delta,
      });

      perIntentBreakdown.push({
        intentType: baseline.intentType,
        baselineAccuracy: baseline.accuracyPct,
        currentAccuracy: 0,
        delta: delta,
        isFlagged: true,
      });
    }
  }

  return {
    profileId: profile,
    accuracyCurrent,
    accuracyBaseline,
    regressionPct,
    hasRegression,
    flaggedIntents,
    perIntentBreakdown,
  };
}
