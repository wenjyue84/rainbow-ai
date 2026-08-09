#!/usr/bin/env tsx
/**
 * US-391: Intent Classification Error Pattern Grouper CLI
 *
 * Usage:
 *   npx tsx src/tools/group-classification-errors-cli.ts --profile data-pelangi --output errors.json
 *   npx tsx src/tools/group-classification-errors-cli.ts --profile pelangi --days 30
 *   npm run classify:group-errors -- --profile data-pelangi --output errors.json
 *
 * Flags:
 *   --profile <name>   Profile to analyze (required)
 *   --output <file>    Output JSON file path (default: stdout)
 *   --days <n>         Look back N days (default: 30)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildReport,
  PROFILE_ALIASES,
  type MisclassificationRow,
} from './group-classification-errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { profile: string; output?: string; days: number } {
  let profile = '';
  let output: string | undefined;
  let days = 30;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--profile' && argv[i + 1]) {
      profile = argv[++i];
    } else if (argv[i] === '--output' && argv[i + 1]) {
      output = argv[++i];
    } else if (argv[i] === '--days' && argv[i + 1]) {
      days = parseInt(argv[++i], 10);
    }
  }

  if (!profile) {
    console.error('Error: --profile is required');
    console.error('Usage: npx tsx src/tools/group-classification-errors-cli.ts --profile data-pelangi [--output errors.json] [--days 30]');
    process.exit(1);
  }

  return { profile, output, days };
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function resolveProfile(raw: string): string {
  return PROFILE_ALIASES[raw] ?? raw;
}

function loadIntentKeywords(profile: string): Record<string, string[]> {
  const profileDir = `data-${profile}`;
  const candidates = [
    path.join(rootDir, 'src', 'assistant', profileDir, 'intent-keywords.json'),
    path.join(rootDir, 'src', 'assistant', 'data', 'intent-keywords.json'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const result: Record<string, string[]> = {};
      if (data.intents && Array.isArray(data.intents)) {
        for (const entry of data.intents) {
          const allKeywords: string[] = [];
          if (entry.keywords) {
            for (const lang of Object.values(entry.keywords) as string[][]) {
              allKeywords.push(...lang);
            }
          }
          result[entry.intent] = allKeywords;
        }
      }
      return result;
    }
  }

  return {};
}

/**
 * Load misclassification rows from the database via pg query.
 * Falls back to empty array if database is unavailable.
 */
async function loadMisclassificationRows(
  profile: string,
  days: number,
): Promise<MisclassificationRow[]> {
  try {
    // Dynamic import to avoid hard dependency on pg at module level
    const { default: pg } = await import('pg');
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.error('Warning: DATABASE_URL not set, returning empty dataset');
      return [];
    }

    const client = new pg.Client({ connectionString });
    await client.connect();

    const query = `
      SELECT
        message_hash AS "messageText",
        classified_intent AS "predictedIntent",
        actual_intent AS "actualIntent",
        confidence_score AS confidence,
        profile_name AS profile,
        timestamp
      FROM intent_classification_decisions
      WHERE profile_name = $1
        AND actual_intent IS NOT NULL
        AND classified_intent != actual_intent
        AND timestamp >= NOW() - INTERVAL '${days} days'
      ORDER BY timestamp DESC
    `;

    const result = await client.query(query, [profile]);
    await client.end();

    return result.rows.map((r: Record<string, unknown>) => ({
      messageText: String(r.messageText ?? ''),
      predictedIntent: String(r.predictedIntent),
      actualIntent: String(r.actualIntent),
      confidence: Number(r.confidence),
      profile: String(r.profile),
      timestamp: r.timestamp ? String(r.timestamp) : undefined,
    }));
  } catch (err) {
    console.error('Warning: Could not load from database:', (err as Error).message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const profile = resolveProfile(args.profile);

  console.error(`Analyzing misclassifications for profile: ${profile} (last ${args.days} days)`);

  const rows = await loadMisclassificationRows(profile, args.days);
  const existingKeywords = loadIntentKeywords(profile);
  const report = buildReport(profile, rows, existingKeywords, args.output);

  const json = JSON.stringify(report, null, 2);

  if (args.output) {
    const outPath = path.resolve(args.output);
    fs.writeFileSync(outPath, json, 'utf-8');
    console.error(`Report written to ${outPath}`);
  } else {
    console.log(json);
  }

  // Print summary to stderr
  console.error(`\nSummary:`);
  console.error(`  Total misclassifications: ${report.totalMisclassifications}`);
  console.error(`  False positives: ${report.errorTypeSummary.false_positive}`);
  console.error(`  Boundary confusions: ${report.errorTypeSummary.boundary_confusion}`);
  console.error(`  False negatives: ${report.errorTypeSummary.false_negative}`);
  console.error(`  Clusters: ${report.clusters.length}`);
  console.error(`  Problematic pairs: ${report.problematicPairs.length}`);
  console.error(`  Inter-cluster separation: ${report.interClusterSeparation * 100}%`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
