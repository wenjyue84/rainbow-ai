/**
 * analyze-intent-feedback.ts — US-602 CLI
 *
 * Reads intent_classification_feedback table (or dry-run sample data),
 * runs analyzeMisclassifications(), and outputs a JSON report of the
 * top 10 misclassified intents with keyword suggestions.
 *
 * Usage:
 *   npm run analyze:intent-feedback             # live DB query
 *   npm run analyze:intent-feedback -- --dry-run # sample data, no DB needed
 */

import { analyzeMisclassifications } from '../lib/intent-feedback-analyzer.js';
import type { MisclassificationEntry } from '../lib/intent-feedback-analyzer.js';

const isDryRun = process.argv.includes('--dry-run');

/** Generate sample feedback data for --dry-run mode */
function generateSampleData(): MisclassificationEntry[] {
  const now = new Date();
  const samples: MisclassificationEntry[] = [
    { predictedIntent: 'check_in', groundTruthIntent: 'booking_inquiry', feedbackTimestamp: now },
    { predictedIntent: 'check_in', groundTruthIntent: 'booking_inquiry', feedbackTimestamp: now },
    { predictedIntent: 'check_in', groundTruthIntent: 'booking_inquiry', feedbackTimestamp: now },
    { predictedIntent: 'check_in', groundTruthIntent: 'room_availability', feedbackTimestamp: now },
    { predictedIntent: 'check_in', groundTruthIntent: 'room_availability', feedbackTimestamp: now },
    { predictedIntent: 'payment_info', groundTruthIntent: 'receipt_request', feedbackTimestamp: now },
    { predictedIntent: 'payment_info', groundTruthIntent: 'receipt_request', feedbackTimestamp: now },
    { predictedIntent: 'payment_info', groundTruthIntent: 'receipt_request', feedbackTimestamp: now },
    { predictedIntent: 'payment_info', groundTruthIntent: 'invoice_request', feedbackTimestamp: now },
    { predictedIntent: 'greeting', groundTruthIntent: 'check_in', feedbackTimestamp: now },
    { predictedIntent: 'greeting', groundTruthIntent: 'check_in', feedbackTimestamp: now },
    { predictedIntent: 'farewell', groundTruthIntent: 'check_out', feedbackTimestamp: now },
    // Correct classifications (predicted == ground truth -- filtered out)
    { predictedIntent: 'booking_inquiry', groundTruthIntent: 'booking_inquiry', feedbackTimestamp: now },
    { predictedIntent: 'room_availability', groundTruthIntent: 'room_availability', feedbackTimestamp: now },
  ];
  return samples;
}

async function loadFeedbackFromDB(): Promise<MisclassificationEntry[]> {
  // Lazy import so dry-run mode works without DATABASE_URL
  const { getDb } = await import('../lib/db.js');
  const { intentClassificationFeedback } = await import('../../shared/tables/intent-analytics.js');
  const db = getDb();
  const rows = await db.select().from(intentClassificationFeedback);
  return rows.map((r) => ({
    predictedIntent: r.predictedIntent,
    groundTruthIntent: r.groundTruthIntent,
    feedbackTimestamp: r.feedbackTimestamp,
  }));
}

async function main() {
  let feedbackRecords: MisclassificationEntry[];

  if (isDryRun) {
    console.error('[analyze:intent-feedback] --dry-run: using sample data');
    feedbackRecords = generateSampleData();
  } else {
    console.error('[analyze:intent-feedback] querying intent_classification_feedback table...');
    feedbackRecords = await loadFeedbackFromDB();
  }

  const report = analyzeMisclassifications(feedbackRecords);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('[analyze:intent-feedback] error:', err);
  process.exit(1);
});
