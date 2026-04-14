#!/usr/bin/env tsx
/**
 * US-599: Intent Classification Confidence Score Distribution Histogram CLI Tool
 *
 * Analyzes classification confidence score distribution per intent type and profile
 * over a time window. Generates histogram with confidence buckets (0-20%, 20-40%, etc.)
 * and exports to CSV for identifying low-confidence intent patterns.
 *
 * Usage:
 *   npm run analytics:confidence-histogram --profile pelangi --days 7
 *   npm run analytics:confidence-histogram --profile pelangi --days 7 --format=csv
 *   npm run analytics:confidence-histogram --profile pelangi --days 30 --json
 *
 * Exit codes:
 *   0 — Histogram generated successfully
 *   1 — Error (DB connection, invalid parameters, etc.)
 */

import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Types ───────────────────────────────────────────────────────────────

interface CLIOptions {
  profile: string;
  days: number;
  format: 'text' | 'csv' | 'json';
  output?: string;
}

interface ConfidenceScore {
  intent_type: string;
  confidence: number;
  created_at: Date;
}

interface HistogramBucket {
  min: number;
  max: number;
  count: number;
}

interface IntentHistogram {
  intent: string;
  totalMessages: number;
  buckets: HistogramBucket[];
  highConf: number;        // 0.8-1.0
  mediumConf: number;      // 0.5-0.8
  lowConf: number;         // <0.5
  highConfPct: number;
  mediumConfPct: number;
  lowConfPct: number;
}

interface HistogramReport {
  profile: string;
  period: string;
  generatedAt: string;
  intents: IntentHistogram[];
  summary: {
    totalMessages: number;
    intentsAnalyzed: number;
  };
}

// ─── Parse CLI Arguments ──────────────────────────────────────────────────

function parseCliArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    profile: 'pelangi',
    days: 7,
    format: 'text',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--profile' && i + 1 < args.length) {
      options.profile = args[++i];
    } else if (arg === '--days' && i + 1 < args.length) {
      options.days = parseInt(args[++i], 10);
      if (isNaN(options.days) || options.days < 1) {
        throw new Error('Invalid --days value: must be a positive integer');
      }
    } else if (arg === '--format' && i + 1 < args.length) {
      const format = args[++i];
      if (!['text', 'csv', 'json'].includes(format)) {
        throw new Error(`Invalid --format: ${format}. Must be one of: text, csv, json`);
      }
      options.format = format as 'text' | 'csv' | 'json';
    } else if (arg.startsWith('--format=')) {
      const format = arg.split('=')[1];
      if (!['text', 'csv', 'json'].includes(format)) {
        throw new Error(`Invalid --format: ${format}. Must be one of: text, csv, json`);
      }
      options.format = format as 'text' | 'csv' | 'json';
    } else if (arg === '--output' && i + 1 < args.length) {
      options.output = args[++i];
    }
  }

  return options;
}

// ─── Database Connection ──────────────────────────────────────────────────

async function getDatabase(): Promise<pg.Pool> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
  });

  // Test connection
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    throw error;
  }

  return pool;
}

// ─── Query Confidence Scores ──────────────────────────────────────────────

async function queryConfidenceScores(
  pool: pg.Pool,
  profile: string,
  days: number
): Promise<ConfidenceScore[]> {
  try {
    const query = `
      SELECT
        intent_type,
        confidence,
        created_at
      FROM intent_analytics
      WHERE profile_id = $1
        AND created_at >= NOW() - INTERVAL '1 day' * $2
      ORDER BY intent_type, confidence DESC
    `;

    const result = await pool.query(query, [profile, days]);
    return result.rows as ConfidenceScore[];
  } catch (error) {
    console.error('Failed to query confidence scores:', error);
    throw error;
  }
}

// ─── Generate Histogram ───────────────────────────────────────────────────

