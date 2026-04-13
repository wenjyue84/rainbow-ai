/**
 * Intent Accuracy Scorer - US-588
 *
 * Computes confusion matrices from intent prediction feedback data.
 * Generates accuracy reports per intent, identifies low-accuracy intents,
 * and ranks frequent misclassification pairs.
 */

/**
 * Feedback record with predicted and actual intent
 */
export interface FeedbackRecord {
  predictedIntent: string | null | undefined;
  actualIntent: string | null | undefined;
}

/**
 * Single row of confusion matrix
 */
export interface ConfusionMatrixRow {
  actualIntent: string;
  predictions: Record<string, number>; // predicted intent -> count
  totalSamples: number;
  correctCount: number;
  accuracy: number; // 0-100
}

/**
 * Misclassification pair with count
 */
export interface MisclassificationPair {
  from: string; // actual intent
  to: string; // predicted intent
  count: number;
}

/**
 * Complete confusion matrix report
 */
export interface ConfusionMatrixReport {
  profile: string;
  timestamp: string;
  totalSamples: number;
  matrix: ConfusionMatrixRow[];
  intentAccuracy: Record<string, number>; // intent -> accuracy (0-100)
  lowAccuracyIntents: string[]; // intents with <75% accuracy
  topMisclassificationPairs: MisclassificationPair[]; // top 5 misclassification pairs
}

/**
 * Compute confusion matrix from feedback records
 *
 * AC1: Groups feedback by actual intent, tracks predictions
 * AC2: Calculates per-intent accuracy and identifies low-accuracy intents (<75%)
 * AC3: Ranks misclassification pairs by frequency
 */
export function computeConfusionMatrix(
  feedbackData: FeedbackRecord[],
  profile: string
): ConfusionMatrixReport {
  // Filter out records with missing intents
  const validFeedback = feedbackData.filter(
    (f) => f.predictedIntent && f.actualIntent && typeof f.predictedIntent === 'string' && typeof f.actualIntent === 'string'
  );

  // Build confusion matrix: actualIntent -> { predictedIntent -> count }
  const matrixMap = new Map<string, Map<string, number>>();

  const misclassificationPairs = new Map<string, number>();

  for (const record of validFeedback) {
    const actual = record.actualIntent!;
    const predicted = record.predictedIntent!;

    // Initialize actual intent row if not exists
    if (!matrixMap.has(actual)) {
      matrixMap.set(actual, new Map());
    }

    // Increment count for this prediction
    const row = matrixMap.get(actual)!;
    row.set(predicted, (row.get(predicted) || 0) + 1);

    // Track misclassifications (if predicted != actual)
    if (predicted !== actual) {
      const pairKey = `${actual}|${predicted}`;
      misclassificationPairs.set(pairKey, (misclassificationPairs.get(pairKey) || 0) + 1);
    }
  }

  // Convert matrix map to array and calculate accuracies
  const matrix: ConfusionMatrixRow[] = [];
  const intentAccuracy: Record<string, number> = {};
  const lowAccuracyIntents: string[] = [];

  for (const [actualIntent, predictions] of matrixMap) {
    const totalSamples = Array.from(predictions.values()).reduce((sum, count) => sum + count, 0);
    const correctCount = predictions.get(actualIntent) || 0;
    const accuracy = (correctCount / totalSamples) * 100;

    intentAccuracy[actualIntent] = accuracy;

    if (accuracy < 75) {
      lowAccuracyIntents.push(actualIntent);
    }

    matrix.push({
      actualIntent,
      predictions: Object.fromEntries(predictions),
      totalSamples,
      correctCount,
      accuracy,
    });
  }

  // Sort low-accuracy intents by accuracy (ascending)
  lowAccuracyIntents.sort((a, b) => intentAccuracy[a] - intentAccuracy[b]);

  // Get top 5 misclassification pairs sorted by frequency
  const topMisclassificationPairs: MisclassificationPair[] = Array.from(misclassificationPairs)
    .map(([pairKey, count]) => {
      const [from, to] = pairKey.split('|');
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    profile,
    timestamp: new Date().toISOString(),
    totalSamples: validFeedback.length,
    matrix,
    intentAccuracy,
    lowAccuracyIntents,
    topMisclassificationPairs,
  };
}

/**
 * Generate JSON report from confusion matrix
 */
export function generateJSONReport(report: ConfusionMatrixReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Format report as human-readable text
 */
export function formatReport(report: ConfusionMatrixReport): string {
  const lines: string[] = [];

  lines.push(`Confusion Matrix Report - ${report.profile}`);
  lines.push(`Generated: ${report.timestamp}`);
  lines.push(`Total Samples: ${report.totalSamples}`);
  lines.push('');

  if (report.totalSamples === 0) {
    lines.push('No feedback data available.');
    return lines.join('\n');
  }

  lines.push('Intent Accuracy:');
  for (const [intent, accuracy] of Object.entries(report.intentAccuracy)) {
    lines.push(`  ${intent}: ${accuracy.toFixed(2)}%`);
  }
  lines.push('');

  if (report.lowAccuracyIntents.length > 0) {
    lines.push(`Low Accuracy Intents (<75%):`);
    for (const intent of report.lowAccuracyIntents) {
      lines.push(`  - ${intent} (${report.intentAccuracy[intent].toFixed(2)}%)`);
    }
    lines.push('');
  }

  if (report.topMisclassificationPairs.length > 0) {
    lines.push('Top Misclassification Pairs:');
    for (const pair of report.topMisclassificationPairs) {
      lines.push(`  ${pair.from} misclassified as ${pair.to}: ${pair.count} times`);
    }
    lines.push('');
  }

  lines.push('Confusion Matrix:');
  for (const row of report.matrix) {
    lines.push(`  ${row.actualIntent}: ${row.correctCount}/${row.totalSamples} correct (${row.accuracy.toFixed(2)}%)`);
    for (const [predicted, count] of Object.entries(row.predictions)) {
      if (predicted !== row.actualIntent && count > 0) {
        lines.push(`    → misclassified as ${predicted}: ${count}`);
      }
    }
  }

  return lines.join('\n');
}
