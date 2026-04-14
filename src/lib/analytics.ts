/**
 * analytics.ts — Intent accuracy query helpers
 *
 * Provides queryIntentAccuracy to retrieve intent classification accuracy metrics
 * from the database for a given time window.
 */

import { db } from './db.js';
import { intentAnalytics } from '../../shared/schema.js';
import { and, gte, lt } from 'drizzle-orm';

export interface IntentAccuracyData {
  profileId: string;
  intentType: string;
  totalCount: number;
  correctCount: number;
  accuracyPct: number; // 0-100
}

/**
 * Query intent accuracy for a profile over a date range.
 *
 * @param profile Profile ID (e.g., 'pelangi', 'southern')
 * @param startDate Beginning of window
 * @param endDate End of window
 * @returns Array of IntentAccuracyData grouped by intent type
 */
export async function queryIntentAccuracy(
  profile: string,
  startDate: Date,
  endDate: Date
): Promise<IntentAccuracyData[]> {
  const records = await db
    .select()
    .from(intentAnalytics)
    .where(
      and(
        intentAnalytics.profileId.equals(profile),
        gte(intentAnalytics.createdAt, startDate),
        lt(intentAnalytics.createdAt, endDate)
      )
    );

  // Group by intent type and calculate accuracy
  const byIntent = new Map<string, { total: number; correct: number }>();

  for (const record of records) {
    const intent = record.intentType;
    if (!byIntent.has(intent)) {
      byIntent.set(intent, { total: 0, correct: 0 });
    }

    const stats = byIntent.get(intent)!;
    stats.total += 1;
    if (record.wasCorrect) {
      stats.correct += 1;
    }
  }

  // Convert to result format
  const results: IntentAccuracyData[] = [];
  for (const [intentType, stats] of byIntent) {
    results.push({
      profileId: profile,
      intentType,
      totalCount: stats.total,
      correctCount: stats.correct,
      accuracyPct: (stats.correct / stats.total) * 100,
    });
  }

  return results;
}
