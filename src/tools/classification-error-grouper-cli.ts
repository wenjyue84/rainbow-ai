/**
 * classification-error-grouper-cli.ts
 *
 * US-391: Intent Classification Error Pattern Grouper CLI
 *
 * Usage:
 *   npx tsx src/tools/classification-error-grouper-cli.ts \
 *     --profile data-pelangi --output errors.json
 *
 *   npx tsx src/tools/classification-error-grouper-cli.ts \
 *     --profile data-pelangi --input misclassifications.jsonl --output errors.json
 *
 * Profile naming: "data-pelangi" → internal profile "pelangi"
 *                 "data-southern" → internal profile "southern"
 *                 "pelangi" → "pelangi" (pass-through)
 *
 * Input format (JSONL — one JSON object per line):
 *   {"messageText":"I want to book","predictedIntent":"inquiry","actualIntent":"booking","confidence":0.62}
 *
 * Output: JSON file with ClassificationErrorReport structure.
 */

import fs from 'fs';
import path from 'path';
import {
  buildErrorReport,
  type MisclassificationRecord,
} from './classification-error-grouper.js';

// ── Arg parsing ────────────────────────────────────────────────────────────────

function parseArgs(): {
  profile: string;
  output: string;
  input: string | null;
  days: number;
} {
  const args = process.argv.slice(2);
  const params: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      params[key] = value;
    }
  }

  const profile = params['profile'];
  if (!profile) {
    console.error('Error: --profile is required (e.g. --profile data-pelangi)');
    process.exit(1);
  }

  return {
    profile,
    output: params['output'] ?? 'errors.json',
    input: params['input'] ?? null,
    days: parseInt(params['days'] ?? '7', 10),
  };
}

/** Normalise profile names like "data-pelangi" → "pelangi". */
function normaliseProfile(raw: string): string {
  return raw.replace(/^data-/, '');
}

// ── Input loading ──────────────────────────────────────────────────────────────

/** Parse JSONL content into MisclassificationRecord[]. */
function parseJsonl(content: string): MisclassificationRecord[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line, idx) => {
      try {
        return JSON.parse(line) as MisclassificationRecord;
      } catch {
        console.warn(`Warning: Could not parse line ${idx + 1}, skipping.`);
        return null;
      }
    })
    .filter((r): r is MisclassificationRecord => r !== null);
}

