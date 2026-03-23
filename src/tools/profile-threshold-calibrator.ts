/**
 * US-261: Profile-Specific Intent Classification Threshold Calibrator
 *
 * Analyzes per-profile intent classification accuracy at different confidence
 * thresholds and recommends optimal settings per profile. Prevents
 * over-escalation in high-accuracy profiles like Pelangi while protecting
 * low-accuracy ones like Makan Moments.
 *
 * The core logic is pure functions that operate on log entries, making it
 * fully testable without a database connection.
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single intent classification log entry (mirrors intent_analytics table). */
export interface ClassificationLogEntry {
  profileId: string;
  intentType: string;
  confidence: number;
  wasCorrect: boolean | null;
  createdAt: Date;
}

/** Accuracy metrics at a specific threshold. */
export interface ThresholdAccuracyPoint {
  threshold: number;
  /** Classifications above this threshold that were correct / total above threshold. */
  accuracy: number;
  /** How many classifications fall above this threshold. */
  coverage: number;
  /** Proportion of total classifications above this threshold. */
  coveragePercent: number;
}

/** Per-profile calibration result. */
export interface ProfileCalibrationResult {
  profileId: string;
  totalClassifications: number;
  classifiedCorrect: number;
  classifiedIncorrect: number;
  classifiedUnknown: number;
  overallAccuracy: number;
  /** Accuracy curve at different thresholds. */
  thresholdCurve: ThresholdAccuracyPoint[];
  /** Recommended threshold for this profile. */
  recommendedThreshold: number;
  /** Human-readable reason for the recommendation. */
  reason: string;
}

