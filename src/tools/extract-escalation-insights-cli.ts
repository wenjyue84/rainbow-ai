#!/usr/bin/env tsx
/**
 * US-295: Extract Escalation Insights CLI
 *
 * Outputs improvement recommendations JSON with suggested keyword additions
 * and intent routing fixes based on staff escalation feedback.
 *
 * Usage:
 *   npm run extract:escalation-insights -- --since=30d
 *   npx tsx src/tools/extract-escalation-insights-cli.ts --since=30d
 *   npx tsx src/tools/extract-escalation-insights-cli.ts --since=7d --json
 */

import dotenv from 'dotenv';
import pg from 'pg';
import { generateRecommendations } from '../routes/admin/escalation-feedback.js';

dotenv.config();

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseSinceDays(args: string[]): number {
  const sinceArg = args.find(a => a.startsWith('--since='));
  if (!sinceArg) return 30;
  const val = sinceArg.replace('--since=', '');
  const match = val.match(/^(\d+)d$/);
  return match ? parseInt(match[1]) : 30;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const days = parseSinceDays(args);
  const jsonOutput = hasFlag(args, '--json');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    // Feedback type breakdown
    const typeResult = await client.query(
      `SELECT feedback_type, COUNT(*) AS count
       FROM escalation_feedback
       WHERE created_at >= $1
       GROUP BY feedback_type
       ORDER BY count DESC`,
      [since]
    );

    // Misclassified intents
    const misclassifiedResult = await client.query(
      `SELECT
        ef.correct_intent,
        ee.trigger AS original_trigger,
        COUNT(*) AS count
      FROM escalation_feedback ef
      JOIN escalation_events ee ON ee.id = ef.escalation_id
      WHERE ef.created_at >= $1
        AND ef.feedback_type = 'intent_misclassified'
        AND ef.correct_intent IS NOT NULL
      GROUP BY ef.correct_intent, ee.trigger
      ORDER BY count DESC
      LIMIT 20`,
      [since]
    );

    // Severity distribution
    const severityResult = await client.query(
      `SELECT severity, COUNT(*) AS count
       FROM escalation_feedback
       WHERE created_at >= $1
       GROUP BY severity
       ORDER BY count DESC`,
      [since]
    );

    const recommendations = generateRecommendations(
      typeResult.rows,
      misclassifiedResult.rows,
    );

    const output = {
      generated_at: new Date().toISOString(),
      period_days: days,
      since: since.toISOString(),
      total_feedback: typeResult.rows.reduce((sum: number, r: any) => sum + parseInt(r.count), 0),
      feedback_type_breakdown: typeResult.rows.map((r: any) => ({
        type: r.feedback_type,
        count: parseInt(r.count),
      })),
      severity_breakdown: severityResult.rows.map((r: any) => ({
        severity: r.severity,
        count: parseInt(r.count),
      })),
      misclassified_intents: misclassifiedResult.rows.map((r: any) => ({
        correct_intent: r.correct_intent,
        original_trigger: r.original_trigger,
        count: parseInt(r.count),
      })),
      recommendations,
    };

    if (jsonOutput) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log('=== Escalation Insights Report ===');
      console.log(`Generated: ${output.generated_at}`);
      console.log(`Period: last ${days} days (since ${since.toISOString().split('T')[0]})`);
      console.log(`Total feedback entries: ${output.total_feedback}`);
      console.log('');

      if (output.feedback_type_breakdown.length > 0) {
        console.log('--- Feedback Type Breakdown ---');
        for (const row of output.feedback_type_breakdown) {
          console.log(`  ${row.type}: ${row.count}`);
        }
        console.log('');
      }

      if (output.severity_breakdown.length > 0) {
        console.log('--- Severity Distribution ---');
        for (const row of output.severity_breakdown) {
          console.log(`  ${row.severity}: ${row.count}`);
        }
        console.log('');
      }

      if (output.misclassified_intents.length > 0) {
        console.log('--- Misclassified Intents ---');
        for (const row of output.misclassified_intents) {
          console.log(`  ${row.correct_intent} (triggered as '${row.original_trigger}'): ${row.count}x`);
        }
        console.log('');
      }

      if (recommendations.length > 0) {
        console.log('--- Recommendations ---');
        for (const rec of recommendations) {
          console.log(`  [${rec.priority.toUpperCase()}] ${rec.message}`);
        }
      } else {
        console.log('No actionable recommendations at this time.');
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