/** Load records from a JSONL file. */
function loadFromFile(filePath: string): MisclassificationRecord[] {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: Input file not found: ${resolved}`);
    process.exit(1);
  }
  const content = fs.readFileSync(resolved, 'utf-8');
  return parseJsonl(content);
}

/** Generate sample misclassification data when no input file is provided. */
function generateSampleData(profile: string): MisclassificationRecord[] {
  // Realistic sample data for demonstration / quick testing
  const pelangiSamples: MisclassificationRecord[] = [
    // boundary_confusion: booking vs availability
    { messageText: 'Do you have rooms for this weekend?', predictedIntent: 'booking', actualIntent: 'availability', confidence: 0.71 },
    { messageText: 'Any rooms free on Friday?', predictedIntent: 'booking', actualIntent: 'availability', confidence: 0.68 },
    { messageText: 'Is there space available tonight?', predictedIntent: 'booking', actualIntent: 'availability', confidence: 0.73 },
    { messageText: 'Can I book a capsule for 2 nights?', predictedIntent: 'availability', actualIntent: 'booking', confidence: 0.65 },
    // boundary_confusion: checkin_info vs check_in_arrival
    { messageText: 'What time is check in?', predictedIntent: 'check_in_arrival', actualIntent: 'checkin_info', confidence: 0.77 },
    { messageText: 'I will arrive at 3pm', predictedIntent: 'checkin_info', actualIntent: 'check_in_arrival', confidence: 0.69 },
    { messageText: 'What is the earliest I can check in?', predictedIntent: 'check_in_arrival', actualIntent: 'checkin_info', confidence: 0.74 },
    // false_positive: payment misclassified as booking
    { messageText: 'I sent the payment already', predictedIntent: 'booking', actualIntent: 'payment_made', confidence: 0.81 },
    { messageText: 'Transfer done, please confirm', predictedIntent: 'booking', actualIntent: 'payment_made', confidence: 0.78 },
    { messageText: 'I paid RM 120 via transfer', predictedIntent: 'booking', actualIntent: 'payment', confidence: 0.83 },
    // false_negative: unknown predicted
    { messageText: 'Bilik ada tak?', predictedIntent: 'unknown', actualIntent: 'availability', confidence: 0.21 },
    { messageText: 'Nak duduk 3 hari boleh?', predictedIntent: 'unknown', actualIntent: 'booking', confidence: 0.18 },
    { messageText: 'Aircond rosak la', predictedIntent: 'unknown', actualIntent: 'climate_control_complaint', confidence: 0.24 },
    // boundary_confusion: billing vs payment
    { messageText: 'How much is the total bill?', predictedIntent: 'payment', actualIntent: 'billing_inquiry', confidence: 0.72 },
    { messageText: 'What are the charges?', predictedIntent: 'payment_made', actualIntent: 'billing_inquiry', confidence: 0.66 },
    // false_positive: complaint misclassified
    { messageText: 'The shower is not working', predictedIntent: 'complaint', actualIntent: 'facility_malfunction', confidence: 0.79 },
    { messageText: 'My neighbour is too noisy', predictedIntent: 'complaint', actualIntent: 'noise_complaint', confidence: 0.76 },
  ];

  const southernSamples: MisclassificationRecord[] = [
    { messageText: 'Can I book a room?', predictedIntent: 'availability', actualIntent: 'booking', confidence: 0.70 },
    { messageText: 'Do you have vacancies?', predictedIntent: 'booking', actualIntent: 'availability', confidence: 0.67 },
    { messageText: 'I paid already', predictedIntent: 'booking', actualIntent: 'payment_made', confidence: 0.80 },
    { messageText: 'What time check in?', predictedIntent: 'check_in_arrival', actualIntent: 'checkin_info', confidence: 0.75 },
    { messageText: 'Rumah ada tak malam ni?', predictedIntent: 'unknown', actualIntent: 'availability', confidence: 0.20 },
  ];

  if (profile === 'southern') return southernSamples;
  return pelangiSamples;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { profile: rawProfile, output, input, days } = parseArgs();
  const profile = normaliseProfile(rawProfile);

  console.log(`\nIntent Classification Error Pattern Grouper`);
  console.log(`Profile: ${profile}  (raw: ${rawProfile})`);
  console.log(`Output:  ${output}`);
  if (input) console.log(`Input:   ${input}`);
  else console.log(`Input:   [sample data — pass --input <file.jsonl> for production logs]`);
  console.log('─'.repeat(50));

  // Load records
  const records: MisclassificationRecord[] = input
    ? loadFromFile(input)
    : generateSampleData(profile);

  if (records.length === 0) {
    console.log('No misclassification records found. Exiting.');
    process.exit(0);
  }

  console.log(`\nAnalysing ${records.length} misclassification records…`);

  // Build report
  const report = buildErrorReport(profile, records);

  // Print summary to console
  console.log(`\n── Summary ──────────────────────────────────────`);
  console.log(`Total misclassifications : ${report.totalMisclassifications}`);
  console.log(`Clusters found           : ${report.clusters.length}`);

  const typeCounts = { false_positive: 0, false_negative: 0, boundary_confusion: 0 };
  for (const c of report.clusters) typeCounts[c.errorType] += c.frequency;
  console.log(`  false_positive         : ${typeCounts.false_positive}`);
  console.log(`  false_negative         : ${typeCounts.false_negative}`);
  console.log(`  boundary_confusion     : ${typeCounts.boundary_confusion}`);

  console.log(`\n── Top Clusters ─────────────────────────────────`);
  for (const cluster of report.clusters.slice(0, 8)) {
    const { errorType, predictedIntent, actualIntent, frequency, confidenceRange } = cluster;
    console.log(
      `  [${errorType}] ${predictedIntent} → ${actualIntent}  ` +
      `freq=${frequency}  conf=[${confidenceRange.min}–${confidenceRange.max}]`
    );
    for (const ex of cluster.examples) {
      console.log(`    • "${ex}"`);
    }
  }

  console.log(`\n── Problematic Keyword Pairs ────────────────────`);
  for (const pair of report.problematicPairs.slice(0, 5)) {
    console.log(
      `  "${pair.intent1}" ↔ "${pair.intent2}"  confusions=${pair.confusionCount}`
    );
    if (pair.suggestedKeywords.length > 0) {
      console.log(`    Suggested keywords: ${pair.suggestedKeywords.join(', ')}`);
    }
  }

  if (Object.keys(report.keywordSuggestions).length > 0) {
    console.log(`\n── Keyword Suggestions (for intent-keywords.json) ─`);
    for (const [intent, kws] of Object.entries(report.keywordSuggestions)) {
      console.log(`  ${intent}: ${kws.join(', ')}`);
    }
  }

  // Write output JSON
  const outputPath = path.resolve(output);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n✓ Report written to: ${outputPath}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