/** Full calibration report. */
export interface CalibrationReport {
  timestamp: string;
  profilesAnalyzed: string[];
  results: ProfileCalibrationResult[];
  /** The per-profile threshold overrides ready to merge into settings.json. */
  settingsUpdate: Record<string, { intentClassificationThreshold: number }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default thresholds to evaluate accuracy at. */
export const EVALUATION_THRESHOLDS = [
  0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95,
];

/** Threshold mapping rules based on overall accuracy. */
export const THRESHOLD_RULES = {
  /** Profiles with >90% accuracy can use a higher threshold. */
  highAccuracyFloor: 0.90,
  highAccuracyThreshold: 0.85,
  /** Profiles with <75% accuracy should use a lower threshold. */
  lowAccuracyCeiling: 0.75,
  lowAccuracyThreshold: 0.65,
  /** Default threshold for profiles between 75%-90% accuracy. */
  defaultThreshold: 0.75,
};

/** Minimum number of classified entries (with wasCorrect != null) to produce a recommendation. */
export const MIN_ENTRIES_FOR_CALIBRATION = 10;

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Group log entries by profile.
 */
export function groupByProfile(
  entries: ClassificationLogEntry[],
): Record<string, ClassificationLogEntry[]> {
  const grouped: Record<string, ClassificationLogEntry[]> = {};
  for (const entry of entries) {
    if (!grouped[entry.profileId]) {
      grouped[entry.profileId] = [];
    }
    grouped[entry.profileId].push(entry);
  }
  return grouped;
}

/**
 * Compute accuracy at a given threshold for a set of log entries.
 * Only entries with wasCorrect != null are considered.
 */
export function computeAccuracyAtThreshold(
  entries: ClassificationLogEntry[],
  threshold: number,
): ThresholdAccuracyPoint {
  const evaluated = entries.filter(e => e.wasCorrect !== null);
  const aboveThreshold = evaluated.filter(e => e.confidence >= threshold);
  const correctAbove = aboveThreshold.filter(e => e.wasCorrect === true).length;
  const totalAbove = aboveThreshold.length;
  const totalEvaluated = evaluated.length;

  return {
    threshold,
    accuracy: totalAbove > 0 ? correctAbove / totalAbove : 0,
    coverage: totalAbove,
    coveragePercent: totalEvaluated > 0 ? totalAbove / totalEvaluated : 0,
  };
}

/**
 * Build the full threshold accuracy curve for a set of entries.
 */
export function buildThresholdCurve(
  entries: ClassificationLogEntry[],
  thresholds: number[] = EVALUATION_THRESHOLDS,
): ThresholdAccuracyPoint[] {
  return thresholds.map(t => computeAccuracyAtThreshold(entries, t));
}

/**
 * Compute overall accuracy (entries with wasCorrect=true / entries with wasCorrect != null).
 */
export function computeOverallAccuracy(entries: ClassificationLogEntry[]): number {
  const evaluated = entries.filter(e => e.wasCorrect !== null);
  if (evaluated.length === 0) return 0;
  const correct = evaluated.filter(e => e.wasCorrect === true).length;
  return correct / evaluated.length;
}

/**
 * Recommend a threshold for a profile based on its overall accuracy.
 *
 * - >90% accuracy -> 0.85 threshold (high confidence, fewer escalations)
 * - <75% accuracy -> 0.65 threshold (lower bar, accept more uncertain answers)
 * - 75%-90% accuracy -> 0.75 threshold (balanced)
 */
export function recommendThreshold(overallAccuracy: number): {
  threshold: number;
  reason: string;
} {
  if (overallAccuracy >= THRESHOLD_RULES.highAccuracyFloor) {
    return {
      threshold: THRESHOLD_RULES.highAccuracyThreshold,
      reason: `Overall accuracy ${(overallAccuracy * 100).toFixed(1)}% >= ${THRESHOLD_RULES.highAccuracyFloor * 100}% — using higher threshold ${THRESHOLD_RULES.highAccuracyThreshold} to reduce unnecessary escalations`,
    };
  }
  if (overallAccuracy < THRESHOLD_RULES.lowAccuracyCeiling) {
    return {
      threshold: THRESHOLD_RULES.lowAccuracyThreshold,
      reason: `Overall accuracy ${(overallAccuracy * 100).toFixed(1)}% < ${THRESHOLD_RULES.lowAccuracyCeiling * 100}% — using lower threshold ${THRESHOLD_RULES.lowAccuracyThreshold} to protect against misclassification`,
    };
  }
  return {
    threshold: THRESHOLD_RULES.defaultThreshold,
    reason: `Overall accuracy ${(overallAccuracy * 100).toFixed(1)}% is moderate (${THRESHOLD_RULES.lowAccuracyCeiling * 100}%-${THRESHOLD_RULES.highAccuracyFloor * 100}%) — using balanced threshold ${THRESHOLD_RULES.defaultThreshold}`,
  };
}

/**
 * Calibrate a single profile.
 */
export function calibrateProfile(
  profileId: string,
  entries: ClassificationLogEntry[],
): ProfileCalibrationResult {
  const total = entries.length;
  const evaluated = entries.filter(e => e.wasCorrect !== null);
  const correct = evaluated.filter(e => e.wasCorrect === true).length;
  const incorrect = evaluated.filter(e => e.wasCorrect === false).length;
  const unknown = entries.filter(e => e.wasCorrect === null).length;

  const overallAccuracy = computeOverallAccuracy(entries);
  const thresholdCurve = buildThresholdCurve(entries);
  const { threshold, reason } = recommendThreshold(overallAccuracy);

  let finalReason = reason;
  if (evaluated.length < MIN_ENTRIES_FOR_CALIBRATION) {
    finalReason = `Insufficient data (${evaluated.length} evaluated entries < ${MIN_ENTRIES_FOR_CALIBRATION} minimum) — using default threshold ${THRESHOLD_RULES.defaultThreshold}`;
  }

  return {
    profileId,
    totalClassifications: total,
    classifiedCorrect: correct,
    classifiedIncorrect: incorrect,
    classifiedUnknown: unknown,
    overallAccuracy,
    thresholdCurve,
    recommendedThreshold: evaluated.length < MIN_ENTRIES_FOR_CALIBRATION
      ? THRESHOLD_RULES.defaultThreshold
      : threshold,
    reason: finalReason,
  };
}

/**
 * Run calibration across all profiles in the provided log entries.
 * If filterProfile is provided, only calibrate that profile.
 */
export function calibrate(
  entries: ClassificationLogEntry[],
  filterProfile?: string,
): CalibrationReport {
  const grouped = groupByProfile(entries);
  const profilesToAnalyze = filterProfile
    ? [filterProfile]
    : Object.keys(grouped).sort();

  const results: ProfileCalibrationResult[] = [];
  for (const profileId of profilesToAnalyze) {
    const profileEntries = grouped[profileId] || [];
    results.push(calibrateProfile(profileId, profileEntries));
  }

  const settingsUpdate: Record<string, { intentClassificationThreshold: number }> = {};
  for (const result of results) {
    settingsUpdate[result.profileId] = {
      intentClassificationThreshold: result.recommendedThreshold,
    };
  }

  return {
    timestamp: new Date().toISOString(),
    profilesAnalyzed: profilesToAnalyze,
    results,
    settingsUpdate,
  };
}

// ---------------------------------------------------------------------------
// Settings file update
// ---------------------------------------------------------------------------

/**
 * Read settings.json, merge per-profile threshold overrides, and write back.
 */
export function updateSettingsFile(
  settingsPath: string,
  settingsUpdate: Record<string, { intentClassificationThreshold: number }>,
): { updated: boolean; profilesUpdated: string[] } {
  if (!fs.existsSync(settingsPath)) {
    return { updated: false, profilesUpdated: [] };
  }

  const raw = fs.readFileSync(settingsPath, 'utf-8');
  const settings = JSON.parse(raw);

  // Ensure profiles key exists at root level
  if (!settings.profiles) {
    settings.profiles = {};
  }

  const profilesUpdated: string[] = [];
  for (const [profileId, overrides] of Object.entries(settingsUpdate)) {
    if (!settings.profiles[profileId]) {
      settings.profiles[profileId] = {};
    }
    settings.profiles[profileId].intentClassificationThreshold =
      overrides.intentClassificationThreshold;
    profilesUpdated.push(profileId);
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

  return { updated: true, profilesUpdated };
}

// ---------------------------------------------------------------------------
// Human-readable formatting
// ---------------------------------------------------------------------------

export function formatReport(report: CalibrationReport): string {
  const lines: string[] = [];

  lines.push('=== Profile-Specific Intent Classification Threshold Calibrator ===');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push(`Profiles analyzed: ${report.profilesAnalyzed.join(', ')}`);
  lines.push('');

  for (const result of report.results) {
    lines.push(`--- ${result.profileId} ---`);
    lines.push(`  Total classifications: ${result.totalClassifications}`);
    lines.push(`  Correct: ${result.classifiedCorrect}`);
    lines.push(`  Incorrect: ${result.classifiedIncorrect}`);
    lines.push(`  Unknown (not evaluated): ${result.classifiedUnknown}`);
    lines.push(`  Overall accuracy: ${(result.overallAccuracy * 100).toFixed(1)}%`);
    lines.push('');

    lines.push('  Threshold curve:');
    lines.push('    Threshold | Accuracy | Coverage | Coverage%');
    for (const point of result.thresholdCurve) {
      lines.push(
        `    ${point.threshold.toFixed(2)}     | ` +
        `${(point.accuracy * 100).toFixed(1).padStart(5)}%  | ` +
        `${String(point.coverage).padStart(5)}    | ` +
        `${(point.coveragePercent * 100).toFixed(1).padStart(5)}%`,
      );
    }
    lines.push('');

    lines.push(`  >> Recommended threshold: ${result.recommendedThreshold}`);
    lines.push(`     Reason: ${result.reason}`);
    lines.push('');
  }

  lines.push('--- Settings Update ---');
  lines.push('  The following will be written to settings.json under "profiles":');
  lines.push(JSON.stringify(report.settingsUpdate, null, 4).split('\n').map(l => '  ' + l).join('\n'));

  return lines.join('\n');
}
