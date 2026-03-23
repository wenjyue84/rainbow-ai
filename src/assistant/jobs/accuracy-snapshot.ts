/**
 * accuracy-snapshot.ts (US-265)
 *
 * Daily cron job that calculates intent classification accuracy per profile
 * and stores snapshots in the intent_accuracy_snapshots table.
 *
 * Alerts when accuracy drops >5% from the 30-day rolling baseline.
 *
 * Pure logic is exported for unit testing; DB interaction is injected.
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface PredictionRow {
  profile: string;
  wasCorrect: boolean;
}

export interface SnapshotRow {
  profile: string;
  date: Date;
  accuracy: number;
}

export interface AccuracySnapshot {
  profile: string;
  date: Date;
  accuracy: number;       // 0-100
  baseline: number | null; // 30-day rolling average, null if <1 prior snapshot
  sampleCount: number;
}

export interface RegressionAlert {
  profile: string;
  date: Date;
  currentAccuracy: number;
  baseline: number;
  drop: number;           // positive number = magnitude of drop
}

// ─── Pure functions (no DB dependency) ─────────────────────────────────

/**
 * Calculate per-profile accuracy from a set of prediction rows.
 * Each row has { profile, wasCorrect }.
 * Returns one AccuracySnapshot per profile (without baseline — caller fills that in).
 */
export function calculatePerProfileAccuracy(
  predictions: PredictionRow[],
  snapshotDate: Date,
): AccuracySnapshot[] {
  const byProfile = new Map<string, { correct: number; total: number }>();

  for (const p of predictions) {
    const entry = byProfile.get(p.profile) ?? { correct: 0, total: 0 };
    entry.total += 1;
    if (p.wasCorrect) entry.correct += 1;
    byProfile.set(p.profile, entry);
  }

  const results: AccuracySnapshot[] = [];
  for (const [profile, { correct, total }] of byProfile) {
    results.push({
      profile,
      date: snapshotDate,
      accuracy: total > 0 ? (correct / total) * 100 : 0,
      baseline: null,
      sampleCount: total,
    });
  }

  return results;
}

/**
 * Compute 30-day rolling baseline for a profile from prior snapshots.
 * Returns the average accuracy of the most recent `windowDays` snapshots,
 * or null if there are no prior snapshots.
 */
export function computeRollingBaseline(
  priorSnapshots: SnapshotRow[],
  windowDays: number = 30,
): number | null {
  if (priorSnapshots.length === 0) return null;

  // Sort descending by date, take up to windowDays entries
  const sorted = [...priorSnapshots]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, windowDays);

  const sum = sorted.reduce((acc, s) => acc + s.accuracy, 0);
  return sum / sorted.length;
}

/**
 * Detect regressions: accuracy dropped >threshold% from baseline.
 * Returns an array of alerts (empty if no regressions).
 */
export function detectRegressions(
  snapshots: AccuracySnapshot[],
  thresholdPct: number = 5,
): RegressionAlert[] {
  const alerts: RegressionAlert[] = [];

  for (const snap of snapshots) {
    if (snap.baseline === null) continue;
    const drop = snap.baseline - snap.accuracy;
    if (drop > thresholdPct) {
      alerts.push({
        profile: snap.profile,
        date: snap.date,
        currentAccuracy: snap.accuracy,
        baseline: snap.baseline,
        drop,
      });
    }
  }

  return alerts;
}

/**
 * Format a regression alert as a human-readable log line.
 */
export function formatAlertMessage(alert: RegressionAlert): string {
  return (
    `[AccuracyAlert] REGRESSION detected for profile "${alert.profile}": ` +
    `accuracy ${alert.currentAccuracy.toFixed(1)}% dropped ${alert.drop.toFixed(1)}pp ` +
    `below 30-day baseline ${alert.baseline.toFixed(1)}% ` +
    `(date: ${alert.date.toISOString().slice(0, 10)})`
  );
}

// ─── Orchestrator (depends on injected DB adapter) ─────────────────────

export interface AccuracySnapshotDbAdapter {
  /** Fetch predictions with was_correct IS NOT NULL for the given date range */
  fetchPredictions(startDate: Date, endDate: Date): Promise<PredictionRow[]>;
  /** Fetch prior snapshots for a profile within the rolling window */
  fetchPriorSnapshots(profile: string, beforeDate: Date, windowDays: number): Promise<SnapshotRow[]>;
  /** Upsert a snapshot row */
  upsertSnapshot(snapshot: AccuracySnapshot): Promise<void>;
  /** Log a regression alert (e.g. insert into regression_alerts table) */
  logAlert(alert: RegressionAlert): Promise<void>;
}

/**
 * Run the daily accuracy snapshot job.
 * 1. Fetch all predictions for the snapshot date
 * 2. Calculate per-profile accuracy
 * 3. Compute 30-day rolling baselines
 * 4. Store snapshots
 * 5. Detect and log regressions
 */
export async function runAccuracySnapshot(
  adapter: AccuracySnapshotDbAdapter,
  snapshotDate: Date = new Date(),
): Promise<{ snapshots: AccuracySnapshot[]; alerts: RegressionAlert[] }> {
  // Date range: start of snapshotDate to end of snapshotDate
  const startOfDay = new Date(snapshotDate);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(snapshotDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  // 1. Fetch predictions for the day
  const predictions = await adapter.fetchPredictions(startOfDay, endOfDay);

  // 2. Calculate per-profile accuracy
  const snapshots = calculatePerProfileAccuracy(predictions, startOfDay);

  // 3. Compute baselines and fill in
  for (const snap of snapshots) {
    const priorSnapshots = await adapter.fetchPriorSnapshots(snap.profile, startOfDay, 30);
    snap.baseline = computeRollingBaseline(priorSnapshots);
  }

  // 4. Store snapshots
  for (const snap of snapshots) {
    await adapter.upsertSnapshot(snap);
  }

  // 5. Detect regressions
  const alerts = detectRegressions(snapshots);

  // 6. Log alerts
  for (const alert of alerts) {
    await adapter.logAlert(alert);
    console.warn(formatAlertMessage(alert));
  }

  return { snapshots, alerts };
}
