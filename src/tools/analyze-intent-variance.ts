/**
 * Analyze Intent Confidence Variance CLI Tool
 *
 * Computes variance statistics for intent classification confidence scores
 * and identifies intents with high variance (>0.15 CV) requiring keyword refinement.
 *
 * Usage:
 *   npx tsx src/tools/analyze-intent-variance.ts [options]
 *   npm run analyze:intent-variance -- --output=variance.csv --min-samples=50
 *
 * Options:
 *   --output=FILE        Output filename (default: variance.csv for CSV, stdout for JSON/text)
 *   --min-samples=N      Minimum samples per intent (default: 50)
 *   --profile=ID         Filter by profile ID (optional)
 *   --since-days=N       Time window in days (default: 90)
 *   --format=FORMAT      Output format: csv (default), json, text
 *
 * Exit codes:
 *   0 — All intents stable (CV <= 0.15)
 *   1 — Unstable intents detected (CV > 0.15)
 *   2 — Error during analysis
 */

import { calculateIntentVariance, flagUnstableIntents, formatVarianceAsCSV, formatVarianceReport } from '../lib/intent-confidence-variance.js';
import { dbReady } from '../lib/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

interface CliOptions {
  output?: string;
  minSamples: number;
  profile?: string;
  sinceDays: number;
  format: 'csv' | 'json' | 'text';
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    minSamples: 50,
    sinceDays: 90,
    format: 'csv',
  };

  for (const arg of args) {
    if (arg.startsWith('--output=')) {
      options.output = arg.substring(9);
    } else if (arg.startsWith('--min-samples=')) {
      options.minSamples = Math.max(10, parseInt(arg.substring(14), 10));
    } else if (arg.startsWith('--profile=')) {
      options.profile = arg.substring(10);
    } else if (arg.startsWith('--since-days=')) {
      options.sinceDays = Math.max(1, parseInt(arg.substring(13), 10));
    } else if (arg.startsWith('--format=')) {
      const fmt = arg.substring(9).toLowerCase();
      if (fmt === 'csv' || fmt === 'json' || fmt === 'text') {
        options.format = fmt;
      }
    }
  }

  return options;
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function formatAsJSON(report: any): string {
  return JSON.stringify(report, null, 2);
}

function formatAsText(report: any): string {
  return formatVarianceReport(report);
}

function formatAsCSV(report: any): string {
  return formatVarianceAsCSV(report.intents);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs();

  try {
    // Check database connection
    const isConnected = await dbReady;
    if (!isConnected) {
      console.error('ERROR: Database connection not available');
      process.exit(2);
    }

    // Compute variance statistics
    console.error(`Analyzing intent confidence variance (min ${options.minSamples} samples, ${options.sinceDays} days)...`);

    const report = await calculateIntentVariance({
      minSamples: options.minSamples,
      profileId: options.profile,
      sinceDays: options.sinceDays,
    });

    // Format output
    let output: string;
    switch (options.format) {
      case 'json':
        output = formatAsJSON(report);
        break;
      case 'text':
        output = formatAsText(report);
        break;
      case 'csv':
      default:
        output = formatAsCSV(report);
        break;
    }

    // Write output
    if (options.output) {
      // Ensure output directory exists
      const outputDir = path.dirname(options.output);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      fs.writeFileSync(options.output, output, 'utf-8');
      console.error(`✓ Wrote ${options.format.toUpperCase()} report to ${options.output}`);
    } else {
      console.log(output);
    }

    // Summary stats
    const unstable = flagUnstableIntents(report.intents, { cvThreshold: 0.15 });
    console.error('');
    console.error(`Summary:`);
    console.error(`  Total intents: ${report.totalIntents}`);
    console.error(`  Analyzed (>= ${options.minSamples} samples): ${report.intentsAnalyzed}`);
    console.error(`  Unstable (CV > 0.15): ${unstable.length}`);

    if (unstable.length > 0) {
      console.error('');
      console.error('Unstable intents requiring keyword review:');
      for (const s of unstable.slice(0, 10)) {
        console.error(`  • ${s.intent} (CV=${s.coefficientOfVariation.toFixed(3)}, n=${s.sampleCount})`);
      }
      if (unstable.length > 10) {
        console.error(`  ... and ${unstable.length - 10} more`);
      }
    }

    // Exit with appropriate code
    process.exit(unstable.length > 0 ? 1 : 0);
  } catch (error) {
    console.error('ERROR during analysis:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(2);
  }
}

main();
