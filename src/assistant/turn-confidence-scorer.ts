/**
 * US-245: Conversation Turn-by-Turn Confidence Scorer
 *
 * Records per-turn confidence scores and intent classification metadata
 * into the rainbow_conversations.turn_metadata JSONB column.
 *
 * Each turn entry stores: turn_num, intent, confidence, fallback_used, tokens.
 * The array is appended on each classified message.
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { rainbowConversations } from '../../shared/schema-tables.js';

/** Confidence threshold below which fallback_used is set to true */
export const FALLBACK_CONFIDENCE_THRESHOLD = 0.6;

export interface TurnMetadataEntry {
  turn_num: number;
  intent: string;
  confidence: number;
  fallback_used: boolean;
  tokens: number;
}

/**
 * Record a turn's confidence metadata for a conversation.
 *
 * Reads the existing turn_metadata array from the conversation row,
 * appends a new entry, and writes back. If no row exists, this is a no-op.
 *
 * @param phone - Conversation phone key (primary key of rainbow_conversations)
 * @param intent - The classified intent name
 * @param confidence - Confidence score (0-1)
 * @param tokens - Total token count for this classification (prompt + completion)
 */
export async function recordTurnConfidence(
  phone: string,
  intent: string,
  confidence: number,
  tokens: number = 0,
): Promise<void> {
  try {
    // Read existing turn_metadata
    const rows = await db
      .select({ turnMetadata: rainbowConversations.turnMetadata })
      .from(rainbowConversations)
      .where(eq(rainbowConversations.phone, phone))
      .limit(1);

    if (rows.length === 0) return;

    const existing: TurnMetadataEntry[] = Array.isArray(rows[0].turnMetadata)
      ? (rows[0].turnMetadata as TurnMetadataEntry[])
      : [];

    const nextTurnNum = existing.length + 1;
    const fallbackUsed = confidence < FALLBACK_CONFIDENCE_THRESHOLD;

    const newEntry: TurnMetadataEntry = {
      turn_num: nextTurnNum,
      intent,
      confidence: Math.round(confidence * 1000) / 1000, // 3 decimal places
      fallback_used: fallbackUsed,
      tokens,
    };

    const updated = [...existing, newEntry];

    await db
      .update(rainbowConversations)
      .set({ turnMetadata: updated })
      .where(eq(rainbowConversations.phone, phone));
  } catch (err: any) {
    // Non-fatal: never let turn metadata recording break the pipeline
    console.error(`[TurnConfidence] Failed to record turn for ${phone}:`, err.message);
  }
}

/**
 * Get the turn metadata array for a conversation.
 *
 * @param phone - Conversation phone key
 * @returns Array of turn metadata entries, or empty array if none
 */
export async function getTurnMetadata(phone: string): Promise<TurnMetadataEntry[]> {
  const rows = await db
    .select({ turnMetadata: rainbowConversations.turnMetadata })
    .from(rainbowConversations)
    .where(eq(rainbowConversations.phone, phone))
    .limit(1);

  if (rows.length === 0) return [];

  return Array.isArray(rows[0].turnMetadata)
    ? (rows[0].turnMetadata as TurnMetadataEntry[])
    : [];
}
