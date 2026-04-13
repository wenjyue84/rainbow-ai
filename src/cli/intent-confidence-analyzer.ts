#!/usr/bin/env tsx
/**
 * US-588: Intent Classification Confidence Analysis CLI with Confusion Matrix
 *
 * Analyzes intent classification accuracy per profile using feedback data.
 * Generates confusion matrix showing which intents are misclassified as which.
 * Highlights intents with <75% accuracy and shows top 5 misclassification pairs per profile.
 *
 * Usage:
 *   npm run analyze:intent-confidence
 *   npm run analyze:intent-confidence -- --profile pelangi
 *   npm run analyze:intent-confidence -- --json
 *
 * Exit codes:
 *   0 — Analysis complete
 *   1 — Error (DB connection, invalid profile, etc.)
 */

import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';
import { computeConfusionMatrix, generateJSONReport, formatReport, type ConfusionMatrixReport } from '../lib/intent-accuracy-scorer.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ─── Types ───────────────────────────────────────────────────────────────

interface CLIOptions {
  profiles?: string[];
  json?: boolean;
  output?: string;
}

interface FeedbackRow {
  predicted_intent: string | null;
  actual_intent: string | null;
  profile: string | null;
}

// ─── Parse CLI Arguments ──────────────────────────────────────────────────

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    profiles: [],
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--profile' && i + 1 < args.length) {
      options.profiles!.push(args[++i]);
    } else if (arg === '--json') {
      options.json = true;
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

// ─── Query Feedback Data ──────────────────────────────────────────────────

async function queryFeedbackData(pool: pg.Pool, profile?: string): Promise<FeedbackRow[]> {
  try {
    // Use intentPredictions table which has predictedIntent, actualIntent, and profile
    let query = `
      SELECT
        predicted_intent,
        actual_intent,
        profile
      FROM intent_predictions
      WHERE predicted_intent IS NOT NULL
        AND actual_intent IS NOT NULL
    `;

    const params: string[] = [];

    if (profile) {
      query += ` AND profile = $1`;
      params.push(profile);
    }

    // Order by created_at DESC to get recent data first
    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, params);
    return result.rows as FeedbackRow[];
  } catch (error) {
    console.error('Failed to query feedback data:', error);
    throw error;
  }
}

// ─── Get Distinct Profiles ───────────────────────────────────────────────

async function getProfiles(pool: pg.Pool): Promise<string[]> {
  try {
    const result = await pool.query(
      `SELECT DISTINCT profile FROM intent_predictions WHERE profile IS NOT NULL ORDER BY profile`
    );
    return result.rows.map((row) => row.profile).filter((p) => p);
  } catch (error) {
    console.error('Failed to get profiles:', error);
    throw error;
  }
}

// ─── Generate Report ─────────────────────────────────────────────────────

async function generateReport(options: CLIOptions): Promise<ConfusionMatrixReport[]> {
  const pool = await getDatabase();

  try {
    let profiles = options.profiles || [];

    // If no profiles specified, get all
    if (profiles.length === 0) {
      profiles = await getProfiles(pool);
    }

    if (profiles.length === 0) {
      console.warn('No profiles found in database');
      return [];
    }

    const reports: ConfusionMatrixReport[] = [];

    for (const profile of profiles) {
      const feedbackData = await queryFeedbackData(pool, profile);

      if (feedbackData.length === 0) {
        console.warn(`No feedback data for profile: ${profile}`);
        continue;
      }

      // Convert database field names to match our expected format
      const convertedData = feedbackData.map((row) => ({
        predictedIntent: row.predicted_intent,
        actualIntent: row.actual_intent,
      }));

      const report = computeConfusionMatrix(convertedData, profile);
      reports.push(report);
    }

    return reports;
  } finally {
    await pool.end();
  }
}

// ─── Output Report ───────────────────────────────────────────────────────

function outputReport(reports: ConfusionMatrixReport[], options: CLIOptions): void {
  if (options.json) {
    // Output as JSON array
    console.log(JSON.stringify(reports, null, 2));
  } else {
    // Output as formatted text
    for (const report of reports) {
      console.log(formatReport(report));
      console.log('\n---\n');
    }

    // Summary
    console.log('Summary:');
    for (const report of reports) {
      const lowAccuracyCount = report.lowAccuracyIntents.length;
      const topPairCount = report.topMisclassificationPairs.length;
      console.log(
        `${report.profile}: ${report.totalSamples} samples, ${lowAccuracyCount} low-accuracy intents, ${topPairCount} top misclassification pairs`
      );
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    const options = parseArgs();
    const reports = await generateReport(options);

    if (reports.length === 0) {
      console.warn('No reports generated');
      process.exit(1);
    }

    outputReport(reports, options);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
