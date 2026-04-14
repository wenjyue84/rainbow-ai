/**
 * conversation-retriever.ts — Validated Conversation Message Retriever (US-644)
 *
 * Wraps the DB message fetch from src/lib/conversation.ts and applies
 * timestamp ordering validation. Logs warnings when out-of-order messages
 * are detected, with before/after message IDs and timestamps for diagnosis.
 */

import { getConversationMessages } from '../lib/conversation.js';
import type { ConversationMessage } from '../lib/conversation.js';
import { validateMessageOrdering } from '../lib/conversation-timestamp-validator.js';
import { createModuleLogger } from '../lib/logger.js';

const logger = createModuleLogger('ConversationRetriever');

/**
 * Fetch conversation messages with timestamp ordering validation.
 *
 * Calls getConversationMessages() from src/lib/conversation.ts, then runs
 * the timestamp validator over the result. Out-of-order consecutive message
 * pairs are logged as warnings in the form:
 *   "Message {id} ts={ISO} before {prevId} ts={prevISO}"
 *
 * The original messages array is returned unchanged — validation is
 * observability-only and does not reorder or drop messages.
 *
 * @param phone     - Canonical phone key identifying the conversation
 * @param profileId - Expected profile ID (enforced by getConversationMessages)
 * @returns Messages in DB order (ORDER BY timestamp ASC)
 */
export async function retrieveConversationMessages(
  phone: string,
  profileId: string,
): Promise<ConversationMessage[]> {
  const messages = await getConversationMessages(phone, profileId);

  let violationCount = 0;
  for (const warning of validateMessageOrdering(messages)) {
    violationCount++;
    logger.warn(
      `[US-644] Message ${warning.messageId} ts=${warning.messageTimestamp} before ${warning.prevMessageId} ts=${warning.prevMessageTimestamp}`,
      { phone, profileId }
    );
  }

  if (violationCount > 0) {
    logger.warn(
      `[US-644] Conversation ${phone} has ${violationCount} out-of-order message pair(s) — context window may reflect incorrect chronology`,
      { phone, profileId, violationCount }
    );
  }

  return messages;
}