function generateHistogram(scores: ConfidenceScore[]): IntentHistogram[] {
  // Group by intent
  const groupedByIntent = new Map<string, number[]>();

  for (const score of scores) {
    if (!groupedByIntent.has(score.intent_type)) {
      groupedByIntent.set(score.intent_type, []);
    }
    groupedByIntent.get(score.intent_type)!.push(score.confidence);
  }

  // Generate histogram per intent
  const bucketBoundaries = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  const histograms: IntentHistogram[] = [];

  for (const [intent, confidences] of groupedByIntent.entries()) {
    const buckets: HistogramBucket[] = [];

    // Initialize buckets
    for (let i = 0; i < bucketBoundaries.length - 1; i++) {
      buckets.push({
        min: bucketBoundaries[i],
        max: bucketBoundaries[i + 1],
        count: 0,
      });
    }

    // Count confidences in each bucket
    for (const conf of confidences) {
      for (const bucket of buckets) {
        // Check if confidence falls into this bucket
        if (conf >= bucket.min && conf < bucket.max) {
          bucket.count++;
          break;
        }
        // Handle edge case where confidence === 1.0
        if (bucket.max === 1.0 && conf === 1.0) {
          bucket.count++;
          break;
        }
      }
    }

    const totalMessages = confidences.length;
    const highConf = confidences.filter(c => c >= 0.8).length;
    const mediumConf = confidences.filter(c => c >= 0.5 && c < 0.8).length;
    const lowConf = confidences.filter(c => c < 0.5).length;

    histograms.push({
      intent,
      totalMessages,
      buckets,
      highConf,
      mediumConf,
      lowConf,
      highConfPct: (highConf / totalMessages) * 100,
      mediumConfPct: (mediumConf / totalMessages) * 100,
      lowConfPct: (lowConf / totalMessages) * 100,
    });
  }

  // Sort by total messages descending
  histograms.sort((a, b) => b.totalMessages - a.totalMessages);

  return histograms;
}

// ─── Export to CSV ────────────────────────────────────────────────────────

function exportCsv(report: HistogramReport): string {
  const lines: string[] = [];

  // Header
  lines.push('intent,confidence_bucket,message_count,percentage');

  // Data rows
  for (const intent of report.intents) {
    for (const bucket of intent.buckets) {
      const percentage = intent.totalMessages > 0
        ? ((bucket.count / intent.totalMessages) * 100).toFixed(1)
        : '0.0';

      lines.push(
        `${intent.intent},${bucket.min.toFixed(1)}-${bucket.max.toFixed(1)},${bucket.count},${percentage}%`
      );
    }
  }

  return lines.join('\n');
}

// ─── Format Report for Text Output ───────────────────────────────────────

function formatReport(report: HistogramReport): string {
  const lines: string[] = [];

  lines.push(`Confidence Score Distribution Histogram`);
  lines.push(`Profile: ${report.profile}`);
  lines.push(`Period: ${report.period}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Total Messages Analyzed: ${report.summary.totalMessages}`);
  lines.push(`Intents Analyzed: ${report.summary.intentsAnalyzed}`);
  lines.push('');

  for (const intent of report.intents) {
    lines.push(`${intent.intent} (${intent.totalMessages} total)`);
    lines.push(`  High Confidence (0.8+):   ${intent.highConf} (${intent.highConfPct.toFixed(1)}%)`);
    lines.push(`  Medium Confidence (0.5-0.8): ${intent.mediumConf} (${intent.mediumConfPct.toFixed(1)}%)`);
    lines.push(`  Low Confidence (<0.5):      ${intent.lowConf} (${intent.lowConfPct.toFixed(1)}%)`);
    lines.push('');
    lines.push('  Histogram:');

    for (const bucket of intent.buckets) {
      const barLength = Math.round((bucket.count / intent.totalMessages) * 40);
      const bar = '█'.repeat(barLength);
      const pct = intent.totalMessages > 0
        ? ((bucket.count / intent.totalMessages) * 100).toFixed(1)
        : '0.0';
      lines.push(
        `    ${bucket.min.toFixed(1)}-${bucket.max.toFixed(1)}: ${bar} ${bucket.count} (${pct}%)`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Generate Report ──────────────────────────────────────────────────────

async function generateReport(options: CLIOptions): Promise<HistogramReport> {
  const pool = await getDatabase();

  try {
    const scores = await queryConfidenceScores(pool, options.profile, options.days);

    if (scores.length === 0) {
      return {
        profile: options.profile,
        period: `Last ${options.days} days`,
        generatedAt: new Date().toISOString(),
        intents: [],
        summary: {
          totalMessages: 0,
          intentsAnalyzed: 0,
        },
      };
    }

    const histograms = generateHistogram(scores);

    return {
      profile: options.profile,
      period: `Last ${options.days} days`,
      generatedAt: new Date().toISOString(),
      intents: histograms,
      summary: {
        totalMessages: scores.length,
        intentsAnalyzed: histograms.length,
      },
    };
  } finally {
    await pool.end();
  }
}

// ─── Output Report ────────────────────────────────────────────────────────

function outputReport(report: HistogramReport, options: CLIOptions): void {
  switch (options.format) {
    case 'json':
      console.log(JSON.stringify(report, null, 2));
      break;

    case 'csv':
      console.log(exportCsv(report));
      break;

    case 'text':
    default:
      console.log(formatReport(report));
      break;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    const options = parseCliArgs();
    const report = await generateReport(options);

    outputReport(report, options);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
