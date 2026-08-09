/**
 * fallback-generator.ts — Context-Aware Fallback Response Generator (US-342)
 *
 * Generates contextual fallback responses by mining successful resolutions from
 * escalation_events table instead of relying on static templates.
 *
 * Key functions:
 * - fetchSuccessfulResolutions(): Query escalation_events for intent-matched patterns
 * - calculateSimilarity(): Deterministic string similarity scoring (0-1)
 * - generateFallbackResponse(): Generate response matched by intent with score > 0.75
 */

import { db } from '../lib/db.js';
import { escalationEvents } from '../../shared/schema-tables.js';
import { eq, and, gt, desc } from 'drizzle-orm';

// ─── Types ──────────────────────────────────────────────────────────

export interface EscalationPattern {
  intentId: string;
  staffResolution: string;
  guestFeedback?: string;
  similarityScore: number;
  profileId: string;
}

export interface GeneratedFallbackResponse {
  response: string;
  intentId: string;
  score: number;
  profileId: string;
}

// ─── Similarity Scoring ──────────────────────────────────────────────

/**
 * Calculate deterministic string similarity score using Dice coefficient.
 * Returns a value between 0 and 1, where 1 = identical strings.
 *
 * Algorithm: 2 * |common bigrams| / (|text1 bigrams| + |text2 bigrams|)
 *
 * @param text1 First text to compare
 * @param text2 Second text to compare
 * @returns Similarity score (0-1)
 */
export function calculateSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;

  const normalize = (text: string) => text.toLowerCase().trim();
  const t1 = normalize(text1);
  const t2 = normalize(text2);

  if (t1 === t2) return 1;

  // Extract bigrams (pairs of consecutive characters)
  const getBigrams = (text: string): Set<string> => {
    const bigrams = new Set<string>();
    for (let i = 0; i < text.length - 1; i++) {
      bigrams.add(text.substring(i, i + 2));
    }
    return bigrams;
  };

  const bigrams1 = getBigrams(t1);
  const bigrams2 = getBigrams(t2);

  // Count common bigrams
  let commonCount = 0;
  for (const bigram of bigrams1) {
    if (bigrams2.has(bigram)) {
      commonCount++;
    }
  }

  // Dice coefficient: 2 * common / total
  const totalBigrams = bigrams1.size + bigrams2.size;
  if (totalBigrams === 0) return 0;

  return (2 * commonCount) / totalBigrams;
}

// ─── Database Queries ────────────────────────────────────────────────

/**
 * Fetch successful escalation resolutions by intent and profile.
 * Returns patterns with staffResolution and guestFeedback.
 *
 * Filters:
 * - Profile isolation: only returns escalations for specified profile
 * - Intent match: escalations with matching intentId
 * - Has resolution: escalations where staffResolution is not null
 * - Recent: escalations from last 90 days (ordered by recency)
 *
 * @param intentId Intent category (booking, check_in, pricing, etc.)
 * @param profileId Profile name (pelangi, makan, southern)
 * @param limitDays Number of days to look back (default: 90)
 * @param maxResults Maximum number of patterns to return (default: 10)
 * @returns Array of successful escalation patterns
 */
export async function fetchSuccessfulResolutions(
  intentId: string,
  profileId: string,
  limitDays: number = 90,
  maxResults: number = 10
): Promise<EscalationPattern[]> {
  if (!intentId || !profileId) {
    return [];
  }

  const sinceDateStr = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Query escalation_events for intent-matched patterns with staff resolution
    const patterns = await db
      .select()
      .from(escalationEvents)
      .where(
        and(
          eq(escalationEvents.intentId, intentId),
          eq(escalationEvents.profileId, profileId),
          gt(escalationEvents.createdAt, new Date(sinceDateStr)),
          // Only include escalations that have a resolution
          // staffResolution is not null is implicit if we're selecting it
        )
      )
      .orderBy(desc(escalationEvents.createdAt))
      .limit(maxResults);

    // Filter and map to EscalationPattern type
    return patterns
      .filter((p) => p.staffResolution) // Only include patterns with a resolution
      .map((p) => ({
        intentId: p.intentId || intentId,
        staffResolution: p.staffResolution!,
        guestFeedback: p.guestFeedback || undefined,
        similarityScore: p.similarityScore || 0.8, // default if not pre-calculated
        profileId: p.profileId || profileId,
      }));
  } catch (error) {
    console.error(`[Fallback] Error fetching resolutions for intent=${intentId} profile=${profileId}:`, error);
    return [];
  }
}

// ─── Response Generation ─────────────────────────────────────────────

/**
 * Generate a context-aware fallback response from successful escalation patterns.
 *
 * Process:
 * 1. Fetch successful resolutions for the intent (profile-isolated)
 * 2. Calculate similarity score between conversation context and historical patterns
 * 3. Select pattern with highest similarity score (must be > 0.75)
 * 4. Return the staff resolution as fallback response
 *
 * @param intentId The intent category (booking, check_in, etc.)
 * @param conversationContext Recent conversation context to match against
 * @param profileId Profile name for isolation (pelangi, makan, southern)
 * @returns Generated fallback response with similarity score, or null if no match > 0.75
 */
export async function generateFallbackResponse(
  intentId: string,
  conversationContext: string,
  profileId: string = 'pelangi'
): Promise<GeneratedFallbackResponse | null> {
  if (!intentId || !conversationContext || !profileId) {
    return null;
  }

  // Fetch successful patterns for this intent (profile-isolated)
  const patterns = await fetchSuccessfulResolutions(intentId, profileId);

  if (patterns.length === 0) {
    return null;
  }

  // Calculate similarity score against conversation context
  let bestMatch: EscalationPattern | null = null;
  let bestScore = 0;

  for (const pattern of patterns) {
    const score = calculateSimilarity(conversationContext, pattern.staffResolution);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = pattern;
    }
  }

  // Only return if similarity score exceeds threshold
  if (!bestMatch || bestScore < 0.75) {
    return null;
  }

  return {
    response: bestMatch.staffResolution,
    intentId: bestMatch.intentId,
    score: bestScore,
    profileId: bestMatch.profileId,
  };
}

/**
 * Validate that a set of escalation patterns is properly profile-isolated.
 * Used for testing to ensure no data leakage between profiles.
 *
 * @param patterns Array of patterns to validate
 * @param expectedProfileId The profile ID they should all belong to
 * @returns true if all patterns match the expected profile
 */
export function validateProfileIsolation(
  patterns: EscalationPattern[],
  expectedProfileId: string
): boolean {
  return patterns.every((p) => p.profileId === expectedProfileId);
}

export default {
  calculateSimilarity,
  fetchSuccessfulResolutions,
  generateFallbackResponse,
  validateProfileIsolation,
};
