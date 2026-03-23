/**
 * intent-accuracy-baseline.ts — US-247
 *
 * Tracks intent classification confidence baselines per profile.
 * Computes mean/percentile confidence from recent predictions and
 * stores them in the intent_accuracy_baseline table.
 */
import { db } from '../lib/db.js';
import { intentAccuracyBaselines } from '../../shared/schema.js';
import { eq, and } from 'drizzle-orm';

export interface PredictionSample {
  confidence: number;
}

/**
 * Compute mean and min (p5 percentile) confidence from recent predictions,
 * then upsert the baseline row for the given profile + intent.
 */
export async function computeIntentBaseline(
  profile: string,
  intent: string,
  recentPredictions: PredictionSample[],
): Promise<void> {
  if (recentPredictions.length === 0) return;

  const confidences = recentPredictions.map(p => p.confidence).sort((a, b) => a - b);
  const meanConfidence = confidences.reduce((s, c) => s + c, 0) / confidences.length;

  // Use p5 as the min_confidence (or the actual min for small samples)
  const p5Index = Math.max(0, Math.floor(confidences.length * 0.05));
  const minConfidence = confidences[p5Index];

  const existing = await db
    .select()
    .from(intentAccuracyBaselines)
    .where(and(
      eq(intentAccuracyBaselines.profile, profile),
      eq(intentAccuracyBaselines.intent, intent),
    ))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(intentAccuracyBaselines)
      .set({
        meanConfidence,
        minConfidence,
        sampleCount: recentPredictions.length,
        lastUpdated: new Date(),
      })
      .where(and(
        eq(intentAccuracyBaselines.profile, profile),
        eq(intentAccuracyBaselines.intent, intent),
      ));
  } else {
    await db.insert(intentAccuracyBaselines).values({
      profile,
      intent,
      meanConfidence,
      minConfidence,
      sampleCount: recentPredictions.length,
      lastUpdated: new Date(),
    });
  }
}
