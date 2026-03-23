/**
 * Per-Intent Classification Threshold Store (US-297)
 *
 * Manages per-intent per-profile confidence thresholds stored in the
 * `intent_classification_thresholds` database table.
 *
 * classifyIntent() calls checkPerIntentThreshold() to compare confidence
 * against the configured threshold; returns 'uncertain' if below.
 */
import { db } from './db.js';
import { intentClassificationThresholds } from '../../shared/schema-tables.js';
import { eq, and } from 'drizzle-orm';

// ─── In-memory cache (profile -> intent -> minConfidence) ────────────
const thresholdCache = new Map<string, Map<string, number>>();

/**
 * Get all thresholds for a profile from DB.
 */
export async function getThresholdsForProfile(
  profileId: string
): Promise<Array<{ intent: string; min_confidence: number }>> {
  try {
    const rows = await db
      .select()
      .from(intentClassificationThresholds)
      .where(eq(intentClassificationThresholds.profileId, profileId));

    return rows.map(r => ({
      intent: r.intent,
      min_confidence: r.minConfidence,
    }));
  } catch (err) {
    console.error('[IntentThresholds] Failed to fetch thresholds:', err);
    return [];
  }
}

/**
 * Upsert a threshold for a given profile + intent.
 * Uses ON CONFLICT (profile_id, intent) DO UPDATE.
 */
export async function upsertThreshold(
  profileId: string,
  intent: string,
  minConfidence: number
): Promise<{ profile_id: string; intent: string; min_confidence: number }> {
  // Check if an existing row exists
  const existing = await db
    .select()
    .from(intentClassificationThresholds)
    .where(
      and(
        eq(intentClassificationThresholds.profileId, profileId),
        eq(intentClassificationThresholds.intent, intent)
      )
    );

  if (existing.length > 0) {
    // Update
    await db
      .update(intentClassificationThresholds)
      .set({ minConfidence, updatedAt: new Date() })
      .where(
        and(
          eq(intentClassificationThresholds.profileId, profileId),
          eq(intentClassificationThresholds.intent, intent)
        )
      );
  } else {
    // Insert
    await db
      .insert(intentClassificationThresholds)
      .values({ profileId, intent, minConfidence });
  }

  // Update cache
  if (!thresholdCache.has(profileId)) {
    thresholdCache.set(profileId, new Map());
  }
  thresholdCache.get(profileId)!.set(intent, minConfidence);

  return { profile_id: profileId, intent, min_confidence: minConfidence };
}

/**
 * Load all thresholds from DB into the in-memory cache.
 * Called at startup.
 */
export async function loadThresholdCache(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(intentClassificationThresholds);

    thresholdCache.clear();
    for (const row of rows) {
      if (!thresholdCache.has(row.profileId)) {
        thresholdCache.set(row.profileId, new Map());
      }
      thresholdCache.get(row.profileId)!.set(row.intent, row.minConfidence);
    }
    console.log(`[IntentThresholds] Loaded ${rows.length} per-intent thresholds from DB`);
  } catch (err) {
    console.warn('[IntentThresholds] Failed to load threshold cache:', err);
  }
}

/**
 * Check if a classification result passes the per-intent confidence threshold.
 *
 * @param profileId - The profile being classified for
 * @param intent - The classified intent name
 * @param confidence - The confidence score from classification
 * @returns 'pass' if confidence meets threshold, 'uncertain' if below, 'no_threshold' if no per-intent threshold configured
 */
export function checkPerIntentThreshold(
  profileId: string,
  intent: string,
  confidence: number
): 'pass' | 'uncertain' | 'no_threshold' {
  const profileThresholds = thresholdCache.get(profileId);
  if (!profileThresholds) return 'no_threshold';

  const minConfidence = profileThresholds.get(intent);
  if (minConfidence === undefined) return 'no_threshold';

  if (confidence >= minConfidence) return 'pass';

  console.log(
    `[IntentThresholds] Intent "${intent}" confidence ${confidence.toFixed(2)} ` +
    `below per-intent threshold ${minConfidence.toFixed(2)} for profile "${profileId}" → uncertain`
  );
  return 'uncertain';
}

/**
 * Set a threshold directly in the cache (for testing or manual override).
 */
export function setThresholdInCache(
  profileId: string,
  intent: string,
  minConfidence: number
): void {
  if (!thresholdCache.has(profileId)) {
    thresholdCache.set(profileId, new Map());
  }
  thresholdCache.get(profileId)!.set(intent, minConfidence);
}

/**
 * Clear the threshold cache (for testing).
 */
export function clearThresholdCache(): void {
  thresholdCache.clear();
}
