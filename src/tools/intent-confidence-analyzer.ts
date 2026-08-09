#!/usr/bin/env tsx
/**
 * US-400: Intent Confidence Tier Analyzer
 *
 * Analyzes intent_analytics table to compute median confidence per intent type
 * per profile. Categorizes intents into confidence tiers (Low, Medium, High).
 * Identifies top 5 struggling intents requiring data augmentation.
 *
 * Acceptance Criteria:
 * 1. CLI command 'npm run analyze:intent-confidence' generates report in <5s
 * 2. Report identifies top 5 low-confidence intents sorted by frequency & confidence
 * 3. CSV export includes: profile, intent_type, sample_count, median_confidence, p25_confidence, p75_confidence
 *
 * Usage:
 *   npm run analyze:intent-confidence
 *   npm run analyze:intent-confidence -- --profile pelangi
 *   npm run analyze:intent-confidence -- --output report.csv --json
 *
 * Exit codes:
 *   0 — Analysis complete
 *   1 — Error (DB connection, invalid profile, etc.)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import fs from 'fs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Types ─────────────────────────────────────────────────────────────

interface IntentConfidenceRow {
  profile_id: string;
  intent_type: string;
  confidence: number;
}

interface ConfidenceTierMetrics {
  profile: string;
  intent_type: string;
  sample_count: number;
  median_confidence: number;
  p25_confidence: number;
  p75_confidence: number;
  tier: 'Low' | 'Medium' | 'High';
}

interface TierSummary {
  profile: string;
  low_tier_intents: ConfidenceTierMetrics[];
  medium_tier_intents: ConfidenceTierMetrics[];
  high_tier_intents: ConfidenceTierMetrics[];
  total_intents: number;
}

interface AnalysisOutput {
  timestamp: string;
  time_window: string;
  total_records_analyzed: number;
  profiles_analyzed: string[];
  summaries: TierSummary[];
  low_confidence_intents: ConfidenceTierMetrics[];
}

// ─── Percentile Calculations ──────────────────────────────────────────

/**
 * Calculate percentile value from sorted array
 */
function calculatePercentile(
  sortedValues: number[],
  percentile: number
): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;

  if (lower === upper) {
    return sortedValues[lower];
  }

  return (
    sortedValues[lower] * (1 - weight) +
    sortedValues[upper] * weight
  );
}

/**
 * Calculate median and percentile metrics
 */
function calculateMetrics(confidences: number[]): {
  median: number;
  p25: number;
  p75: number;
} {
  const sorted = [...confidences].sort((a, b) => a - b);
  return {
    median: calculatePercentile(sorted, 50),
    p25: calculatePercentile(sorted, 25),
    p75: calculatePercentile(sorted, 75),
  };
}

/**
 * Classify intent into confidence tier
 */
function getTier(confidence: number): 'Low' | 'Medium' | 'High' {
  if (confidence < 0.65) return 'Low';
  if (confidence < 0.80) return 'Medium';
  return 'High';
}

// ─── DB Query ──────────────────────────────────────────────────────────

async function fetchIntentAnalytics(
  days: number = 30
): Promise<IntentConfidenceRow[]> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
    max: 2,
    idleTimeoutMillis: 5000,
  });

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const result = await pool.query<IntentConfidenceRow>(
      `SELECT profile_id, intent_type, confidence
       FROM intent_analytics
       WHERE created_at >= $1
       ORDER BY created_at DESC`,
      [cutoff.toISOString()]
    );

    return result.rows;
  } finally {
    await pool.end();
  }
}

// ─── Analysis Logic ────────────────────────────────────────────────────

interface IntentGroup {
  confidences: number[];
  count: number;
}

function analyzeIntentConfidence(rows: IntentConfidenceRow[]): {
  metrics: ConfidenceTierMetrics[];
  byProfile: Map<string, ConfidenceTierMetrics[]>;
} {
  // Group by profile + intent_type
  const groups = new Map<string, IntentGroup>();

  for (const row of rows) {
    const key = `${row.profile_id}|${row.intent_type}`;
    if (!groups.has(key)) {
      groups.set(key, { confidences: [], count: 0 });
    }
    const group = groups.get(key)!;
    group.confidences.push(row.confidence);
    group.count += 1;
  }

  // Calculate metrics for each group
  const metrics: ConfidenceTierMetrics[] = [];
  for (const [key, group] of groups) {
    const [profile, intentType] = key.split('|');
    const { median, p25, p75 } = calculateMetrics(group.confidences);

    metrics.push({
      profile,
      intent_type: intentType,
      sample_count: group.count,
      median_confidence: Math.round(median * 10000) / 10000,
      p25_confidence: Math.round(p25 * 10000) / 10000,
      p75_confidence: Math.round(p75 * 10000) / 10000,
      tier: getTier(median),
    });
  }

  // Sort by tier (Low first), then by median confidence (ascending)
  metrics.sort((a, b) => {
    const tierOrder = { Low: 0, Medium: 1, High: 2 };
    const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return a.median_confidence - b.median_confidence;
  });

  // Group by profile
  const byProfile = new Map<string, ConfidenceTierMetrics[]>();
  for (const metric of metrics) {
    if (!byProfile.has(metric.profile)) {
      byProfile.set(metric.profile, []);
    }
    byProfile.get(metric.profile)!.push(metric);
  }

  return { metrics, byProfile };
}

