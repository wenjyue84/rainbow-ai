#!/usr/bin/env tsx
/**
 * US-557: Intent Classification Misclassification Analyzer CLI Tool
 *
 * Analyzes recent intent misclassifications by comparing predicted intents
 * with user feedback/actual intents, identifies patterns, and suggests
 * keyword/training data improvements.
 *
 * Usage:
 *   npm run analyze:misclassifications
 *   npm run analyze:misclassifications -- --profile=pelangi --days=7
 *   npx tsx src/tools/cli-analyze-misclassifications.ts --profile=southern --days=30
 *
 * Exit codes:
 *   0 — Analysis complete
 *   1 — Error (DB connection, invalid args, etc.)
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { db, initDb } from '../lib/db.js';
import { intentPredictions, rainbowMessages, rainbowFeedback } from '../../shared/schema-tables.js';
import { and, eq, gte, lt, isNotNull, desc } from 'drizzle-orm';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');
const ANALYSIS_DIR = path.join(rootDir, 'analysis');

const VALID_PROFILES = ['pelangi', 'southern', 'makan'];

// ─── CLI Arguments ───────────────────────────────────────────────────────

interface CliArgs {
  profile: string;
  days: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let profile = 'pelangi';
  let days = 7;

  for (const arg of args) {
    if (arg.startsWith('--profile=')) {
      profile = arg.replace('--profile=', '').trim();
    } else if (arg.startsWith('--days=')) {
      days = parseInt(arg.replace('--days=', '').trim(), 10);
    }
  }

  if (!VALID_PROFILES.includes(profile)) {
    throw new Error(`Invalid profile: ${profile}. Must be one of: ${VALID_PROFILES.join(', ')}`);
  }

  if (isNaN(days) || days <= 0) {
    throw new Error(`Invalid days: ${days}. Must be a positive number.`);
  }

  return { profile, days };
}

// ─── Data Types ──────────────────────────────────────────────────────────

interface MisclassificationPair {
  predicted: string;
  actual: string;
  count: number;
  avg_confidence: number;
  examples: string[];
}

interface ConfidencePattern {
  intent: string;
  misclassified_count: number;
  avg_confidence: number;
  max_confidence: number;
  min_confidence: number;
}

interface KeywordSuggestion {
  intent: string;
  suggestions: string[];
}

interface MisclassificationReport {
  timestamp: string;
  profile: string;
  period_days: number;
  misclassification_pairs: MisclassificationPair[];
  confidence_patterns: ConfidencePattern[];
  suggested_keywords_per_intent: KeywordSuggestion[];
  summary: {
    total_predictions_analyzed: number;
    total_misclassified: number;
    misclassification_rate_percent: number;
  };
}

// ─── Queries ─────────────────────────────────────────────────────────────

async function fetchMisclassifications(
  profile: string,
  days: number
): Promise<typeof intentPredictions.$inferSelect[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const rows = await db
    .select()
    .from(intentPredictions)
    .where(
      and(
        eq(intentPredictions.profile, profile),
        eq(intentPredictions.wasCorrect, false),
        isNotNull(intentPredictions.actualIntent),
        gte(intentPredictions.createdAt, cutoffDate)
      )
    )
    .orderBy(desc(intentPredictions.createdAt));

  return rows;
}

async function fetchAllPredictions(
  profile: string,
  days: number
): Promise<typeof intentPredictions.$inferSelect[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const rows = await db
    .select()
    .from(intentPredictions)
    .where(
      and(
        eq(intentPredictions.profile, profile),
        gte(intentPredictions.createdAt, cutoffDate)
      )
    );

  return rows;
}

// ─── Analysis ────────────────────────────────────────────────────────────

function analyzeMisclassifications(
  misclassifications: typeof intentPredictions.$inferSelect[]
): MisclassificationPair[] {
  const pairMap = new Map<
    string,
    {
      predicted: string;
      actual: string;
      confidences: number[];
      examples: string[];
    }
  >();

  for (const pred of misclassifications) {
    const key = `${pred.predictedIntent}|${pred.actualIntent}`;

    if (!pairMap.has(key)) {
      pairMap.set(key, {
        predicted: pred.predictedIntent || 'unknown',
        actual: pred.actualIntent || 'unknown',
        confidences: [],
        examples: [],
      });
    }

    const pair = pairMap.get(key)!;
    if (pred.confidence !== null) {
      pair.confidences.push(pred.confidence);
    }
    if (pred.messageText && pair.examples.length < 3) {
      pair.examples.push(pred.messageText.substring(0, 100));
    }
  }

  const result: MisclassificationPair[] = Array.from(pairMap.values())
    .map((p) => ({
      predicted: p.predicted,
      actual: p.actual,
      count: p.confidences.length,
      avg_confidence: p.confidences.length > 0
        ? p.confidences.reduce((a, b) => a + b, 0) / p.confidences.length
        : 0,
      examples: p.examples,
    }))
    .sort((a, b) => b.count - a.count);

  return result;
}

function analyzeConfidencePatterns(
  misclassifications: typeof intentPredictions.$inferSelect[]
): ConfidencePattern[] {
  const intentMap = new Map<
    string,
    {
      misclassified_count: number;
      confidences: number[];
    }
  >();

  for (const pred of misclassifications) {
    const intent = pred.predictedIntent || 'unknown';

    if (!intentMap.has(intent)) {
      intentMap.set(intent, {
        misclassified_count: 0,
        confidences: [],
      });
    }

    const data = intentMap.get(intent)!;
    data.misclassified_count++;
    if (pred.confidence !== null) {
      data.confidences.push(pred.confidence);
    }
  }

  const result: ConfidencePattern[] = Array.from(intentMap.entries())
    .map(([intent, data]) => ({
      intent,
      misclassified_count: data.misclassified_count,
      avg_confidence: data.confidences.length > 0
        ? data.confidences.reduce((a, b) => a + b, 0) / data.confidences.length
        : 0,
      max_confidence: data.confidences.length > 0 ? Math.max(...data.confidences) : 0,
      min_confidence: data.confidences.length > 0 ? Math.min(...data.confidences) : 0,
    }))
    .sort((a, b) => b.misclassified_count - a.misclassified_count);

  return result;
}

function suggestKeywordsPerIntent(
  misclassifications: typeof intentPredictions.$inferSelect[]
): KeywordSuggestion[] {
  const intentMessageMap = new Map<string, string[]>();

  // Collect example messages for each actual intent from misclassifications
  for (const pred of misclassifications) {
    const actualIntent = pred.actualIntent || 'unknown';

    if (!intentMessageMap.has(actualIntent)) {
      intentMessageMap.set(actualIntent, []);
    }

    if (pred.messageText) {
      intentMessageMap.get(actualIntent)!.push(pred.messageText);
    }
  }

  const suggestions: KeywordSuggestion[] = Array.from(intentMessageMap.entries())
    .map(([intent, messages]) => {
      // Extract potential keywords (simple word frequency)
      const words = new Map<string, number>();

      for (const msg of messages) {
        const tokens = msg
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3 && !isStopword(w));

        for (const token of tokens) {
          words.set(token, (words.get(token) || 0) + 1);
        }
      }

      // Get top 5 keywords by frequency
      const topKeywords = Array.from(words.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([word]) => word);

      return {
        intent,
        suggestions: topKeywords,
      };
    });

  return suggestions;
}

function isStopword(word: string): boolean {
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'from', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'i', 'you', 'we', 'he', 'she',
    'it', 'this', 'that', 'these', 'those', 'my', 'your', 'our', 'their',
  ]);

  return stopwords.has(word);
}

// ─── Report Generation ───────────────────────────────────────────────────

async function generateReport(profile: string, days: number): Promise<MisclassificationReport> {
  console.log(`\n📊 Analyzing misclassifications for profile: ${profile}, last ${days} days...`);

  // Fetch data
  const misclassifications = await fetchMisclassifications(profile, days);
  const allPredictions = await fetchAllPredictions(profile, days);

  console.log(`   Found ${misclassifications.length} misclassified predictions`);
  console.log(`   Total predictions analyzed: ${allPredictions.length}`);

  // Analyze
  const misclassificationPairs = analyzeMisclassifications(misclassifications);
  const confidencePatterns = analyzeConfidencePatterns(misclassifications);
  const suggestedKeywords = suggestKeywordsPerIntent(misclassifications);

  // Calculate metrics
  const misclassificationRate =
    allPredictions.length > 0
      ? (misclassifications.length / allPredictions.length) * 100
      : 0;

  const report: MisclassificationReport = {
    timestamp: new Date().toISOString(),
    profile,
    period_days: days,
    misclassification_pairs: misclassificationPairs,
    confidence_patterns: confidencePatterns,
    suggested_keywords_per_intent: suggestedKeywords,
    summary: {
      total_predictions_analyzed: allPredictions.length,
      total_misclassified: misclassifications.length,
      misclassification_rate_percent: Math.round(misclassificationRate * 100) / 100,
    },
  };

  return report;
}

// ─── File Output ────────────────────────────────────────────────────────

function ensureAnalysisDir(): void {
  if (!fs.existsSync(ANALYSIS_DIR)) {
    fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
    console.log(`✅ Created analysis directory: ${ANALYSIS_DIR}`);
  }
}

function getReportFilePath(profile: string): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(ANALYSIS_DIR, `misclassification-report-${dateStr}-${profile}.json`);
}

function saveReport(report: MisclassificationReport): string {
  ensureAnalysisDir();
  const filePath = getReportFilePath(report.profile);

  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`✅ Report saved to: ${filePath}`);

  return filePath;
}

// ─── Human-Readable Output ──────────────────────────────────────────────

function formatReport(report: MisclassificationReport): string {
  const lines: string[] = [];

  lines.push('=== Intent Classification Misclassification Analysis ===');
  lines.push(`Profile: ${report.profile}`);
  lines.push(`Period: Last ${report.period_days} days`);
  lines.push(`Generated: ${report.timestamp}`);
  lines.push('');

  // Summary
  lines.push('--- Summary ---');
  lines.push(`Total predictions analyzed: ${report.summary.total_predictions_analyzed}`);
  lines.push(`Total misclassified: ${report.summary.total_misclassified}`);
  lines.push(`Misclassification rate: ${report.summary.misclassification_rate_percent}%`);
  lines.push('');

  // Top misclassification pairs
  if (report.misclassification_pairs.length > 0) {
    lines.push('--- Top Misclassification Pairs (by frequency) ---');
    const topPairs = report.misclassification_pairs.slice(0, 10);
    for (const pair of topPairs) {
      lines.push(
        `  ${pair.count}x: ${pair.predicted} → ${pair.actual} (avg confidence: ${pair.avg_confidence.toFixed(2)})`
      );
    }
    lines.push('');
  }

  // Confidence patterns
  if (report.confidence_patterns.length > 0) {
    lines.push('--- Intents with High Misclassification Rates ---');
    const topIntents = report.confidence_patterns.slice(0, 5);
    for (const pattern of topIntents) {
      lines.push(
        `  "${pattern.intent}": ${pattern.misclassified_count} errors, avg confidence ${pattern.avg_confidence.toFixed(2)}`
      );
    }
    lines.push('');
  }

  // Keyword suggestions
  if (report.suggested_keywords_per_intent.length > 0) {
    lines.push('--- Suggested Keywords per Intent ---');
    for (const suggestion of report.suggested_keywords_per_intent) {
      lines.push(`  "${suggestion.intent}": ${suggestion.suggestions.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    const { profile, days } = parseArgs();

    // Initialize database
    initDb();

    // Generate report
    const report = await generateReport(profile, days);

    // Save JSON report
    const jsonPath = saveReport(report);

    // Print human-readable output
    console.log('\n' + formatReport(report));

    console.log(`\n✅ Analysis complete. JSON report: ${jsonPath}`);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Analysis failed:', message);
    process.exit(1);
  }
}

main();
