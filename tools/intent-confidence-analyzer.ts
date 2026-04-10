/**
 * CLI: Intent Confidence Tier Analyzer (US-400)
 *
 * Analyzes intent_analytics table to compute median confidence per intent type per profile.
 * Categorizes intents into Low (<65%), Medium (65-80%), and High (80%+) tiers.
 * Generates report identifying struggling intents that need data augmentation or retraining.
 *
 * Usage:
 * npm run analyze:intent-confidence
 *
 * Output:
 * - Console report: Top 5 low-confidence intents per profile with tier breakdowns
 * - CSV export: intent-confidence-report.csv with full statistics
 */

import pg from 'pg';
import { createWriteStream } from 'fs';
import { resolve } from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const { Pool } = pg;

interface ConfidenceStats {
  profileId: string;
  intentType: string;
  sampleCount: number;
  medianConfidence: number;
  p25Confidence: number;
  p75Confidence: number;
  tier: 'Low' | 'Medium' | 'High';
}

/**
 * Calculate percentile from sorted array
 */
function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  if (percentile <= 0) return values[0];
  if (percentile >= 100) return values[values.length - 1];

  const index = (percentile / 100) * (values.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;

  if (lower === upper) {
    return values[lower];
  }

  return values[lower] * (1 - weight) + values[upper] * weight;
}

/**
 * Determine confidence tier: Low (<65%), Medium (65-80%), High (80%+)
 */
function determineTier(medianConfidence: number): 'Low' | 'Medium' | 'High' {
  if (medianConfidence < 0.65) return 'Low';
  if (medianConfidence < 0.80) return 'Medium';
  return 'High';
}

/**
 * Fetch all intent_analytics data from last 30 days
 */
async function fetchAnalyticsData(pool: pg.Pool) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const query = `
      SELECT profile_id, intent_type, confidence, created_at
      FROM intent_analytics
      WHERE created_at >= $1
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query, [thirtyDaysAgo]);

    return result.rows.map((row: any) => ({
      profileId: row.profile_id,
      intentType: row.intent_type,
      confidence: row.confidence,
      createdAt: row.created_at,
    }));
  } catch (err: any) {
    console.error('[Error in fetchAnalyticsData]', {
      message: err.message,
      code: err.code,
      detail: err.detail,
    });
    throw err;
  }
}

/**
 * Group analytics data by profile and intent, compute percentiles
 */
function computeConfidenceStats(rows: any[]): ConfidenceStats[] {
  const grouped = new Map<string, number[]>();

  // Group by profile:intent composite key
  for (const row of rows) {
    const key = `${row.profileId}:${row.intentType}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(row.confidence);
  }

  // Compute stats for each group
  const stats: ConfidenceStats[] = [];
  for (const [key, confidences] of grouped) {
    const [profileId, intentType] = key.split(':');
    const sorted = [...confidences].sort((a, b) => a - b);

    const medianConfidence = calculatePercentile(sorted, 50);
    const p25Confidence = calculatePercentile(sorted, 25);
    const p75Confidence = calculatePercentile(sorted, 75);

    stats.push({
      profileId,
      intentType,
      sampleCount: confidences.length,
      medianConfidence,
      p25Confidence,
      p75Confidence,
      tier: determineTier(medianConfidence),
    });
  }

  return stats;
}

/**
 * Export stats as CSV
 */
