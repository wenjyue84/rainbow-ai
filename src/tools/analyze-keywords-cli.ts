#!/usr/bin/env node

/**
 * CLI tool for keyword frequency analysis
 *
 * Usage:
 *   npm run analyze:keywords -- --profile=southern --output=keywords.csv
 *   npm run analyze:keywords -- --profile=pelangi --format=json
 *   npm run validate:keyword-isolation
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  analyzeKeywordFrequency,
  detectCrossProfileContamination,
  formatKeywordFrequencyAsCSV,
  formatContaminationReport,
  formatContaminationReportAsJSON,
} from './analytics/keyword-frequency-analyzer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface CLIOptions {
  profile?: string;
  output?: string;
  format?: 'csv' | 'json' | 'text';
  profilesForValidation?: string[];
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {};

  for (const arg of args) {
    if (arg.startsWith('--profile=')) {
      options.profile = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      options.output = arg.split('=')[1];
    } else if (arg.startsWith('--format=')) {
      options.format = (arg.split('=')[1] as any) || 'text';
    }
  }

  return options;
}

function analyzeKeywords(options: CLIOptions): void {
  const profile = options.profile || 'pelangi';
  const format = options.format || 'text';

  console.error(`[INFO] Analyzing keywords for profile: ${profile}`);
  console.error(`[INFO] Output format: ${format}`);

  try {
    const report = analyzeKeywordFrequency(profile, { minKeywordOccurrences: 1 });

    let output = '';

    if (format === 'csv') {
      output = formatKeywordFrequencyAsCSV(report);
    } else if (format === 'json') {
      output = JSON.stringify(report, null, 2);
    } else {
      // text format
      output = `Keyword Frequency Report for Profile: ${profile}\n`;
      output += `Generated: ${report.timestamp}\n`;
      output += `Total Keywords Analyzed: ${report.totalKeywords}\n`;
      output += `Total Intents: ${report.totalIntents}\n`;
      output += `Unstable Keywords (precision < 0.5): ${report.unstableKeywords.length}\n\n`;
      output += `=== Top Keywords by Precision ===\n`;
      report.keywords.slice(0, 20).forEach(k => {
        output += `${k.keyword.padEnd(20)} | Intent: ${k.intent.padEnd(15)} | Precision: ${k.precision.toFixed(2)} | Recall: ${k.recall.toFixed(2)}\n`;
      });

      if (report.unstableKeywords.length > 0) {
        output += `\n=== UNSTABLE KEYWORDS (Need Review) ===\n`;
        report.unstableKeywords.forEach(k => {
          output += `${k.keyword.padEnd(20)} | Intent: ${k.intent.padEnd(15)} | Precision: ${k.precision.toFixed(2)}\n`;
        });
      }
    }

    // Write output
    if (options.output) {
      fs.writeFileSync(options.output, output, 'utf-8');
      console.error(`[INFO] Report written to: ${options.output}`);
    } else {
      console.log(output);
    }

    process.exit(0);
  } catch (error) {
    console.error('[ERROR] Keyword analysis failed:', error);
    process.exit(2);
  }
}

function validateKeywordIsolation(
  profiles: string[] = ['pelangi', 'southern', 'makan']
): void {
  console.error(`[INFO] Validating keyword isolation across profiles: ${profiles.join(', ')}`);

  try {
    const report = detectCrossProfileContamination(profiles);

    const output = formatContaminationReport(report);
    console.log(output);

    // Write JSON report for programmatic access
    const jsonReport = formatContaminationReportAsJSON(report);
    const jsonPath = 'keyword-contamination-report.json';
    fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf-8');
    console.error(`[INFO] JSON report written to: ${jsonPath}`);

    // Exit code based on contamination severity
    if (report.criticalContamination.length > 0) {
      console.error(
        `[CRITICAL] Found ${report.criticalContamination.length} critical contamination issues`
      );
      process.exit(1);
    } else if (report.contaminatedKeywords.length > 0) {
      console.error(
        `[WARNING] Found ${report.contaminatedKeywords.length} contaminated keywords`
      );
      process.exit(0); // Exit 0 but warn
    } else {
      console.error('[SUCCESS] No cross-profile keyword contamination detected');
      process.exit(0);
    }
  } catch (error) {
    console.error('[ERROR] Keyword isolation validation failed:', error);
    process.exit(2);
  }
}

// Main execution
const command = process.argv[2];

if (command === 'validate:keyword-isolation') {
  validateKeywordIsolation();
} else {
  // Default: analyze keywords
  const options = parseArgs();
  analyzeKeywords(options);
}
