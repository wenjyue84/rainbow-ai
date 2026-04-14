#!/usr/bin/env tsx
/**
 * US-636: Intent Classification Performance Regression Detector CLI
 *
 * Weekly accuracy regression detection comparing current 7-day window against
 * previous 7-day baseline. Alerts when accuracy drops > 2% for any intent.
 *
 * Usage:
 *   npm run check:regression                        # pelangi profile (default)
 *   npm run check:regression -- --profile=southern   # southern profile
 *   npx tsx src/tools/regression-detector-cli.ts --profile=pelangi
 *
 * Exit codes:
 *   0 — No regression or within tolerance
 *   1 — Regression detected (> 2%) or error
 */

import dotenv from 'dotenv';
import { initDb } from '../lib/db.js';
import { queryIntentAccuracy } from '../lib/analytics.js';
import { calculateRegression } from './regression-detector.js';

dotenv.config();

const VALID_PROFILES = ['pelangi', 'southern', 'makan'];

// ─── Parse CLI Arguments ───────────────────────────────────────────────

interface CliArgs {
  profile: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let profile = 'pelangi';

  // Parse --profile=xxx
  for (const arg of args) {
    if (arg.startsWith('--profile=')) {
      profile = arg.replace('--profile=', '').trim();
      break;
    }
  }

  if (!VALID_PROFILES.includes(profile)) {
    throw new Error(`Invalid profile: ${profile}. Must be one of: ${VALID_PROFILES.join(', ')}`);
  }

  return { profile };
}

// ─── Main Analysis ───────────────────────────────────────────────────

async function main(): Promise<number> {
  try {
    const { profile } = parseArgs();

    // Initialize database
    initDb();

    // Get current timestamp and calculate windows
    const now = new Date();
    const currentEnd = new Date(now);
    const currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

    const baselineEnd = new Date(currentStart);
    const baselineStart = new Date(baselineEnd.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days before

    // Query accuracy data for both windows
    const currentData = await queryIntentAccuracy(profile, currentStart, currentEnd);
    const baselineData = await queryIntentAccuracy(profile, baselineStart, baselineEnd);

    // Calculate regression
    const result = calculateRegression(profile, currentData, baselineData);

    // Output JSON result
    const output = {
      timestamp: now.toISOString(),
      profile: result.profileId,
      accuracy_current: Math.round(result.accuracyCurrent * 100) / 100,
      accuracy_baseline: Math.round(result.accuracyBaseline * 100) / 100,
      regression_percentage: Math.round(result.regressionPct * 100) / 100,
      has_regression: result.hasRegression,
      flagged_intents: result.flaggedIntents.map(intent => ({
        intent_type: intent.intentType,
        baseline_accuracy: Math.round(intent.baselineAccuracy * 100) / 100,
        current_accuracy: Math.round(intent.currentAccuracy * 100) / 100,
        delta: Math.round(intent.delta * 100) / 100,
      })),
      per_intent_breakdown: result.perIntentBreakdown.map(item => ({
        intent_type: item.intentType,
        baseline_accuracy: Math.round(item.baselineAccuracy * 100) / 100,
        current_accuracy: Math.round(item.currentAccuracy * 100) / 100,
        delta: Math.round(item.delta * 100) / 100,
        flagged: item.isFlagged,
      })),
    };

    console.log(JSON.stringify(output, null, 2));

    // Exit with code 1 if regression detected
    return result.hasRegression ? 1 : 0;
  } catch (error: any) {
    console.error('Error:', error.message);
    return 1;
  }
}

// ─── Run ──────────────────────────────────────────────────────────────

main().then(exitCode => process.exit(exitCode));
