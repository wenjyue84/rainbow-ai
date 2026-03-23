#!/usr/bin/env tsx
/**
 * US-218: Intent Classification Ground Truth Dataset Exporter CLI
 *
 * Exports real conversations with inferred intents, confidence scores,
 * and actual outcomes for building ground truth ML training datasets.
 * Enforces strict per-profile isolation to prevent cross-profile
 * contamination in training data.
 *
 * Usage:
 *   npm run export-ground-truth -- --profile=pelangi --format=jsonl --days=90 --min-confidence=0.5 --output=ground-truth.jsonl
 *   npx tsx src/tools/export-ground-truth-cli.ts --profile=pelangi --format=jsonl --days=90 --min-confidence=0.5 --output=ground-truth.jsonl
 *
 * Exit codes:
 *   0 — Export successful, no contamination
 *   1 — Export failed or contamination detected
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import dotenv from 'dotenv';
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { rainbowMessages, rainbowConversationState } from '../../shared/schema.js';
import {
  transformRows,
  validateContamination,
  formatAsJSONL,
  countDistinct,
  getConfidenceRange,
  countOutcomes,
  PROFILE_CONFIG,
  type RawMessageRow,
  type ConversationLanguage,
  type ExportOptions,
} from './export-ground-truth.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

const { Pool } = pg;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): {
  profile: string;
  format: string;
  days: number;
  minConfidence: number;
  output: string;
} {
  const args = process.argv.slice(2);

  const getArg = (name: string, defaultValue: string): string => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.split('=')[1] : defaultValue;
  };

  return {
    profile: getArg('profile', 'pelangi'),
    format: getArg('format', 'jsonl'),
    days: parseInt(getArg('days', '90'), 10),
    minConfidence: parseFloat(getArg('min-confidence', '0.5')),
    output: getArg('output', 'ground-truth.jsonl'),
  };
}

// ---------------------------------------------------------------------------
// Database queries
// ---------------------------------------------------------------------------

async function fetchMessages(
  db: ReturnType<typeof drizzle>,
  profile: string,
  days: number
): Promise<RawMessageRow[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const rows = await db
    .select({
      content: rainbowMessages.content,
      intent: rainbowMessages.intent,
      confidence: rainbowMessages.confidence,
      phone: rainbowMessages.phone,
      timestamp: rainbowMessages.timestamp,
      profileId: rainbowMessages.profileId,
      action: rainbowMessages.action,
      routedAction: rainbowMessages.routedAction,
    })
    .from(rainbowMessages)
    .where(
      and(
        eq(rainbowMessages.profileId, profile),
        eq(rainbowMessages.role, 'user'),
        gte(rainbowMessages.timestamp, cutoffDate),
        isNotNull(rainbowMessages.intent),
        isNotNull(rainbowMessages.confidence)
      )
    );

  return rows as RawMessageRow[];
}

async function fetchLanguageMap(
  db: ReturnType<typeof drizzle>
): Promise<Map<string, string>> {
  const rows = await db
    .select({
      phone: rainbowConversationState.phone,
      language: rainbowConversationState.language,
    })
    .from(rainbowConversationState);

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.phone, row.language);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<number> {
  const cliArgs = parseArgs();

  // Validate profile
  if (!PROFILE_CONFIG[cliArgs.profile]) {
    console.error(`[ERROR] Unknown profile: ${cliArgs.profile}`);
    console.error(`Valid profiles: ${Object.keys(PROFILE_CONFIG).join(', ')}`);
    return 1;
  }

  // Validate format
  if (cliArgs.format !== 'jsonl') {
    console.error(`[ERROR] Unsupported format: ${cliArgs.format}. Only 'jsonl' is supported.`);
    return 1;
  }

  console.log(`=== Ground Truth Dataset Export ===`);
  console.log(`Profile: ${cliArgs.profile}`);
  console.log(`Days: ${cliArgs.days}`);
  console.log(`Min confidence: ${cliArgs.minConfidence}`);
  console.log(`Output: ${cliArgs.output}`);
  console.log(`Format: ${cliArgs.format}`);
  console.log('');

  // Connect to database
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[ERROR] DATABASE_URL not set in environment');
    return 1;
  }

  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool);

  try {
    // Fetch data
    console.log('Fetching messages...');
    const messages = await fetchMessages(db, cliArgs.profile, cliArgs.days);
    console.log(`Found ${messages.length} classified user messages for profile '${cliArgs.profile}'`);

    console.log('Fetching language preferences...');
    const languageMap = await fetchLanguageMap(db);

    // Transform rows
    const options: ExportOptions = {
      profile: cliArgs.profile,
      days: cliArgs.days,
      minConfidence: cliArgs.minConfidence,
      format: 'jsonl',
    };

    const { records, filteredByConfidence } = transformRows(messages, languageMap, options);
    console.log(`Transformed ${records.length} records (${filteredByConfidence} filtered by confidence < ${cliArgs.minConfidence})`);

    if (records.length === 0) {
      console.warn('[WARN] No records to export. Check your filters.');
      return 0;
    }

    // Cross-profile contamination check
    console.log('');
    console.log('Running cross-profile contamination check...');
    const violations = validateContamination(records, cliArgs.profile, rootDir);

    if (violations.length > 0) {
      console.error(`[FAIL] Cross-profile contamination detected: ${violations.length} violation(s)`);
      console.error('');
      for (const v of violations.slice(0, 10)) {
        console.error(`  Keyword "${v.keyword}" found in foreign profile '${v.foreign_profile}' (intent: ${v.foreign_intent})`);
      }
      if (violations.length > 10) {
        console.error(`  ... and ${violations.length - 10} more`);
      }
      console.error('');
      console.error('Export aborted. Fix contamination before exporting training data.');
      return 1;
    }

    console.log('No cross-profile contamination detected.');

    // Write output
    const jsonlContent = formatAsJSONL(records);
    const outputPath = path.isAbsolute(cliArgs.output)
      ? cliArgs.output
      : path.join(rootDir, cliArgs.output);
    fs.writeFileSync(outputPath, jsonlContent + '\n', 'utf-8');
    console.log(`Wrote ${records.length} records to ${outputPath}`);

    // Summary statistics
    console.log('');
    console.log('=== Export Summary ===');
    console.log(`Total records: ${records.length}`);
    console.log(`Distinct intents: ${countDistinct(records, 'inferred_intent')}`);
    console.log(`Distinct conversations: ${countDistinct(records, 'conversation_id')}`);

    const range = getConfidenceRange(records);
    console.log(`Confidence range: ${range.min.toFixed(2)} - ${range.max.toFixed(2)}`);

    const outcomes = countOutcomes(records);
    console.log(`Outcome distribution:`);
    for (const [outcome, count] of Object.entries(outcomes)) {
      console.log(`  ${outcome}: ${count} (${((count / records.length) * 100).toFixed(1)}%)`);
    }

    return 0;
  } catch (error) {
    console.error('[ERROR] Export failed:', error);
    return 1;
  } finally {
    await pool.end();
  }
}

run().then((code) => process.exit(code));
