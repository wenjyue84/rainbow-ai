#!/usr/bin/env tsx
/**
 * US-600: Add Intent Keyword Dead-Code Audit CLI with Usage Analytics
 *
 * Scans intent-keywords.json files per profile and identifies keywords that never
 * matched in production (unused for 30+ days), reports with confidence scores to
 * guide cleanup and reduce classification noise.
 *
 * Usage:
 *   npm run kb:audit-keywords -- --profile pelangi
 *   npm run kb:audit-keywords -- --profile pelangi --days 30
 *   npm run kb:audit-keywords -- --profile pelangi --dryrun
 *
 * Output:
 *   reports/audit-keywords-{profile}-{date}.json
 *
 * Exit codes:
 *   0 — Audit completed successfully
 *   1 — Error (DB connection, missing profile, invalid parameters, etc.)
 */

import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ─── Types ───────────────────────────────────────────────────────────────

interface CLIOptions {
  profile: string;
  days: number;
  dryrun: boolean;
}

interface KeywordEntry {
  intent: string;
  language: string;
  keyword: string;
}

interface KeywordUsageStat {
  intent: string;
  keyword: string;
  language: string;
  matchCount: number;
  lastUsedAt: string | null;
  confidence: number;
  recommendation: 'remove' | 'review' | 'keep';
}

interface AuditReport {
  profile: string;
  auditDate: string;
  daysAnalyzed: number;
  totalKeywords: number;
  unusedKeywords: number;
  stats: KeywordUsageStat[];
}

// ─── Parse CLI Arguments ──────────────────────────────────────────────────

function parseCliArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    profile: 'pelangi',
    days: 30,
    dryrun: false,
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
    } else if (arg === '--dryrun') {
      options.dryrun = true;
    }
  }

  return options;
}

// ─── Load Intent Keywords ──────────────────────────────────────────────────

interface IntentKeywordsData {
  intents: Array<{
    intent: string;
    keywords: Record<string, string[]>;
  }>;
}

