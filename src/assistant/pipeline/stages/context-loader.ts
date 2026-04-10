/**
 * context-loader.ts — Multi-Turn Context Loader Pipeline Stage (US-396)
 *
 * Retrieves and injects the last 3 conversation messages into the AI provider's
 * system prompt to improve context-aware responses for multi-turn conversations.
 *
 * Features:
 * - Loads last 3 messages per conversation
 * - Filters messages older than 24 hours
 * - Formats as "Previous messages: User: X\nAssistant: Y"
 * - Injects into system prompt via <conversation_context> tags
 */

import type { PipelineState } from '../pipeline-context.js';
import type { IPipelineContext } from '../pipeline-context.js';
import type { ChatMessage } from '../../types.js';

const CONTEXT_WINDOW_SIZE = 3;
const MESSAGE_AGE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

export interface ContextWindowResult {
  contextWindow: string;
  messageCount: number;
  filteredCount: number;
}

/**
 * Load the last N messages from the conversation, excluding messages older than 24 hours.
 *
 * @param state - Pipeline state containing conversation data
 * @param context - Pipeline context
 * @returns Object with formatted context window and message counts
 */
export async function loadContextWindow(
  state: PipelineState,
  context: IPipelineContext
): Promise<ContextWindowResult> {
  const messages = state.convo?.messages ?? [];

  if (messages.length === 0) {
    return {
      contextWindow: '',
      messageCount: 0,
      filteredCount: 0,
    };
  }

  const now = Date.now();
  const recentMessages: ChatMessage[] = [];

  // Filter messages within 24-hour window
  for (const msg of messages) {
    const msgTimestampMs = (msg.timestamp ?? 0) * 1000; // Convert from seconds to ms
    const ageMs = now - msgTimestampMs;

    if (ageMs <= MESSAGE_AGE_THRESHOLD_MS) {
      recentMessages.push(msg);
    }
  }

  const filteredCount = messages.length - recentMessages.length;

  // Take the last CONTEXT_WINDOW_SIZE messages
  const contextMessages = recentMessages.slice(-CONTEXT_WINDOW_SIZE);

  // Format context window
  const contextLines: string[] = [];
  for (const msg of contextMessages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    contextLines.push(`${role}: ${msg.content}`);
  }

  const contextWindow = contextMessages.length > 0
    ? `Previous messages:\n${contextLines.join('\n')}`
    : '';

  return {
    contextWindow,
    messageCount: contextMessages.length,
    filteredCount,
  };
}

/**
 * Inject the context window into the system prompt.
 *
 * Wraps the context in <conversation_context> tags and appends to the base prompt.
 * Returns unchanged prompt if context is empty.
 *
 * @param basePrompt - The base system prompt
 * @param contextWindow - The formatted context window
 * @returns Enhanced system prompt with context injected
 */
export function injectContextWindow(basePrompt: string, contextWindow: string): string {
  if (!contextWindow || contextWindow.trim() === '') {
    return basePrompt;
  }

  return `${basePrompt}\n\n<conversation_context>\n${contextWindow}\n</conversation_context>`;
}