// ─── Formatters ────────────────────────────────────────────────────────

function formatHumanReport(output: AnalysisOutput): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('Intent Confidence Tier Analysis Report');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(`Generated: ${output.timestamp}`);
  lines.push(`Time window: ${output.time_window}`);
  lines.push(`Total records analyzed: ${output.total_records_analyzed}`);
  lines.push(`Profiles: ${output.profiles_analyzed.join(', ')}`);
  lines.push('');

  for (const summary of output.summaries) {
    lines.push(`Profile: ${summary.profile}`);
    lines.push(`  Total intents: ${summary.total_intents}`);
    lines.push(
      `  High tier (≥80%): ${summary.high_tier_intents.length} | ` +
      `Medium tier (65-80%): ${summary.medium_tier_intents.length} | ` +
      `Low tier (<65%): ${summary.low_tier_intents.length}`
    );

    if (summary.low_tier_intents.length > 0) {
      lines.push(`  Low-confidence intents (data augmentation needed):`);
      for (const intent of summary.low_tier_intents.slice(0, 5)) {
        lines.push(
          `    • ${intent.intent_type}: ${(intent.median_confidence * 100).toFixed(1)}% ` +
          `(n=${intent.sample_count}, p25=${(intent.p25_confidence * 100).toFixed(1)}%, p75=${(intent.p75_confidence * 100).toFixed(1)}%)`
        );
      }
    }
    lines.push('');
  }

  lines.push('Top 5 Struggling Intents Across All Profiles:');
  lines.push('─────────────────────────────────────────────');
  for (const intent of output.low_confidence_intents.slice(0, 5)) {
    lines.push(
      `${intent.profile}/${intent.intent_type}: ${(intent.median_confidence * 100).toFixed(1)}% ` +
      `(n=${intent.sample_count})`
    );
  }

  return lines.join('\n');
}

function formatCsv(metrics: ConfidenceTierMetrics[]): string {
  const lines: string[] = [];
  lines.push('profile,intent_type,sample_count,median_confidence,p25_confidence,p75_confidence,tier');

  for (const metric of metrics) {
    lines.push(
      `${metric.profile},${metric.intent_type},${metric.sample_count},` +
      `${metric.median_confidence},${metric.p25_confidence},${metric.p75_confidence},${metric.tier}`
    );
  }

  return lines.join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now();
  const args = process.argv.slice(2);
  const outputFile = args.find(a => a.startsWith('--output='))?.split('=')[1];
  const jsonMode = args.includes('--json');
  const profileFilter = args.find(a => a.startsWith('--profile='))?.split('=')[1];

  let rows: IntentConfidenceRow[];
  try {
    rows = await fetchIntentAnalytics(30);
  } catch (err: any) {
    console.error(`[ERROR] Failed to query intent_analytics: ${err.message}`);
    process.exit(1);
  }

  // Filter by profile if specified
  if (profileFilter) {
    rows = rows.filter(r => r.profile_id === profileFilter);
  }

  if (rows.length === 0) {
    console.error('[ERROR] No intent analytics data found for specified criteria');
    process.exit(1);
  }

  const { metrics, byProfile } = analyzeIntentConfidence(rows);

  // Get profiles analyzed
  const profilesAnalyzed = Array.from(byProfile.keys()).sort();

  // Build summaries per profile
  const summaries: TierSummary[] = [];
  for (const profile of profilesAnalyzed) {
    const profileMetrics = byProfile.get(profile) || [];
    const lowTier = profileMetrics.filter(m => m.tier === 'Low');
    const mediumTier = profileMetrics.filter(m => m.tier === 'Medium');
    const highTier = profileMetrics.filter(m => m.tier === 'High');

    summaries.push({
      profile,
      low_tier_intents: lowTier,
      medium_tier_intents: mediumTier,
      high_tier_intents: highTier,
      total_intents: profileMetrics.length,
    });
  }

  // Get top 5 struggling intents (sorted by tier then confidence)
  const lowConfidenceIntents = metrics
    .filter(m => m.tier === 'Low')
    .sort((a, b) => {
      // Sort by frequency (sample_count) descending, then confidence ascending
      const freqDiff = b.sample_count - a.sample_count;
      if (freqDiff !== 0) return freqDiff;
      return a.median_confidence - b.median_confidence;
    });

  const output: AnalysisOutput = {
    timestamp: new Date().toISOString(),
    time_window: 'last 30 days',
    total_records_analyzed: rows.length,
    profiles_analyzed: profilesAnalyzed,
    summaries,
    low_confidence_intents: lowConfidenceIntents,
  };

  const elapsed = Date.now() - startTime;
  console.log(`[INFO] Analysis completed in ${elapsed}ms`);

  if (jsonMode) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatHumanReport(output));

    // Also output CSV if requested
    if (outputFile) {
      const csv = formatCsv(metrics);
      fs.writeFileSync(outputFile, csv, 'utf-8');
      console.log(`\n[INFO] CSV export written to: ${outputFile}`);
    }
  }

  if (elapsed > 5000) {
    console.warn(`[WARN] Analysis took ${elapsed}ms (>5s threshold)`);
  }
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
