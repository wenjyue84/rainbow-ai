#!/usr/bin/env tsx
/**
 * US-213: Intent Keyword Suggestion Engine from Escalated Conversation Analysis
 *
 * Analyzes escalation_queue table to extract keyword suggestions using TF-IDF
 * scoring. Groups low-confidence messages by intent and recommends 2-3
 * high-impact keywords per intent.
 *
 * Usage:
 *   npm run suggest:keywords -- --profile=makan --days=30
 *   npx tsx src/tools/suggest-keywords-cli.ts --profile=pelangi
 *   npx tsx src/tools/suggest-keywords-cli.ts --profile=makan --days=30 --json
 *
 * Exit codes:
 *   0 — Suggestions generated (or no escalations found)
 *   1 — Error (DB connection, invalid profile, etc.)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import {
  analyzeEscalations,
  loadExistingKeywords,
  type EscalationRow,
  type SuggestKeywordsOutput,
} from './suggest-keywords.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

const VALID_PROFILES = ['pelangi', 'makan', 'southern'];

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatHumanReport(output: SuggestKeywordsOutput): string {
  const lines: string[] = [];
  lines.push('=== Keyword Suggestion Report ===');
  lines.push(`Generated: ${output.timestamp}`);
  lines.push(`Profile: ${output.profile}`);
  lines.push(`Days analyzed: ${output.days_analyzed}`);
  lines.push(`Total escalations: ${output.total_escalations}`);
  lines.push('');

  if (output.suggestions.length === 0) {
    lines.push('No keyword suggestions found. Either no escalations exist or all');
    lines.push('terms are already covered by existing keywords.');
    return lines.join('\n');
  }

  lines.push(`Found ${output.suggestions.length} intent(s) with keyword suggestions:`);
  lines.push('');

  for (const s of output.suggestions) {
    lines.push(`Intent: "${s.intent_id}"`);
    lines.push(`  Current keywords: ${s.current_keyword_count}`);
    lines.push(`  Suggested: ${s.suggested_keywords.join(', ')}`);
    lines.push(`  Estimated accuracy boost: ~${s.estimated_accuracy_boost_percent}%`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// DB query
// ---------------------------------------------------------------------------

async function fetchEscalations(
  profile: string,
  days: number,
): Promise<EscalationRow[]> {
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

    const result = await pool.query<EscalationRow>(
      `SELECT original_intent, message_preview, confidence_score, profile, timestamp
       FROM escalation_queue
       WHERE profile = $1 AND timestamp >= $2
       ORDER BY confidence_score ASC`,
      [profile, cutoff.toISOString()],
    );

    return result.rows;
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const profileArg = args.find(a => a.startsWith('--profile='))?.split('=')[1] || 'pelangi';
  const daysArg = parseInt(args.find(a => a.startsWith('--days='))?.split('=')[1] || '30', 10);
  const jsonMode = args.includes('--json');

  if (!VALID_PROFILES.includes(profileArg)) {
    console.error(`[ERROR] Unknown profile: ${profileArg}`);
    console.error(`Valid profiles: ${VALID_PROFILES.join(', ')}`);
    process.exit(1);
  }

  if (isNaN(daysArg) || daysArg < 1) {
    console.error('[ERROR] --days must be a positive integer');
    process.exit(1);
  }

  let rows: EscalationRow[];
  try {
    rows = await fetchEscalations(profileArg, daysArg);
  } catch (err: any) {
    console.error(`[ERROR] Failed to query escalation_queue: ${err.message}`);
    process.exit(1);
  }

  const existingKeywords = loadExistingKeywords(rootDir, profileArg);
  const suggestions = analyzeEscalations(rows, existingKeywords, 3);

  const output: SuggestKeywordsOutput = {
    timestamp: new Date().toISOString(),
    profile: profileArg,
    days_analyzed: daysArg,
    total_escalations: rows.length,
    suggestions,
  };

  if (jsonMode) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatHumanReport(output));
  }
}

main();
