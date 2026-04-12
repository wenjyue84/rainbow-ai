/**
 * US-519: Conversation Memory Retrieval for Multi-Turn Context Awareness
 *
 * Retrieves last N messages from conversation history and formats them
 * as context to inject into the AI system prompt, enabling coherent
 * multi-turn responses without losing context across message boundaries.
 */

import { eq, desc } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { rainbowMessages, rainbowConversations } from '../../../shared/schema-tables.js';

const DEFAULT_MAX_MESSAGES = 5;
const DEFAULT_TOKEN_LIMIT = 3000;

/**
 * Simple token counter: rough estimate of tokens (~4 chars per token).
 * For actual usage, use a proper tokenizer, but this is sufficient
 * for token budget enforcement.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Retrieve conversation context (last N messages formatted for injection into system prompt).
 *
 * @param conversationId - Phone number or conversation identifier
 * @param maxMessages - Maximum messages to retrieve (default: 5)
 * @param tokenLimit - Maximum total tokens for context (default: 3000)
 * @returns Formatted context string or empty string if < 2 messages exist
 *
 * Format: "Context: [USER]: msg1\n[ASSISTANT]: resp1\n[USER]: msg2\n[ASSISTANT]: resp2\n..."
 */
export async function getContext(
  conversationId: string,
  maxMessages: number = DEFAULT_MAX_MESSAGES,
  tokenLimit: number = DEFAULT_TOKEN_LIMIT
): Promise<string> {
  try {
    // Verify conversation exists
    const conversation = await db
      .select({ phone: rainbowConversations.phone })
      .from(rainbowConversations)
      .where(eq(rainbowConversations.phone, conversationId))
      .limit(1);

    if (conversation.length === 0) {
      return '';
    }

    // Fetch last N messages ordered by timestamp DESC (newest first)
    const messages = await db
      .select({
        role: rainbowMessages.role,
        content: rainbowMessages.content,
        timestamp: rainbowMessages.timestamp,
      })
      .from(rainbowMessages)
      .where(eq(rainbowMessages.phone, conversationId))
      .orderBy(desc(rainbowMessages.timestamp))
      .limit(maxMessages);

    // Return empty if fewer than 2 messages
    if (messages.length < 2) {
      return '';
    }

    // Reverse to chronological order (oldest first)
    messages.reverse();

    // Format messages as: [USER]: msg\n[ASSISTANT]: resp\n...
    let contextText = '';
    let contextTokens = 0;

    for (const msg of messages) {
      const roleLabel = msg.role === 'user' ? 'USER' : 'ASSISTANT';
      const msgLine = `[${roleLabel}]: ${msg.content}\n`;
      const msgTokens = estimateTokens(msgLine);

      // Check if adding this message would exceed token limit
      if (contextTokens + msgTokens > tokenLimit) {
        break; // Stop adding messages
      }

      contextText += msgLine;
      contextTokens += msgTokens;
    }

    // Return formatted context if we have any messages
    return contextText.trim() ? `Context:\n${contextText}` : '';
  } catch (error: any) {
    console.warn(`[ConversationMemory] Failed to get context for ${conversationId}:`, error.message);
    return '';
  }
}

/**
 * Inject conversation context into the AI system prompt.
 *
 * @param originalPrompt - The original system prompt
 * @param conversationId - Phone number or conversation identifier
 * @param maxMessages - Maximum messages to include (default: 5)
 * @param tokenLimit - Maximum tokens for context (default: 3000)
 * @returns System prompt with context injected before the user message
 */
export async function injectContextIntoPrompt(
  originalPrompt: string,
  conversationId: string,
  maxMessages: number = DEFAULT_MAX_MESSAGES,
  tokenLimit: number = DEFAULT_TOKEN_LIMIT
): Promise<string> {
  const context = await getContext(conversationId, maxMessages, tokenLimit);

  if (!context) {
    return originalPrompt;
  }

  // Inject context at the beginning of the prompt
  return `${context}\n\n${originalPrompt}`;
}
