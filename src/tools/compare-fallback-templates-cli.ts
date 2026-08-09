#!/usr/bin/env tsx
/**
 * US-285: Fallback Response Template A/B Test Analysis CLI
 *
 * Compares two fallback response templates for the same intent,
 * measuring booking conversion rate and escalation rate.
 *
 * Usage:
 *   npx tsx src/tools/compare-fallback-templates-cli.ts --intent=booking --profile=pelangi --days=30 --template-a=first_fallback --template-b=repeated_fallback
 *   npm run compare:templates -- --intent=booking --profile=pelangi --days=30 --template-a=first_fallback --template-b=repeated_fallback
 *
 * Exit codes:
 *   0 — Comparison successful
 *   1 — Error (DB connection, invalid params, etc.)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { compareTemplates, type ComparisonResult } from './compare-fallback-templates.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

const VALID_PROFILES = ['pelangi', 'makan', 'southern'];

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

function parseArgs(): {
  intent: string;
  profile: string;
  days: number;
  templateA: string;
  templateB: string;
} {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=');
      parsed[key] = value || 'true';
    }
  }

  const intent = parsed['intent'];
  const profile = parsed['profile'] || 'pelangi';
  const days = parseInt(parsed['days'] || '30', 10);
  const templateA = parsed['template-a'] || 'first_fallback';
  const templateB = parsed['template-b'] || 'repeated_fallback';

  if (!intent) {
    throw new Error('--intent is required');
  }

  if (!VALID_PROFILES.includes(profile)) {
    throw new Error(
      `--profile must be one of: ${VALID_PROFILES.join(', ')} (got: ${profile})`,
    );
  }

  if (isNaN(days) || days <= 0) {
    throw new Error(`--days must be a positive number (got: ${parsed['days']})`);
  }

  return { intent, profile, days, templateA, templateB };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatJsonOutput(result: ComparisonResult): string {
  return JSON.stringify(result, null, 2);
}

function formatHumanOutput(result: ComparisonResult): string {
  const lines: string[] = [];
  lines.push('=== Fallback Template Comparison Report ===');
  lines.push(`Generated: ${result.timestamp}`);
  lines.push(`Intent: ${result.intent}`);
  lines.push(`Profile: ${result.profile}`);
  lines.push(`Days analyzed: ${result.days_analyzed}`);
  lines.push('');

  lines.push('--- Template A (Control) ---');
  lines.push(`Name: ${result.template_a.template}`);
  lines.push(`Conversations: ${result.template_a.total_conversations}`);
  lines.push(`Booking conversions: ${result.template_a.booking_conversions}`);
  lines.push(`Booking rate: ${(result.template_a.booking_rate * 100).toFixed(2)}%`);
  lines.push(`Escalations: ${result.template_a.escalations}`);
  lines.push(`Escalation rate: ${(result.template_a.escalation_rate * 100).toFixed(2)}%`);
  lines.push('');

  lines.push('--- Template B (Variant) ---');
  lines.push(`Name: ${result.template_b.template}`);
  lines.push(`Conversations: ${result.template_b.total_conversations}`);
  lines.push(`Booking conversions: ${result.template_b.booking_conversions}`);
  lines.push(`Booking rate: ${(result.template_b.booking_rate * 100).toFixed(2)}%`);
  lines.push(`Escalations: ${result.template_b.escalations}`);
  lines.push(`Escalation rate: ${(result.template_b.escalation_rate * 100).toFixed(2)}%`);
  lines.push('');

  lines.push('--- Analysis ---');
  lines.push(`Winner: ${result.winner}`);
  lines.push(
    `Booking advantage: ${(result.details.template_a_booking_advantage * 100).toFixed(2)}%`,
  );
  lines.push(
    `Escalation difference: ${(result.details.template_a_escalation_disadvantage * 100).toFixed(2)}%`,
  );
  lines.push(
    `Statistical significance (p-value): ${result.statistical_significance.toFixed(4)}`,
  );
  lines.push(
    `Significant? ${result.statistical_significance < 0.05 ? 'Yes (p < 0.05)' : 'No (p >= 0.05)'}`,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// DB pool setup
// ---------------------------------------------------------------------------

function createPool(): pg.Pool {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  return new pg.Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
    max: 2,
    idleTimeoutMillis: 5000,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const pool = createPool();

  try {
    const args = parseArgs();
    const result = await compareTemplates(
      pool,
      args.intent,
      args.templateA,
      args.templateB,
      args.profile,
      args.days,
    );

    console.log(formatJsonOutput(result));
    console.error(formatHumanOutput(result));

    process.exit(0);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
