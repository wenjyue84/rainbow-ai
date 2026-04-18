/**
 * tune-thresholds.ts — US-606 CLI
 *
 * Analyzes historical intent classifications to compute optimal per-intent
 * confidence thresholds for each profile using percentile-based method.
 *
 * Usage:
 *   npm run cli:tune-thresholds -- --profile pelangi --sample-size 1000
 *   npm run cli:tune-thresholds -- --profile pelangi --dry-run
 *   npm run cli:tune-thresholds -- --profile pelangi --percentile 90 --sample-size 500
 */

import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';

interface ThresholdStats {
  intent: string;
  sampleCount: number;
  minConfidence: number;
  maxConfidence: number;
  meanConfidence: number;
  medianConfidence: number;
  p75Confidence: number;
  p90Confidence: number;
  acceptThreshold: number; // > 0.85
  clarifyThreshold: number; // 0.60-0.85
  escalateThreshold: number; // < 0.60
  precisionAt?: number;
  recallAt?: number;
  f1At?: number;
}

interface TuningResult {
  profile: string;
  generatedAt: string;
  sampleSize: number;
  percentile: number;
  intents: ThresholdStats[];
  summary: {
    totalIntents: number;
    totalSamples: number;
  };
}

/** Parse command-line arguments */
function parseArgs() {
  const args = process.argv.slice(2);
  const profile = args[args.indexOf('--profile') + 1] || 'pelangi';
  const sampleSize = parseInt(args[args.indexOf('--sample-size') + 1] || '1000');
  const percentile = parseInt(args[args.indexOf('--percentile') + 1] || '75');
  const isDryRun = args.includes('--dry-run');

  return { profile, sampleSize, percentile, isDryRun };
}

/** Generate sample data for --dry-run mode */
function generateSampleData(sampleSize: number): Array<{ intent: string; confidence: number }> {
  const intents = [
    'booking',
    'check_in',
    'check_out',
    'room_availability',
    'pricing',
    'payment',
    'greeting',
    'fallback',
  ];

  const samples: Array<{ intent: string; confidence: number }> = [];
  for (const intent of intents) {
    // Generate samples with realistic distributions
    const samplesPerIntent = Math.floor(sampleSize / intents.length);
    for (let i = 0; i < samplesPerIntent; i++) {
      // Most intents have high confidence
      const confidence =
        intent === 'fallback'
          ? Math.random() * 0.5 // 0-0.5
          : 0.6 + Math.random() * 0.4; // 0.6-1.0

      samples.push({ intent, confidence: parseFloat(confidence.toFixed(3)) });
    }
  }

  return samples.slice(0, sampleSize);
}

/** Load classifications from database */
async function loadFromDatabase(
  profile: string,
  sampleSize: number
): Promise<Array<{ intent: string; confidence: number }>> {
  const { getDb } = await import('../lib/db.js');
  const { intentAnalytics } = await import('../../shared/schema-tables.js');
  const { desc, limit, eq } = await import('drizzle-orm');

  const db = getDb();

  // Query recent intent classifications for the profile
  const rows = await db
    .select({
      intent: intentAnalytics.intentType,
      confidence: intentAnalytics.confidence,
    })
    .from(intentAnalytics)
    .where(eq(intentAnalytics.profileId, profile))
    .orderBy(desc(intentAnalytics.createdAt))
    .limit(sampleSize);

  return rows;
}

/** Compute percentile value from sorted array */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const weight = idx % 1;

  if (lower === upper) return sorted[lower];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/** Compute threshold statistics for an intent */
function computeIntentStats(
  intentName: string,
  confidences: number[],
  basePercentile: number
): ThresholdStats {
  if (confidences.length === 0) {
    return {
      intent: intentName,
      sampleCount: 0,
      minConfidence: 0,
      maxConfidence: 0,
      meanConfidence: 0,
      medianConfidence: 0,
      p75Confidence: 0,
      p90Confidence: 0,
      acceptThreshold: 0.85,
      clarifyThreshold: 0.6,
      escalateThreshold: 0.6,
    };
  }

  const sorted = [...confidences].sort((a, b) => a - b);
  const mean = confidences.reduce((a, b) => a + b) / confidences.length;
  const median = percentile(sorted, 50);
  const p75 = percentile(sorted, 75);
  const p90 = percentile(sorted, 90);

  // Compute thresholds based on percentile
  const acceptThreshold = Math.min(1.0, percentile(sorted, basePercentile)); // Default 75th percentile
  const escalateThreshold = Math.min(0.6, percentile(sorted, 25)); // 25th percentile
  const clarifyThreshold = (escalateThreshold + acceptThreshold) / 2;

  return {
    intent: intentName,
    sampleCount: confidences.length,
    minConfidence: parseFloat(sorted[0].toFixed(3)),
    maxConfidence: parseFloat(sorted[sorted.length - 1].toFixed(3)),
    meanConfidence: parseFloat(mean.toFixed(3)),
    medianConfidence: parseFloat(median.toFixed(3)),
    p75Confidence: parseFloat(p75.toFixed(3)),
    p90Confidence: parseFloat(p90.toFixed(3)),
    acceptThreshold: parseFloat(Math.min(1.0, acceptThreshold).toFixed(3)),
    clarifyThreshold: parseFloat(clarifyThreshold.toFixed(3)),
    escalateThreshold: parseFloat(Math.max(0.0, escalateThreshold).toFixed(3)),
  };
}

async function main() {
  const { profile, sampleSize, percentile: basePercentile, isDryRun } = parseArgs();

  let samples: Array<{ intent: string; confidence: number }>;

  if (isDryRun) {
    console.error(`[tune-thresholds] --dry-run mode: generating ${sampleSize} sample records`);
    samples = generateSampleData(sampleSize);
  } else {
    console.error(`[tune-thresholds] loading ${sampleSize} classifications from database for profile: ${profile}`);
    try {
      samples = await loadFromDatabase(profile, sampleSize);
    } catch (err) {
      console.error('[tune-thresholds] database error:', err);
      process.exit(1);
    }

    if (samples.length === 0) {
      console.error('[tune-thresholds] no classifications found in database');
      process.exit(1);
    }

    console.error(`[tune-thresholds] loaded ${samples.length} records from database`);
  }

  // Group by intent
  const byIntent = new Map<string, number[]>();
  for (const sample of samples) {
    const existing = byIntent.get(sample.intent) || [];
    existing.push(sample.confidence);
    byIntent.set(sample.intent, existing);
  }

  // Compute stats per intent
  const intents = Array.from(byIntent.entries())
    .map(([intent, confidences]) => computeIntentStats(intent, confidences, basePercentile))
    .sort((a, b) => b.sampleCount - a.sampleCount); // Sort by sample count

  const result: TuningResult = {
    profile,
    generatedAt: new Date().toISOString(),
    sampleSize: samples.length,
    percentile: basePercentile,
    intents,
    summary: {
      totalIntents: intents.length,
      totalSamples: samples.length,
    },
  };

  // Output JSON
  console.log(JSON.stringify(result, null, 2));

  // Optionally write to file
  if (!isDryRun) {
    const outputPath = join(process.cwd(), `${profile}-intent-thresholds.json`);
    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.error(`[tune-thresholds] wrote thresholds to ${outputPath}`);
  }
}

main().catch((err) => {
  console.error('[tune-thresholds] error:', err);
  process.exit(1);
});