async function exportCsv(stats: ConfidenceStats[], outputPath: string) {
  return new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(outputPath);
    stream.write(
      'profile,intent_type,sample_count,median_confidence,p25_confidence,p75_confidence,tier\n'
    );

    for (const stat of stats) {
      stream.write(
        `${stat.profileId},${stat.intentType},${stat.sampleCount},${stat.medianConfidence.toFixed(4)},${stat.p25Confidence.toFixed(4)},${stat.p75Confidence.toFixed(4)},${stat.tier}\n`
      );
    }

    stream.end();
    stream.on('finish', () => resolve());
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Main CLI handler
 */
async function main() {
  const startTime = Date.now();
  let pool: pg.Pool | null = null;

  try {
    // Initialize database pool
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error('ERROR: DATABASE_URL not set');
      process.exit(1);
    }

    pool = new Pool({
      connectionString: dbUrl,
      ssl: dbUrl.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
    });

    console.log('\n' + '='.repeat(70));
    console.log('Intent Confidence Tier Analyzer (US-400)');
    console.log('='.repeat(70) + '\n');

    console.log('Fetching intent_analytics data from last 30 days...');
    let rows: any[];
    try {
      rows = await fetchAnalyticsData(pool);
    } catch (err: any) {
      if (err.code === '42P01') {
        // Table doesn't exist - this is OK, just report that
        console.log('\n⚠️  Table "intent_analytics" does not exist yet.');
        console.log('   Make sure migrations have been pushed: npm run db:push');
        console.log('   Or ensure the server has been run to initialize the database.\n');
        process.exit(0);
      }
      throw err;
    }

    if (rows.length === 0) {
      console.log('No data found in intent_analytics table.');
      console.log('Ensure the system has processed intent classifications (typically after a few hours of operation).\n');
      process.exit(0);
    }

    console.log(`Found ${rows.length} confidence records.\n`);

    console.log('Computing statistics...');
    const allStats = computeConfidenceStats(rows);

    // Sort by tier, then by sample count (frequency) descending, then by median confidence ascending
    const lowConfidenceIntents = allStats
      .filter((s) => s.tier === 'Low')
      .sort((a, b) => {
        // Sort by frequency (sample count) descending, then by median confidence ascending
        if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount;
        return a.medianConfidence - b.medianConfidence;
      })
      .slice(0, 5);

    // Group by tier for console output
    const byTier = new Map<string, ConfidenceStats[]>();
    for (const stat of allStats) {
      if (!byTier.has(stat.tier)) {
        byTier.set(stat.tier, []);
      }
      byTier.get(stat.tier)!.push(stat);
    }

    // Display console report
    console.log('\n' + '─'.repeat(70));
    console.log('CONFIDENCE TIER BREAKDOWN');
    console.log('─'.repeat(70));

    for (const tier of ['High', 'Medium', 'Low'] as const) {
      const items = byTier.get(tier) || [];
      console.log(
        `\n${tier.toUpperCase()} (${
          tier === 'High' ? '≥80%' : tier === 'Medium' ? '65-80%' : '<65%'
        }): ${items.length} intents`
      );
      if (items.length > 0) {
        for (const item of items.slice(0, 3)) {
          console.log(
            `  • ${item.intentType} (${item.profileId}): ${item.medianConfidence.toFixed(1)}% median, n=${item.sampleCount}`
          );
        }
        if (items.length > 3) {
          console.log(`  ... and ${items.length - 3} more`);
        }
      }
    }

    // Display top 5 low-confidence intents needing improvement
    console.log('\n' + '─'.repeat(70));
    console.log('TOP 5 INTENTS REQUIRING DATA AUGMENTATION (LOW CONFIDENCE)');
    console.log('─'.repeat(70) + '\n');

    if (lowConfidenceIntents.length === 0) {
      console.log('✓ All intents meet minimum confidence threshold!');
    } else {
      lowConfidenceIntents.forEach((item, idx) => {
        console.log(
          `${idx + 1}. ${item.intentType} (${item.profileId})`
        );
        console.log(
          `   Median: ${item.medianConfidence.toFixed(1)}% | p25: ${item.p25Confidence.toFixed(1)}% | p75: ${item.p75Confidence.toFixed(1)}%`
        );
        console.log(
          `   Samples: ${item.sampleCount} | Recommendation: Add ${Math.ceil(item.sampleCount * 0.5)} more training examples`
        );
        console.log();
      });
    }

    // Export CSV
    const csvPath = resolve(process.cwd(), 'intent-confidence-report.csv');
    console.log(`Exporting CSV report to ${csvPath}...`);
    await exportCsv(allStats, csvPath);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
      `\n✓ Analysis complete in ${duration}s\n` +
        `  Total intents analyzed: ${allStats.length}\n` +
        `  Low-confidence intents: ${lowConfidenceIntents.length}\n` +
        `  CSV export: ${csvPath}\n`
    );

    console.log('='.repeat(70) + '\n');
  } catch (err: any) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

main();
