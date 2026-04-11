#!/usr/bin/env tsx
/**
 * US-426: Intent Classification Latency Monitor with Percentile Tracking
 *
 * Displays intent classification latency percentiles (p50, p95, p99) to identify
 * slow intents and performance bottlenecks.
 *
 * Usage:
 *   npm run analytics:intent-latency                          # All intents, pelangi profile
 *   npm run analytics:intent-latency -- booking                # booking intent, pelangi profile
 *   npm run analytics:intent-latency -- booking --profile=southern  # booking, southern profile
 *   npx tsx src/tools/analytics-intent-latency-cli.ts checkout --profile=pelangi
 *
 * Exit codes:
 *   0 — Analysis complete
 *   1 — Error (DB connection, invalid args, etc.)
 */

import dotenv from 'dotenv';
import { db } from '../lib/db.js';
import {
  getIntentLatencyPercentiles,
  getAllIntentLatencyPercentiles,
} from '../lib/monitoring/latency-tracker.js';

dotenv.config();

const VALID_PROFILES = ['pelangi', 'southern', 'makan'];

// ─── Parse CLI Arguments ───────────────────────────────────────────────

interface CliArgs {
  intent?: string;
  profile: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const intent = args[0];
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

  return { intent, profile };
}

// ─── Formatters ───────────────────────────────────────────────────────

function formatPercentileReport(
  intent: string | undefined,
  profile: string,
  metrics: Map<
    string,
    {
      p50: number | null;
      p95: number | null;
      p99: number | null;
      count: number;
      minLatency: number | null;
      maxLatency: number | null;
      avgLatency: number | null;
    }
  >
): string {
  const lines: string[] = [];
  lines.push('=== Intent Classification Latency Percentiles ===');
  lines.push(`Profile: ${profile}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  if (metrics.size === 0) {
    lines.push('No latency data found for the specified criteria.');
    return lines.join('\n');
  }

  // Sort by count (most frequent intents first)
  const sorted = Array.from(metrics.entries()).sort((a, b) => b[1].count - a[1].count);

  for (const [intentId, perc] of sorted) {
    lines.push(`Intent: "${intentId}"`);
    lines.push(`  Measurements: ${perc.count}`);
    if (perc.minLatency !== null) lines.push(`  Min latency: ${perc.minLatency.toFixed(2)}ms`);
    if (perc.avgLatency !== null) lines.push(`  Avg latency: ${perc.avgLatency.toFixed(2)}ms`);
    if (perc.maxLatency !== null) lines.push(`  Max latency: ${perc.maxLatency.toFixed(2)}ms`);
    if (perc.p50 !== null) lines.push(`  p50 (median): ${perc.p50.toFixed(2)}ms`);
    if (perc.p95 !== null) lines.push(`  p95 (95th %ile): ${perc.p95.toFixed(2)}ms`);
    if (perc.p99 !== null) lines.push(`  p99 (99th %ile): ${perc.p99.toFixed(2)}ms`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatJsonReport(
  intent: string | undefined,
  profile: string,
  metrics: Map<
    string,
    {
      p50: number | null;
      p95: number | null;
      p99: number | null;
      count: number;
      minLatency: number | null;
      maxLatency: number | null;
      avgLatency: number | null;
    }
  >
): string {
  const output: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    profile,
    intent: intent || 'all',
    metrics: {} as Record<string, unknown>,
  };

  for (const [intentId, perc] of metrics) {
    output.metrics[intentId] = {
      measurements: perc.count,
      min_latency_ms: perc.minLatency,
      avg_latency_ms: perc.avgLatency,
      max_latency_ms: perc.maxLatency,
      p50_ms: perc.p50,
      p95_ms: perc.p95,
      p99_ms: perc.p99,
    };
  }

  return JSON.stringify(output, null, 2);
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    const { intent, profile } = parseArgs();

    let metrics: Map<
      string,
      {
        p50: number | null;
        p95: number | null;
        p99: number | null;
        count: number;
        minLatency: number | null;
        maxLatency: number | null;
        avgLatency: number | null;
      }
    >;

    if (intent) {
      // Single intent query
      const singleMetrics = await getIntentLatencyPercentiles(intent, profile);
      metrics = new Map([[intent, singleMetrics]]);
    } else {
      // All intents for profile
      metrics = await getAllIntentLatencyPercentiles(profile);
    }

    // Output (use human-readable format by default)
    console.log(formatPercentileReport(intent, profile, metrics));

    // Also output JSON to file for programmatic access
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `intent-latency-report-${profile}-${timestamp}.json`;
    const fs = await import('fs');
    fs.writeFileSync(filename, formatJsonReport(intent, profile, metrics));
    console.log(`\nJSON report written to: ${filename}`);

    process.exit(0);
  } catch (err) {
    console.error('Error:', (err as Error).message);
    process.exit(1);
  }
}

main().catch(console.error);
