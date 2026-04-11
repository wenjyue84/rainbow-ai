/**
 * intent-confidence-variance.ts — Intent Classification Confidence Variance Calculator
 *
 * Computes statistical measures (variance, standard deviation, coefficient of variation)
 * for intent classification confidence scores to identify unreliable classifications.
 * High variance indicates inconsistent classifications that suggest keyword refinement.
 *
 * Usage:
 *   const stats = await calculateIntentVariance(db, { minSamples: 50 });
 *   const unstable = flagUnstableIntents(stats, { cvThreshold: 0.15 });
 */

import { db } from './db.js';
import { rainbowMessages } from '../../shared/schema.js';
import { sql, and, isNotNull, gte } from 'drizzle-orm';

export interface IntentVarianceStats {
  intent: string;
  sampleCount: number;
  minConfidence: number;
  maxConfidence: number;
  meanConfidence: number;
  variance: number;
  stdDeviation: number;
  coefficientOfVariation: number; // CV = stdDev / mean; dimensionless ratio
  isUnstable: boolean;
}

export interface VarianceCalculationOptions {
  minSamples?: number;
  profileId?: string;
  sinceDays?: number;
}

export interface VarianceReport {
  timestamp: string;
  totalIntents: number;
  intentsAnalyzed: number;
  minSamplesThreshold: number;
  unstableIntentsCount: number;
  cvThreshold: number;
  intents: IntentVarianceStats[];
}

/**
 * Calculate variance statistics for all intents in the message history.
 * Filters by minimum sample count (default 50) and optional profile/time window.
 *
 * Returns a report sorted by coefficient of variation (high to low).
 */
export async function calculateIntentVariance(
  options: VarianceCalculationOptions = {},
): Promise<VarianceReport> {
  const minSamples = options.minSamples ?? 50;
  const profileId = options.profileId;
  const sinceDays = options.sinceDays ?? 90;

  // Build time filter
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);

  // Query: GROUP BY intent, compute stats from confidence scores
  const rawResults = await db
    .select({
      intent: rainbowMessages.intent,
      count: sql<number>`count(*)::int`,
      min: sql<number>`min(confidence)::float`,
      max: sql<number>`max(confidence)::float`,
      mean: sql<number>`avg(confidence)::float`,
      variance: sql<number>`variance(confidence)::float`, // Population variance in PostgreSQL
      stddev: sql<number>`stddev_pop(confidence)::float`, // Population standard deviation
    })
    .from(rainbowMessages)
    .where(
      and(
        isNotNull(rainbowMessages.intent),
        isNotNull(rainbowMessages.confidence),
        gte(rainbowMessages.timestamp, since),
        profileId ? sql`profile_id = ${profileId}` : sql`true`,
      ),
    )
    .groupBy(rainbowMessages.intent)
    .orderBy(sql`variance desc nulls last`);

  // Filter by minimum samples and compute coefficient of variation
  const stats: IntentVarianceStats[] = rawResults
    .filter((r) => r.count >= minSamples && r.variance !== null && r.stddev !== null)
    .map((r) => {
      const mean = r.mean ?? 0;
      const cv = mean > 0 ? r.stddev! / mean : 0;
      const isUnstable = cv > 0.15; // CV threshold per PRD

      return {
        intent: r.intent!,
        sampleCount: r.count,
        minConfidence: r.min ?? 0,
        maxConfidence: r.max ?? 1,
        meanConfidence: mean,
        variance: r.variance!,
        stdDeviation: r.stddev!,
        coefficientOfVariation: cv,
        isUnstable,
      };
    });

  // Compute summary metrics
  const totalIntents = rawResults.length;
  const intentsAnalyzed = stats.length;
  const unstableIntentsCount = stats.filter((s) => s.isUnstable).length;

  return {
    timestamp: new Date().toISOString(),
    totalIntents,
    intentsAnalyzed,
    minSamplesThreshold: minSamples,
    unstableIntentsCount,
    cvThreshold: 0.15,
    intents: stats.sort((a, b) => b.coefficientOfVariation - a.coefficientOfVariation),
  };
}

/**
 * Flag intents with high variance (CV > threshold) for retraining.
 * Used for identifying unreliable classification targets.
 */
export function flagUnstableIntents(
  stats: IntentVarianceStats[],
  options: { cvThreshold?: number } = {},
): IntentVarianceStats[] {
  const threshold = options.cvThreshold ?? 0.15;
  return stats.filter((s) => s.coefficientOfVariation > threshold);
}

/**
 * Format variance stats as CSV for export.
 * Columns: intent, sample_count, mean, variance, stddev, cv, is_unstable
 */
export function formatVarianceAsCSV(stats: IntentVarianceStats[]): string {
  const header = [
    'intent',
    'sample_count',
    'min_confidence',
    'max_confidence',
    'mean_confidence',
    'variance',
    'stddev',
    'coefficient_of_variation',
    'is_unstable',
  ].join(',');

  const rows = stats.map((s) =>
    [
      `"${s.intent}"`,
      s.sampleCount,
      s.minConfidence.toFixed(4),
      s.maxConfidence.toFixed(4),
      s.meanConfidence.toFixed(4),
      s.variance.toFixed(6),
      s.stdDeviation.toFixed(6),
      s.coefficientOfVariation.toFixed(6),
      s.isUnstable ? 'yes' : 'no',
    ].join(','),
  );

  return [header, ...rows].join('\n');
}

/**
 * Format variance report as human-readable text.
 */
export function formatVarianceReport(report: VarianceReport): string {
  const lines: string[] = [];

  lines.push('=== Intent Classification Confidence Variance Report ===');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push('');
  lines.push(`Total intents in history: ${report.totalIntents}`);
  lines.push(`Intents analyzed (min ${report.minSamplesThreshold} samples): ${report.intentsAnalyzed}`);
  lines.push(`Unstable intents (CV > ${report.cvThreshold}): ${report.unstableIntentsCount}`);
  lines.push('');

  if (report.intentsAnalyzed === 0) {
    lines.push('No intents with sufficient samples for analysis.');
    return lines.join('\n');
  }

  // Show all intents sorted by CV (high to low)
  const unstable = report.intents.filter((s) => s.isUnstable);
  if (unstable.length > 0) {
    lines.push('--- UNSTABLE Intents (requiring keyword refinement) ---');
    for (const s of unstable) {
      lines.push(
        `  ${s.intent.padEnd(25)} [CV: ${s.coefficientOfVariation.toFixed(4)}] ` +
          `n=${s.sampleCount} mean=${s.meanConfidence.toFixed(3)} ` +
          `σ=${s.stdDeviation.toFixed(4)}`,
      );
    }
    lines.push('');
  }

  // Show stable intents (limited to top 20 by CV for readability)
  const stable = report.intents.filter((s) => !s.isUnstable);
  if (stable.length > 0) {
    const shown = stable.slice(0, 20);
    lines.push(`--- STABLE Intents (showing ${shown.length}/${stable.length}) ---`);
    for (const s of shown) {
      lines.push(
        `  ${s.intent.padEnd(25)} [CV: ${s.coefficientOfVariation.toFixed(4)}] ` +
          `n=${s.sampleCount} mean=${s.meanConfidence.toFixed(3)} ` +
          `σ=${s.stdDeviation.toFixed(4)}`,
      );
    }
    lines.push('');
  }

  // Stability score (inverse of % unstable)
  const stabilityScore = report.intentsAnalyzed > 0
    ? ((1 - unstable.length / report.intentsAnalyzed) * 100).toFixed(1)
    : '100.0';
  lines.push(`Overall intent stability: ${stabilityScore}%`);

  return lines.join('\n');
}
