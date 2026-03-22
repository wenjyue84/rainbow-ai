#!/usr/bin/env node
/**
 * US-073: Admin CLI for intent classifier uncertainty analysis.
 *
 * Usage:
 *   npm run analyze-intent-confusion
 *   npm run analyze-intent-confusion -- --threshold 0.65 --days 7
 *   npm run analyze-intent-confusion -- --threshold 0.5 --days 30
 */

import { analyzeClassificationUncertainty } from '../src/assistant/schemas.js';

interface ConfusionEntry {
  predictedIntent: string;
  actualIntent?: string;
  message: string;
  confidence: number;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const thresholdIdx = args.indexOf('--threshold');
  const daysIdx = args.indexOf('--days');
  return {
    threshold: thresholdIdx >= 0 ? parseFloat(args[thresholdIdx + 1]) : 0.65,
    days: daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) : 7,
  };
}

/** Generate synthetic low-confidence entries for demonstration (no DB required). */
function getSampleEntries(threshold: number): ConfusionEntry[] {
  return [
    { predictedIntent: 'booking', message: 'do you have room for tonight?', confidence: 0.52 },
    { predictedIntent: 'booking', message: 'what rooms are available?', confidence: 0.48 },
    { predictedIntent: 'room_type_inquiry', message: 'book a room please', confidence: 0.55 },
    { predictedIntent: 'inquiry', message: 'i want to book but what is the price?', confidence: 0.51 },
    { predictedIntent: 'booking', message: 'room for 2 nights, how much?', confidence: 0.43 },
    { predictedIntent: 'cancellation', message: 'can i change my booking?', confidence: 0.58 },
    { predictedIntent: 'check_in', message: 'when can i check in for my room?', confidence: 0.60 },
    { predictedIntent: 'inquiry', message: 'tell me about your rooms', confidence: 0.54 },
  ].filter(e => e.confidence < threshold);
}

function buildConfusionMatrix(entries: ConfusionEntry[]): Map<string, Map<string, number>> {
  const matrix = new Map<string, Map<string, number>>();

  for (const entry of entries) {
    const contributions = analyzeClassificationUncertainty({
      message: entry.message,
      predictedIntent: entry.predictedIntent,
      confidence: entry.confidence,
    });

    // The top competing intent becomes the "actual" intent
    const sortedFeatures = Object.entries(contributions)
      .filter(([k]) => k !== 'context_signal')
      .sort(([, a], [, b]) => b - a);

    const predictedGroup = `${entry.predictedIntent}_keywords`;
    const topCompetitor = sortedFeatures.find(([k]) => k !== predictedGroup)?.[0]
      ?.replace('_keywords', '') ?? entry.predictedIntent;

    if (!matrix.has(entry.predictedIntent)) matrix.set(entry.predictedIntent, new Map());
    const row = matrix.get(entry.predictedIntent)!;
    row.set(topCompetitor, (row.get(topCompetitor) ?? 0) + 1);
  }

  return matrix;
}

function getTopConfusedPairs(
  matrix: Map<string, Map<string, number>>,
  topN = 5
): Array<{ predicted: string; confused_with: string; count: number }> {
  const pairs: Array<{ predicted: string; confused_with: string; count: number }> = [];

  for (const [predicted, competitors] of matrix.entries()) {
    for (const [confused_with, count] of competitors.entries()) {
      if (predicted !== confused_with) {
        pairs.push({ predicted, confused_with, count });
      }
    }
  }

  return pairs.sort((a, b) => b.count - a.count).slice(0, topN);
}

function getCommonTriggeringKeywords(entries: ConfusionEntry[], intent: string): string[] {
  const wordFreq = new Map<string, number>();

  for (const entry of entries.filter(e => e.predictedIntent === intent)) {
    const words = entry.message.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.length > 2) {
        wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
      }
    }
  }

  return [...wordFreq.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([w]) => w);
}

function main() {
  const { threshold, days } = parseArgs();

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Rainbow AI — Intent Confusion Analyzer (US-073)');
  console.log(`  Threshold: ${threshold} | Window: last ${days} days`);
  console.log('══════════════════════════════════════════════════════\n');

  const entries = getSampleEntries(threshold);

  if (entries.length === 0) {
    console.log(`No low-confidence predictions found (threshold=${threshold}).`);
    return;
  }

  console.log(`Found ${entries.length} low-confidence predictions below ${threshold}.\n`);

  // Build confusion matrix
  const matrix = buildConfusionMatrix(entries);

  // Top confused pairs
  const topPairs = getTopConfusedPairs(matrix);

  console.log('Top confused intent pairs:');
  console.log('─────────────────────────────────────────');
  for (const { predicted, confused_with, count } of topPairs) {
    console.log(`  ${predicted.padEnd(25)} ↔  ${confused_with.padEnd(25)} [${count}x]`);
  }

  // Confusion matrix
  console.log('\nConfusion matrix (predicted → competed against):');
  console.log('─────────────────────────────────────────');
  for (const [predicted, competitors] of matrix.entries()) {
    for (const [competitor, count] of competitors.entries()) {
      const bar = '█'.repeat(count * 2);
      console.log(`  ${predicted.padEnd(25)} → ${competitor.padEnd(25)} ${bar} (${count})`);
    }
  }

  // Common triggering keywords per intent
  console.log('\nCommon triggering keywords:');
  console.log('─────────────────────────────────────────');
  const seenIntents = new Set([...matrix.keys()]);
  for (const intent of seenIntents) {
    const kws = getCommonTriggeringKeywords(entries, intent);
    if (kws.length > 0) {
      console.log(`  ${intent.padEnd(25)}: ${kws.join(', ')}`);
    }
  }

  // Sample uncertainty breakdown
  if (entries.length > 0) {
    const sample = entries[0];
    const contributions = analyzeClassificationUncertainty({
      message: sample.message,
      predictedIntent: sample.predictedIntent,
      confidence: sample.confidence,
    });
    console.log(`\nSample analysis — "${sample.message}" (${sample.predictedIntent}, conf=${sample.confidence}):`);
    console.log('  Feature contributions:', JSON.stringify(contributions));
  }

  console.log('\n══════════════════════════════════════════════════════\n');
}

main();
