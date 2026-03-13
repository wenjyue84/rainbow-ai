/**
 * Utterance Gap Recorder (US-432)
 *
 * Records unhandled/low-confidence utterances for intent gap analysis.
 * Fires asynchronously — never blocks the message pipeline.
 */

import { db } from '../../lib/db.js';
import { utteranceGaps } from '../../../shared/schema.js';
import { eq, and, sql } from 'drizzle-orm';

/** Tiers that indicate an intent gap (T4 LLM fallback paths) */
const GAP_SOURCES = new Set([
  'tiered-llm-fallback',   // T4: no fast tier match, full LLM
  'llm',                    // default mode (no tiered pipeline)
  'split-model',            // split model required full LLM
]);

/** Low confidence threshold — even fast-tier matches below this are gaps */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Normalize utterance for dedup: lowercase, strip punctuation, collapse whitespace
 */
export function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '') // strip punctuation (unicode-aware)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Truncate and sanitize utterance for storage (max 120 chars)
 */
function sanitizeUtterance(text: string): string {
  return text.trim().slice(0, 120);
}

/**
 * Should this classification result be recorded as an intent gap?
 */
export function isIntentGap(source: string | undefined, confidence: number): boolean {
  if (!source) return false;
  // Any T4/LLM fallback is a gap
  if (GAP_SOURCES.has(source)) return true;
  // Layer2 fallback (even if it improved) still indicates a gap
  if (source.includes('+layer2')) return true;
  // Low confidence from any tier
  if (confidence < LOW_CONFIDENCE_THRESHOLD) return true;
  return false;
}

/**
 * Record an utterance gap (fire-and-forget, never throws)
 */
export async function recordUtteranceGap(
  profileId: string,
  utterance: string,
  tierReached: string
): Promise<void> {
  try {
    const sample = sanitizeUtterance(utterance);
    const normalized = normalizeUtterance(utterance);
    if (!normalized) return; // empty after normalization

    // Upsert: increment count if normalized key exists, else insert
    await db.insert(utteranceGaps)
      .values({
        profileId,
        utteranceSample: sample,
        normalizedKey: normalized,
        tierReached,
        count: 1,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [utteranceGaps.profileId, utteranceGaps.normalizedKey],
        set: {
          count: sql`${utteranceGaps.count} + 1`,
          lastSeenAt: new Date(),
          tierReached, // update to latest tier
        },
      });
  } catch (err: any) {
    console.warn(`[UtteranceGap] Failed to record: ${err.message}`);
  }
}
