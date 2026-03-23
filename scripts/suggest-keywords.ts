#!/usr/bin/env tsx
/**
 * US-213: Intent Keyword Suggestion Engine from Escalated Conversation Analysis
 *
 * Analyzes the escalation_queue table to extract high-value keyword suggestions
 * for each intent using TF-IDF scoring.
 *
 * Usage:
 *   npm run suggest:keywords -- --profile pelangi --days 30
 *   npm run suggest:keywords -- --profile makan --days 7
 *   npm run suggest:keywords -- --profile southern --days 14 --top 3
 *
 * Output (stdout): JSON array matching schemas/suggestion-output.schema.json
 * Exit codes:
 *   0 — Analysis complete (may be empty array if no data)
 *   1 — Invalid arguments or DB connection failure
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { computeTfidf, estimateAccuracyBoost } from '../src/lib/tfidf.js';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// ─── Types ────────────────────────────────────────────────────────────────────

interface SuggestionResult {
  intent_id: string;
  current_keyword_count: number;
  suggested_keywords: string[];
  estimated_accuracy_boost_percent: number;
}

interface EscalationRow {
  originalIntent: string;
  messagePreview: string | null;
}

// ─── Profile config ────────────────────────────────────────────────────────────

const PROFILE_DIRS: Record<string, string> = {
  pelangi: 'src/assistant/data',
  makan: 'src/assistant/data-makan',
  southern: 'src/assistant/data-southern',
};

// ─── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { profile: string; days: number; top: number } {
  const args = argv.slice(2);
  let profile = 'pelangi';
  let days = 30;
  let top = 3;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) {
      profile = args[++i]!;
    } else if (args[i] === '--days' && args[i + 1]) {
      days = parseInt(args[++i]!, 10);
    } else if (args[i] === '--top' && args[i + 1]) {
      top = parseInt(args[++i]!, 10);
    }
  }

  return { profile, days, top };
}

// ─── Keywords loader ──────────────────────────────────────────────────────────

function loadCurrentKeywords(profile: string): Map<string, Set<string>> {
  const dir = PROFILE_DIRS[profile];
  if (!dir) return new Map();

  const keywordsPath = path.join(rootDir, dir, 'intent-keywords.json');
  if (!fs.existsSync(keywordsPath)) return new Map();

  try {
    const raw = JSON.parse(fs.readFileSync(keywordsPath, 'utf-8')) as {
      intents: Array<{ intent: string; keywords: Record<string, string[]> }>;
    };
    const result = new Map<string, Set<string>>();
    for (const item of raw.intents) {
      const all = new Set<string>();
      for (const kws of Object.values(item.keywords)) {
        for (const kw of kws) all.add(kw.toLowerCase().trim());
      }
      result.set(item.intent, all);
    }
    return result;
  } catch {
    return new Map();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { profile, days, top } = parseArgs(process.argv);

  const validProfiles = Object.keys(PROFILE_DIRS);
  if (!validProfiles.includes(profile)) {
    console.error(`Error: Unknown profile "${profile}". Valid profiles: ${validProfiles.join(', ')}`);
    process.exit(1);
  }

  if (isNaN(days) || days < 1) {
    console.error('Error: --days must be a positive integer');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // Query escalation_queue for recent low-confidence messages
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await pool.query<EscalationRow>(
      `SELECT
         original_intent AS "originalIntent",
         message_preview AS "messagePreview"
       FROM escalation_queue
       WHERE profile = $1
         AND timestamp >= $2
         AND message_preview IS NOT NULL
         AND message_preview != ''
       ORDER BY timestamp DESC`,
      [profile, cutoffDate.toISOString()]
    );

    const rows = result.rows;

    if (rows.length === 0) {
      // No data — return empty array (not an error)
      console.log('[]');
      return;
    }

    // Group messages by intent
    const intentMessages = new Map<string, string[]>();
    for (const row of rows) {
      const intent = row.originalIntent;
      const text = row.messagePreview ?? '';
      if (!text) continue;
      const existing = intentMessages.get(intent) ?? [];
      existing.push(text);
      intentMessages.set(intent, existing);
    }

    // Load existing keywords to avoid duplicates
    const currentKeywords = loadCurrentKeywords(profile);

    // Compute TF-IDF across all intent corpora
    const tfidfResults = computeTfidf(intentMessages);

    // Build output
    const output: SuggestionResult[] = [];

    for (const [intentId, messages] of intentMessages) {
      const scored = tfidfResults.get(intentId) ?? [];
      const existing = currentKeywords.get(intentId) ?? new Set();

      // Get current keyword count for this intent
      const currentKeywordCount = existing.size;

      // Filter out already-registered keywords, pick top N
      const suggestions = scored
        .filter(r => !existing.has(r.term))
        .slice(0, top)
        .map(r => r.term);

      const boost = estimateAccuracyBoost(messages, suggestions);

      output.push({
        intent_id: intentId,
        current_keyword_count: currentKeywordCount,
        suggested_keywords: suggestions,
        estimated_accuracy_boost_percent: boost,
      });
    }

    // Sort by estimated boost descending so highest-value intents appear first
    output.sort((a, b) => b.estimated_accuracy_boost_percent - a.estimated_accuracy_boost_percent);

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
