#!/usr/bin/env tsx
/**
 * US-291: Booking Workflow Failure Hotspot Analyzer
 *
 * Analyzes booking_execution_audit table to identify which steps fail most
 * frequently and groups failure reasons. Helps prioritize workflow improvements.
 *
 * Usage:
 *   npm run analytics:booking-failures -- --profile=pelangi --days=7
 *   npx tsx src/tools/analytics-booking-failures-cli.ts --profile=pelangi --since=7d
 *   npx tsx src/tools/analytics-booking-failures-cli.ts --profile=southern
 *
 * Exit codes:
 *   0 — Analysis complete (even if no failures found)
 *   1 — Error (DB connection, invalid profile, etc.)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import {
  extractFailureReason,
  calculateFailureMetrics,
  type StepFailureAnalysis,
  type FailureReasonCount,
} from '../routes/admin/analytics-booking-failures.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALID_PROFILES = ['pelangi', 'southern', 'makan'];

// ─── Types ─────────────────────────────────────────────────────────────

interface BookingExecRow {
  step_name: string;
  status: string;
  output: Record<string, unknown> | null;
}

interface AnalyticsOutput {
  timestamp: string;
  profile: string;
  days_analyzed: number;
  total_steps_executed: number;
  data: StepFailureAnalysis;
}

// ─── Formatters ────────────────────────────────────────────────────────

function formatHumanReport(output: AnalyticsOutput): string {
  const lines: string[] = [];
  lines.push('=== Booking Workflow Failure Hotspot Analysis ===');
  lines.push(`Generated: ${output.timestamp}`);
  lines.push(`Profile: ${output.profile}`);
  lines.push(`Days analyzed: ${output.days_analyzed}`);
  lines.push(`Total steps executed: ${output.total_steps_executed}`);
  lines.push('');

  if (Object.keys(output.data).length === 0) {
    lines.push('No booking step executions found in the specified time period.');
    return lines.join('\n');
  }

  lines.push('Steps sorted by failure rate (highest first):');
  lines.push('');

  for (const [stepName, metrics] of Object.entries(output.data)) {
    lines.push(`Step: "${stepName}"`);
    lines.push(`  Failures: ${metrics.failures} / ${metrics.attempts}`);
    lines.push(`  Failure Rate: ${metrics.rate}`);
    if (metrics.top_reasons.length > 0) {
      lines.push(`  Top failure reasons:`);
      for (const reason of metrics.top_reasons) {
        lines.push(`    - ${reason.reason}: ${reason.count} occurrence(s)`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── DB Query ──────────────────────────────────────────────────────────

async function fetchBookingExecutions(
  days: number
): Promise<BookingExecRow[]> {
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

    const result = await pool.query<BookingExecRow>(
      `SELECT step_name, status, output
       FROM booking_execution_audit
       WHERE executed_at >= $1
       ORDER BY executed_at DESC`,
      [cutoff.toISOString()]
    );

    return result.rows;
  } finally {
    await pool.end();
  }
}

// ─── Analysis Logic ───────────────────────────────────────────────────

function analyzeExecutions(rows: BookingExecRow[]): {
  analysis: StepFailureAnalysis;
  totalExecuted: number;
} {
  const stepMap = new Map<string, {
    attempts: number;
    failures: number;
    reasons: Map<string, number>;
  }>();

  for (const row of rows) {
    const stepName = row.step_name;
    if (!stepMap.has(stepName)) {
      stepMap.set(stepName, {
        attempts: 0,
        failures: 0,
        reasons: new Map(),
      });
    }

    const entry = stepMap.get(stepName)!;
    entry.attempts += 1;

    if (row.status === 'error' || row.status === 'timeout') {
      entry.failures += 1;

      // Extract failure reason
      const reason = extractFailureReason(row.output);
      entry.reasons.set(reason, (entry.reasons.get(reason) ?? 0) + 1);
    }
  }

  // Build analysis
  const analysis: StepFailureAnalysis = {};
  for (const [stepName, data] of stepMap) {
    const failureReasons: FailureReasonCount[] = Array.from(data.reasons.entries())
      .map(([reason, count]) => ({ reason, count }));

    analysis[stepName] = calculateFailureMetrics(
      data.failures,
      data.attempts,
      failureReasons
    );
  }

  // Sort by failure_rate descending
  const sorted = Object.entries(analysis)
    .sort(([, a], [, b]) => {
      const aRate = parseFloat(a.rate);
      const bRate = parseFloat(b.rate);
      return bRate - aRate;
    })
    .reduce((acc, [k, v]) => {
      acc[k] = v;
      return acc;
    }, {} as StepFailureAnalysis);

  return {
    analysis: sorted,
    totalExecuted: rows.length,
  };
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const profileArg = args.find(a => a.startsWith('--profile='))?.split('=')[1] || 'pelangi';
  const daysArg = parseInt(
    args.find(a => a.startsWith('--days=') || a.startsWith('--since='))
      ?.split('=')[1]
      ?.replace('d', '') || '7',
    10
  );
  const jsonMode = args.includes('--json');

  if (!VALID_PROFILES.includes(profileArg)) {
    console.error(`[ERROR] Unknown profile: ${profileArg}`);
    console.error(`Valid profiles: ${VALID_PROFILES.join(', ')}`);
    process.exit(1);
  }

  if (isNaN(daysArg) || daysArg < 1) {
    console.error('[ERROR] --days/--since must be a positive integer or number with "d" suffix');
    process.exit(1);
  }

  let rows: BookingExecRow[];
  try {
    rows = await fetchBookingExecutions(daysArg);
  } catch (err: any) {
    console.error(`[ERROR] Failed to query booking_execution_audit: ${err.message}`);
    process.exit(1);
  }

  const { analysis, totalExecuted } = analyzeExecutions(rows);

  const output: AnalyticsOutput = {
    timestamp: new Date().toISOString(),
    profile: profileArg,
    days_analyzed: daysArg,
    total_steps_executed: totalExecuted,
    data: analysis,
  };

  if (jsonMode) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatHumanReport(output));
  }
}

main();
