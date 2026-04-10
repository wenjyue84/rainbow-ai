#!/usr/bin/env tsx
/**
 * US-392: Fallback Response Tone Validator CLI
 *
 * Usage:
 *   npx tsx src/tools/validate-response-tone-cli.ts --profile data-makan --output tone-report.json
 *   npx tsx src/tools/validate-response-tone-cli.ts --profile data-pelangi --suggest-fixes
 *   npm run validate:response-tone -- --profile data-makan --output tone-report.json --suggest-fixes
 *
 * Flags:
 *   --profile <name>      Profile to analyze (required)
 *   --output <file>       Output JSON file path (default: stdout)
 *   --suggest-fixes       Generate suggestions file (tone-suggestions.json)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildToneReport,
  buildSuggestionsReport,
  type ToneReport,
  type ToneSuggestionsReport,
} from './validate-response-tone.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  profile: string;
  output?: string;
  suggestFixes: boolean;
} {
  let profile = '';
  let output: string | undefined;
  let suggestFixes = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--profile' && argv[i + 1]) {
      profile = argv[++i];
    } else if (argv[i] === '--output' && argv[i + 1]) {
      output = argv[++i];
    } else if (argv[i] === '--suggest-fixes') {
      suggestFixes = true;
    }
  }

  if (!profile) {
    console.error('Error: --profile is required');
    console.error('Usage: npx tsx src/tools/validate-response-tone-cli.ts --profile data-makan [--output tone-report.json] [--suggest-fixes]');
    process.exit(1);
  }

  return { profile, output, suggestFixes };
}

// ---------------------------------------------------------------------------
// Profile & data loading
// ---------------------------------------------------------------------------

function normalizeProfile(raw: string): string {
  // Strip 'data-' prefix if present
  return raw.startsWith('data-') ? raw.slice(5) : raw;
}

function loadKnowledge(profile: string): Array<{
  intent: string;
  response: { en?: string; ms?: string; zh?: string };
}> {
  const profileName = normalizeProfile(profile);

  // Try profile-specific directory first, then fall back to shared data
  const candidates = [
    path.join(rootDir, 'src', 'assistant', `data-${profileName}`, 'knowledge.json'),
    path.join(rootDir, 'src', 'assistant', 'data', 'knowledge.json'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf-8');
        const data = JSON.parse(content);

        // Extract static responses
        if (data.static && Array.isArray(data.static)) {
          return data.static;
        }

        return [];
      } catch (err) {
        console.error(`Error loading knowledge from ${p}:`, (err as Error).message);
        continue;
      }
    }
  }

  console.error(`Error: Could not find knowledge.json for profile: ${profile}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const { profile, output, suggestFixes } = parseArgs(process.argv.slice(2));

  // Load knowledge base
  const knowledge = loadKnowledge(profile);

  // Build report
  const report: ToneReport = buildToneReport(profile, knowledge);
  report.outputPath = output;

  // Output tone report
  if (output) {
    fs.writeFileSync(output, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`✅ Tone report written to: ${output}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  // Generate suggestions if requested
  if (suggestFixes) {
    const suggestionsReport: ToneSuggestionsReport = buildSuggestionsReport(
      profile,
      report.dismissiveSummary,
    );

    const suggestionsPath = output
      ? path.join(path.dirname(output), 'tone-suggestions.json')
      : 'tone-suggestions.json';

    fs.writeFileSync(suggestionsPath, JSON.stringify(suggestionsReport, null, 2), 'utf-8');
    console.log(`✅ Suggestions written to: ${suggestionsPath}`);
  }

  // Print summary to console
  console.log('\n📊 Tone Validation Summary:');
  console.log(`Profile: ${profile}`);
  console.log(`Total intents analyzed: ${report.totalIntents}`);
  console.log(`Total responses analyzed: ${report.totalResponses}`);
  console.log(`Flagged intents: ${report.flaggedIntents.length}`);
  console.log(`Dismissive patterns found: ${report.dismissiveSummary.length}`);

  console.log('\n📈 Group Distribution:');
  for (const [groupName, groupData] of Object.entries(report.groupDistribution)) {
    console.log(
      `  ${groupName}: avg sentiment ${groupData.avgSentiment.toFixed(2)}, ` +
      `${groupData.dismissiveCount} dismissive patterns, ${groupData.responseCount} responses`,
    );
  }

  if (report.flaggedIntents.length > 0) {
    console.log('\n⚠️  Flagged intents:');
    for (const intent of report.flaggedIntents.slice(0, 10)) {
      console.log(
        `  ${intent.intent} (group: ${intent.groupName}): ` +
        `sentiment ${intent.avgSentiment.toFixed(2)}, ` +
        `dismissive ${intent.dismissiveCount}`,
      );
    }
  }
}

main();
