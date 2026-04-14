/**
 * conversation-context.ts — Context pruning utilities for multi-turn conversations (US-102)
 *
 * Implements stale context pruning to remove messages older than a configured window
 * from the conversation history, unless they contain keywords matching the current intent.
 *
 * This prevents stale context from polluting AI inference in long conversations while
 * preserving relevant historical context that matches the user's current intent.
 */

import type { ChatMessage } from '../assistant/types.js';
import { configStore } from '../assistant/config-store.js';
import intentKeywordsData from '../assistant/data/intent-keywords.json' assert { type: 'json' };
import { validateMessageOrdering } from './message-ordering-validator.js';
import { db } from './db.js';
import { rainbowMessages } from '../../shared/schema-tables.js';
import { and, eq, orderBy, limit } from 'drizzle-orm';

interface PruningConfig {
  contextPruningWindowMinutes: number;
}

/**
 * Get context pruning config from settings
 */
function getPruningConfig(): PruningConfig {
  try {
    const settings = configStore.getSettings();
    const config = settings?.conversation_management;

    return {
      contextPruningWindowMinutes: (config as any)?.context_pruning_window_minutes ?? 30,
    };
  } catch {
    // Fallback for test environments or when settings are unavailable
    return {
      contextPruningWindowMinutes: 30,
    };
  }
}

/**
 * Get keywords for a specific intent from intent-keywords.json
 * Returns all keywords across all languages for the given intent
 */
function getKeywordsForIntent(intentType: string): string[] {
  const intentEntry = intentKeywordsData.intents.find((i) => i.intent === intentType);

  if (!intentEntry) {
    return [];
  }

  const keywords: string[] = [];
  // Collect keywords from all languages
  for (const lang of Object.values(intentEntry.keywords)) {
    if (Array.isArray(lang)) {
      keywords.push(...lang);
    }
  }

  return keywords;
}

/**
 * Check if a message contains any of the given keywords (case-insensitive)
 */
function messageContainsKeywords(message: string, keywords: string[]): boolean {
  if (keywords.length === 0) {
    return false;
  }

  const lowerMessage = message.toLowerCase();
  return keywords.some((keyword) => lowerMessage.includes(keyword.toLowerCase()));
}

/**
 * Prune stale conversation context by removing messages older than configured window
 * unless they contain keywords matching the current intent.
 *
 * @param messages - Array of chat messages (with timestamps in milliseconds)
 * @param currentIntent - The current detected intent (e.g., "booking", "pricing")
 * @param nowMs - Current time in milliseconds (defaults to Date.now())
 * @returns Pruned messages array with old, non-matching messages removed
 *
 * Example:
 *   pruneStaleContext(
 *     [msg1, msg2, msg3, msg4],
 *     "booking",
 *     Date.now()
 *   )
 *   // Returns messages from last 30 minutes + any older ones containing "book", "reserve", etc.
 */
export function pruneStaleContext(
  messages: ChatMessage[],
  currentIntent: string,
  nowMs: number = Date.now(),
  conversationId: string = 'unknown',
): ChatMessage[] {
  // US-593: Validate timestamp ordering before context inclusion
  validateMessageOrdering(messages, conversationId);

  const config = getPruningConfig();
  const windowMs = config.contextPruningWindowMinutes * 60 * 1000; // Convert to milliseconds
  const cutoffTime = nowMs - windowMs;

  // Get keywords for current intent
  const intentKeywords = getKeywordsForIntent(currentIntent);

  // Filter messages: keep recent ones and keyword-matched ones
  const prunedMessages = messages.filter((message) => {
    // Message is within the time window - always keep
    if (message.timestamp >= cutoffTime) {
      return true;
    }

    // Message is older than window - keep only if it matches intent keywords
    return messageContainsKeywords(message.content, intentKeywords);
  });

  return prunedMessages;
}

/**
 * Get information about what was pruned from the context
 *
 * Useful for debugging and understanding what context was removed
 */
export function getPruningReport(
  messages: ChatMessage[],
  currentIntent: string,
  nowMs: number = Date.now()
): {
  originalCount: number;
  prunedCount: number;
  removedCount: number;
  windowMinutes: number;
  intentKeywords: string[];
} {
  const config = getPruningConfig();
  const windowMs = config.contextPruningWindowMinutes * 60 * 1000;
  const cutoffTime = nowMs - windowMs;
  const intentKeywords = getKeywordsForIntent(currentIntent);

  const prunedMessages = pruneStaleContext(messages, currentIntent, nowMs);

  return {
    originalCount: messages.length,
    prunedCount: prunedMessages.length,
    removedCount: messages.length - prunedMessages.length,
    windowMinutes: config.contextPruningWindowMinutes,
    intentKeywords,
  };
}

/**
 * Get conversation context messages for a specific profile.
 * Enforces profile isolation by filtering messages via profile_id in WHERE clause.
 *
 * @param profileId - The profile ID (e.g., 'pelangi', 'makan', 'southern')
 * @param limit_count - Maximum number of messages to retrieve (default: 10)
 * @returns Array of messages for this profile only
 */
export async function getConversationContext(
  profileId: string,
  limit_count: number = 10
): Promise<Array<{ phone: string; role: string; content: string; timestamp: Date; profileId: string }>> {
  const messages = await db
    .select()
    .from(rainbowMessages)
    .where(eq(rainbowMessages.profileId, profileId))
    .orderBy(rainbowMessages.timestamp)
    .limit(limit_count);

  return messages;
}