function loadIntentKeywords(profile: string): KeywordEntry[] {
  const keywordFiles = [
    path.join(PROJECT_ROOT, `src/assistant/data/intent-keywords-${profile}.json`),
    path.join(PROJECT_ROOT, `src/assistant/data-${profile}/intent-keywords.json`),
  ];

  let filePath: string | null = null;
  for (const fp of keywordFiles) {
    if (fs.existsSync(fp)) {
      filePath = fp;
      break;
    }
  }

  if (!filePath) {
    throw new Error(`Could not find intent-keywords file for profile: ${profile}`);
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data: IntentKeywordsData = JSON.parse(content);

    const entries: KeywordEntry[] = [];
    for (const intentObj of data.intents) {
      const intent = intentObj.intent;
      const keywords = intentObj.keywords || {};

      for (const [language, words] of Object.entries(keywords)) {
        if (Array.isArray(words)) {
          for (const keyword of words) {
            entries.push({
              intent,
              language,
              keyword: keyword.toLowerCase(),
            });
          }
        }
      }
    }

    return entries;
  } catch (error) {
    throw new Error(`Failed to load intent keywords from ${filePath}: ${error instanceof Error ? error.message : error}`);
  }
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

// ─── Query Keyword Usage Stats ─────────────────────────────────────────────

interface KeywordMatch {
  keyword_matched: string;
  intent_type: string;
  confidence: number;
  created_at: Date;
}

async function queryKeywordUsageStats(
  pool: pg.Pool,
  profile: string,
  days: number
): Promise<Map<string, { matchCount: number; lastUsedAt: string; confidence: number }>> {
  try {
    const query = `
      SELECT
        keyword_matched,
        intent_type,
        confidence,
        created_at
      FROM intent_analytics
      WHERE profile_id = $1
        AND created_at >= NOW() - INTERVAL '1 day' * $2
      ORDER BY keyword_matched, created_at DESC
    `;

    const result = await pool.query(query, [profile, days]);
    const rows = result.rows as KeywordMatch[];

    // Group by keyword_matched
    const stats = new Map<string, { matchCount: number; lastUsedAt: string; confidence: number }>();

    for (const row of rows) {
      const keyword = row.keyword_matched.toLowerCase();
      if (!stats.has(keyword)) {
        stats.set(keyword, {
          matchCount: 0,
          lastUsedAt: row.created_at.toISOString(),
          confidence: row.confidence || 0,
        });
      }
      const stat = stats.get(keyword)!;
      stat.matchCount++;
      // Keep the first (most recent) lastUsedAt
      if (!stat.lastUsedAt || new Date(row.created_at) > new Date(stat.lastUsedAt)) {
        stat.lastUsedAt = row.created_at.toISOString();
      }
    }

    return stats;
  } catch (error) {
    console.error('Failed to query keyword usage stats:', error);
    throw error;
  }
}

// ─── Generate Audit Report ────────────────────────────────────────────────

async function generateAuditReport(
  options: CLIOptions,
  pool: pg.Pool
): Promise<AuditReport> {
  // Load all keywords from the profile
  const keywords = loadIntentKeywords(options.profile);

  // Query usage stats from intent_analytics
  const usageStats = await queryKeywordUsageStats(pool, options.profile, options.days);

  // Generate stats for each keyword
  const stats: KeywordUsageStat[] = [];
  const uniqueKeywords = new Set<string>();

  for (const entry of keywords) {
    const keywordLower = entry.keyword.toLowerCase();
    const key = `${entry.intent}|${keywordLower}`;

    if (uniqueKeywords.has(key)) {
      continue; // Skip duplicates
    }
    uniqueKeywords.add(key);

    const usage = usageStats.get(keywordLower);
    const matchCount = usage?.matchCount ?? 0;
    const lastUsedAt = usage?.lastUsedAt ?? null;
    const confidence = usage?.confidence ?? 0;

    // Recommendation logic
    let recommendation: 'remove' | 'review' | 'keep';
    if (matchCount === 0) {
      recommendation = 'remove';
    } else if (matchCount < 5 || confidence < 0.5) {
      recommendation = 'review';
    } else {
      recommendation = 'keep';
    }

    stats.push({
      intent: entry.intent,
      keyword: entry.keyword,
      language: entry.language,
      matchCount,
      lastUsedAt,
      confidence: parseFloat(confidence.toFixed(2)),
      recommendation,
    });
  }

  // Sort by matchCount ascending (unused first)
  stats.sort((a, b) => {
    if (a.matchCount !== b.matchCount) {
      return a.matchCount - b.matchCount;
    }
    return a.keyword.localeCompare(b.keyword);
  });

  const unusedCount = stats.filter(s => s.matchCount === 0).length;

  return {
    profile: options.profile,
    auditDate: new Date().toISOString(),
    daysAnalyzed: options.days,
    totalKeywords: uniqueKeywords.size,
    unusedKeywords: unusedCount,
    stats,
  };
}

// ─── Write Report to File ──────────────────────────────────────────────────

async function writeAuditReport(report: AuditReport): Promise<string> {
  const reportsDir = path.join(PROJECT_ROOT, 'reports');

  // Create reports directory if it doesn't exist
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const date = new Date().toISOString().split('T')[0];
  const filename = `audit-keywords-${report.profile}-${date}.json`;
  const filepath = path.join(reportsDir, filename);

  const content = JSON.stringify(report, null, 2);
  fs.writeFileSync(filepath, content, 'utf-8');

  return filepath;
}

// ─── Format Report for Console Output ──────────────────────────────────────

function formatReport(report: AuditReport): string {
  const lines: string[] = [];

  lines.push(`Intent Keyword Audit Report`);
  lines.push(`Profile: ${report.profile}`);
  lines.push(`Audit Date: ${report.auditDate}`);
  lines.push(`Days Analyzed: ${report.daysAnalyzed}`);
  lines.push(`Total Keywords: ${report.totalKeywords}`);
  lines.push(`Unused Keywords (0 matches): ${report.unusedKeywords}`);
  lines.push('');

  // Show summary by recommendation
  const byRecommendation = new Map<string, number>();
  for (const stat of report.stats) {
    const count = byRecommendation.get(stat.recommendation) ?? 0;
    byRecommendation.set(stat.recommendation, count + 1);
  }

  lines.push('Summary by Recommendation:');
  for (const [rec, count] of Array.from(byRecommendation.entries()).sort()) {
    lines.push(`  ${rec}: ${count}`);
  }
  lines.push('');

  // Show unused keywords (recommendation='remove')
  const unused = report.stats.filter(s => s.recommendation === 'remove');
  if (unused.length > 0) {
    lines.push(`Unused Keywords (remove) - Top 20:`);
    for (const stat of unused.slice(0, 20)) {
      lines.push(`  ${stat.intent} > ${stat.keyword} (lang: ${stat.language})`);
    }
    lines.push('');
  }

  // Show low-confidence keywords (recommendation='review')
  const lowConf = report.stats.filter(s => s.recommendation === 'review').slice(0, 10);
  if (lowConf.length > 0) {
    lines.push(`Low Confidence Keywords (review) - Top 10:`);
    for (const stat of lowConf) {
      lines.push(`  ${stat.intent} > ${stat.keyword} (matches: ${stat.matchCount}, conf: ${stat.confidence.toFixed(2)})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let pool: pg.Pool | null = null;

  try {
    const options = parseCliArgs();

    console.log(`Starting keyword audit for profile: ${options.profile}`);

    // Connect to database
    pool = await getDatabase();

    // Generate audit report
    const report = await generateAuditReport(options, pool);

    // Write report to file
    const reportPath = await writeAuditReport(report);
    console.log(`Report written to: ${reportPath}`);

    // Output formatted report
    console.log('');
    console.log(formatReport(report));

    process.exit(0);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

main();
