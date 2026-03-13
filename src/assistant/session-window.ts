/**
 * WhatsApp 24-Hour Session Window Enforcement (US-407)
 *
 * Meta's WhatsApp Business API requires pre-approved templates for
 * outbound messages sent outside the 24-hour customer service window.
 * This module provides a check for proactive/outbound messages.
 */
import type { ConversationState } from './types.js';

const TWENTY_FOUR_HOURS_MS = 86_400_000;

/**
 * Check if the conversation is within the 24-hour customer service window.
 * Returns true if we can send free-form messages; false if only templates allowed.
 *
 * - If no user message has been received yet, returns false (no window opened).
 * - Window starts from the last inbound user message timestamp.
 */
export function isWithin24HourWindow(convo: ConversationState): boolean {
  if (!convo.lastUserMessageAt) {
    return false;
  }
  const elapsed = Date.now() - convo.lastUserMessageAt;
  return elapsed < TWENTY_FOUR_HOURS_MS;
}
