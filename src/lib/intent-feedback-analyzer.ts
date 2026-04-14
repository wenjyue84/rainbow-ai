/**
 * intent-feedback-analyzer.ts — US-602
 *
 * Analyzes intent classification feedback to find misclassification patterns.
 * Reads the intent_classification_feedback table and produces:
 *   - Misclassification frequency per intent
 *   - Suggested new keywords based on ground truth patterns
 */

export interface MisclassificationEntry {
  predictedIntent: string;
  groundTruthIntent: string;
  feedbackTimestamp: Date;
}

export interface IntentMisclassificationStat {
  intent: string;
  misclassificationCount: number;
  confusedWith: Array<{ groundTruthIntent: string; count: number }>;
  suggestedKeywords: string[];
}

export interface MisclassificationReport {
  generatedAt: string;
  totalFeedbackRecords: number;
  totalMisclassifications: number;
  top10MisclassifiedIntents: IntentMisclassificationStat[];
}

/**
 * Derive keyword suggestions for a misclassified intent.
 *
 * Strategy: when predictedIntent is consistently confused with groundTruthIntent,
 * suggest adding the groundTruthIntent name parts as disambiguation keywords.
 * This is a heuristic — real keyword mining would use message text,
 * but the feedback table only stores intent names.
 */
function suggestKeywords(
  predictedIntent: string,
  confusedWith: Array<{ groundTruthIntent: string; count: number }>
): string[] {
  const suggestions = new Set<string>();

  for (const { groundTruthIntent, count } of confusedWith) {
    if (count < 2) continue; // ignore single-occurrence noise

    // Split intent name by underscores/hyphens/dots and add as keyword candidates
    const parts = groundTruthIntent
      .toLowerCase()
      .split(/[_\-.]/)
      .filter((p) => p.length > 3); // ignore very short tokens

    for (const part of parts) {
      // Only suggest if not already a fragment of the predicted intent name
      if (!predictedIntent.toLowerCase().includes(part)) {
        suggestions.add(part);
      }
    }
  }

  return Array.from(suggestions).slice(0, 5); // max 5 suggestions per intent
}

/**
 * Analyze misclassification patterns from feedback records.
 *
 * AC1: reads intent_classification_feedback table data
 * AC2: returns misclassification frequency per intent + suggested new keywords
 */
export function analyzeMisclassifications(
  feedbackRecords: MisclassificationEntry[]
): MisclassificationReport {
  const totalFeedbackRecords = feedbackRecords.length;

  // Only consider actual misclassifications (predicted != ground truth)
  const misclassifications = feedbackRecords.filter(
    (r) => r.predictedIntent !== r.groundTruthIntent
  );

  const totalMisclassifications = misclassifications.length;

  // Group by predictedIntent -> groundTruthIntent -> count
  const byPredicted = new Map<string, Map<string, number>>();

  for (const record of misclassifications) {
    const { predictedIntent, groundTruthIntent } = record;

    if (!byPredicted.has(predictedIntent)) {
      byPredicted.set(predictedIntent, new Map());
    }
    const inner = byPredicted.get(predictedIntent)!;
    inner.set(groundTruthIntent, (inner.get(groundTruthIntent) || 0) + 1);
  }

  // Build stats per intent
  const stats: IntentMisclassificationStat[] = [];

  for (const [predictedIntent, groundTruthMap] of byPredicted) {
    const confusedWith = Array.from(groundTruthMap.entries())
      .map(([groundTruthIntent, count]) => ({ groundTruthIntent, count }))
      .sort((a, b) => b.count - a.count);

    const misclassificationCount = confusedWith.reduce((sum, c) => sum + c.count, 0);

    stats.push({
      intent: predictedIntent,
      misclassificationCount,
      confusedWith,
      suggestedKeywords: suggestKeywords(predictedIntent, confusedWith),
    });
  }

  // Sort by misclassification count descending, take top 10
  const top10MisclassifiedIntents = stats
    .sort((a, b) => b.misclassificationCount - a.misclassificationCount)
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    totalFeedbackRecords,
    totalMisclassifications,
    top10MisclassifiedIntents,
  };
}
