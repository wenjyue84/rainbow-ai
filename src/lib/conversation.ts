/**
 * src/lib/conversation.ts — Profile-isolated conversation message access (US-061)
 *
 * Provides getConversationMessages() with profile_id isolation enforcement.
 * Throws ProfileMismatchError if fetched messages contain mismatched profile_id.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from './db.js';
import { rainbowMessages } from '../../shared/schema-tables.js';

// ─── Error types ─────────────────────────────────────────────────────

/** Thrown when a message's profile_id does not match the expected profile. */
export class ProfileMismatchError extends Error {
  public readonly phone: string;
  public readonly expectedProfileId: string;
  public readonly foundProfileId: string | null;

  constructor(phone: string, expectedProfileId: string, foundProfileId: string | null) {
    super(
      `Profile mismatch for conversation '${phone}': expected '${expectedProfileId}', found '${foundProfileId ?? 'null'}'`
    );
    this.name = 'ProfileMismatchError';
    this.phone = phone;
    this.expectedProfileId = expectedProfileId;
    this.foundProfileId = foundProfileId;
  }
}

// ─── Types ───────────────────────────────────────────────────────────

export type ConversationMessage = typeof rainbowMessages.$inferSelect;

// ─── Validation helper (testable without DB) ─────────────────────────

/**
 * Validates that all messages in the array belong to the expected profile.
 * Throws ProfileMismatchError on the first violation found.
 *
 * Messages with a null profile_id are skipped (legacy rows without profile context).
 */
export function validateMessageProfiles(
  messages: Pick<ConversationMessage, 'profileId'>[],
  expectedProfileId: string,
  phone: string
): void {
  for (const msg of messages) {
    if (msg.profileId !== null && msg.profileId !== expectedProfileId) {
      throw new ProfileMismatchError(phone, expectedProfileId, msg.profileId);
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Fetch all non-deleted messages for a conversation and enforce profile_id isolation.
 *
 * @param phone  - Canonical phone key (or BSUID key) identifying the conversation.
 * @param profileId - Expected profile that owns this conversation.
 * @throws ProfileMismatchError if any message belongs to a different profile.
 */
export async function getConversationMessages(
  phone: string,
  profileId: string
): Promise<ConversationMessage[]> {
  const messages = await db
    .select()
    .from(rainbowMessages)
    .where(and(eq(rainbowMessages.phone, phone), isNull(rainbowMessages.deletedAt)))
    .orderBy(rainbowMessages.timestamp);

  validateMessageProfiles(messages, profileId, phone);

  return messages;
}
