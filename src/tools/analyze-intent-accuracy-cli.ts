/**
 * CLI: Intent Accuracy Distribution Analysis (US-359)
 *
 * Usage:
 * npm run analyze:intent-accuracy -- --profile pelangi --intent booking
 * npm run analyze:intent-accuracy -- --profile pelangi
 *
 * Outputs:
 * - Distribution stats (p50, p95, p99, min, max, mean, sample count)
 * - 5 lowest-confidence misclassified messages for the intent
 */

import { db } from '../lib/db.js';
import { intentPredictions } from '../../shared/schema.js';
import { eq, and, lte } from 'drizzle-orm';
import { calculateConfidencePercentiles } from '../lib/analytics/confidence-percentile.js';

/**
 * Parse CLI arguments from process.argv
 * Looks for --profile VALUE and --intent VALUE
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const params: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        params[key] = value;
        i++;
      }
    }
  }

  return params;
}

/**
 * Fetch misclassified predictions for an intent
 * Returns 5 lowest-confidence incorrect predictions
 */
async function getLowConfidenceMisclassifications(
  profileId: string,
  intentType: string,
  limit: number = 5
) {
  // Fetch predictions that were misclassified (wasCorrect = false)
  // for this profile/intent combination, sorted by confidence ASC
  const rows = await db
    .select({
      id: intentPredictions.id,
      messageText: intentPredictions.messageText,
      predictedIntent: intentPredictions.predictedIntent,
      confidence: intentPredictions.confidence,
      actualIntent: intentPredictions.actualIntent,
      phoneNumber: intentPredictions.phoneNumber,
      createdAt: intentPredictions.createdAt,
    })
    .from(intentPredictions)
    .where(
      and(
        eq(intentPredictions.profile, profileId),
        eq(intentPredictions.predictedIntent, intentType),
        eq(intentPredictions.wasCorrect, false)
      )
    )
    .orderBy(intentPredictions.confidence)
    .limit(limit);

  return rows;
}

/**
 * Fetch all confidence scores for an intent in a profile
 */
async function getConfidenceDistribution(profileId: string, intentType: string | null) {
  const conditions = [eq(intentPredictions.profile, profileId)];
  if (intentType) {
    conditions.push(eq(intentPredictions.predictedIntent, intentType));
  }

  const rows = await db
    .select({
      confidence: intentPredictions.confidence,
      predictedIntent: intentPredictions.predictedIntent,
    })
    .from(intentPredictions)
    .where(and(...conditions))
    .orderBy(intentPredictions.confidence);

  return rows;
}

/**
 * Main CLI handler
 */
async function main() {
  const params = parseArgs();
  const profileId = params.profile;
  const intentType = params.intent || null;

  if (!profileId) {
    console.error('ERROR: --profile is required');
    console.error('Usage: npm run analyze:intent-accuracy -- --profile pelangi [--intent booking]');
    process.exit(1);
  }

  try {
    // Fetch distribution data
    const rows = await getConfidenceDistribution(profileId, intentType);

    if (rows.length === 0) {
      console.log(`No data found for profile "${profileId}"${intentType ? ` and intent "${intentType}"` : ''}`);
      process.exit(0);
    }

    // Group by intent if not filtering by specific intent
    const byIntent = new Map<string, number[]>();
    for (const row of rows) {
      if (!byIntent.has(row.predictedIntent)) {
        byIntent.set(row.predictedIntent, []);
      }
      byIntent.get(row.predictedIntent)!.push(row.confidence);
    }

    // Calculate and display stats
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Intent Accuracy Distribution Analysis — Profile: ${profileId}`);
    console.log(`${'='.repeat(70)}\n`);

    if (intentType && byIntent.has(intentType)) {
      // Single intent analysis
      const confidences = byIntent.get(intentType)!;
      const stats = calculateConfidencePercentiles(confidences);

      console.log(`Intent: ${intentType}`);
      console.log(`\nConfidence Distribution Stats:`);
      console.log(`  Sample Count:    ${stats.sampleCount}`);
      console.log(`  Min:             ${stats.min.toFixed(4)}`);
      console.log(`  Max:             ${stats.max.toFixed(4)}`);
      console.log(`  Mean:            ${stats.mean.toFixed(4)}`);
      console.log(`  p50 (median):    ${stats.p50.toFixed(4)}`);
      console.log(`  p95:             ${stats.p95.toFixed(4)}`);
      console.log(`  p99:             ${stats.p99.toFixed(4)}`);

      // Fetch lowest-confidence misclassifications
      console.log(`\nLowest-Confidence Misclassified Messages (top 5):`);
      const misclassifications = await getLowConfidenceMisclassifications(profileId, intentType, 5);

      if (misclassifications.length === 0) {
        console.log('  (No misclassifications found)');
      } else {
        misclassifications.forEach((msg, idx) => {
          console.log(`\n  ${idx + 1}. [Confidence: ${msg.confidence.toFixed(4)}] [Predicted: ${msg.predictedIntent}] [Actual: ${msg.actualIntent}]`);
          console.log(`     Message: "${msg.messageText.substring(0, 100)}${msg.messageText.length > 100 ? '...' : ''}"`);
          console.log(`     Phone: ${msg.phoneNumber}, Date: ${new Date(msg.createdAt).toISOString().split('T')[0]}`);
        });
      }
    } else {
      // All intents in profile
      console.log(`Intents in Profile:\n`);

      const intents = Array.from(byIntent.entries()).sort((a, b) => b[1].length - a[1].length);

      for (const [intent, confidences] of intents) {
        const stats = calculateConfidencePercentiles(confidences);
        console.log(`  ${intent}`);
        console.log(`    Samples: ${stats.sampleCount}, Mean: ${stats.mean.toFixed(4)}, p50: ${stats.p50.toFixed(4)}, p95: ${stats.p95.toFixed(4)}, p99: ${stats.p99.toFixed(4)}`);
      }
    }

    console.log(`\n${'='.repeat(70)}\n`);
  } catch (err: any) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

main();
