import type { ChatMessage } from './types.js';
import { configStore } from './config-store.js';
import { chat } from './ai-client.js';
import { summarizeConversationContext } from './pipeline/context-manager.js';
import { createModuleLogger } from '../lib/logger.js';

const logger = createModuleLogger('ConversationSummarizer');

/**
 * Conversation Summarization Module
 *
 * US-328: Reduces context size for long conversations by:
 * 1. Extracting booking-critical facts (guest name, room type, dates, special requests)
 * 2. Keeping recent messages verbatim (up to maxHistoryMessages, default 10)
 * 3. Prevents token limit exhaustion in extended multi-turn dialogues (~33-75% reduction)
 *
 * Uses fact-extraction approach (no LLM call) for token efficiency.
 */

export interface SummarizationResult {
  messages: ChatMessage[];
  wasSummarized: boolean;
  originalCount: number;
  reducedCount: number;
  summarizedRange: string;
}

/**
 * Apply conversation summarization using fact extraction (US-328)
 *
 * Extracts booking-critical facts (guest name, room type, dates, special requests)
 * from older messages and keeps only the most recent messages, preventing token
 * limit exhaustion in extended multi-turn dialogues.
 *
 * @param messages - Full conversation history
 * @returns Reduced conversation with summary and reduction metrics
 */
export async function applyConversationSummarization(
  messages: ChatMessage[]
): Promise<SummarizationResult> {
  const settings = configStore.getSettings();
  const config = settings.conversation_management;

  // Check if summarization is enabled
  if (!config?.enabled) {
    return {
      messages,
      wasSummarized: false,
      originalCount: messages.length,
      reducedCount: messages.length,
      summarizedRange: 'none'
    };
  }

  // US-328: Use fact-extraction based summarization instead of LLM
  // Default: summarize when exceeding 10 messages
  const maxHistoryMessages = config?.max_history_messages ?? 10;

  // Check if conversation exceeds threshold
  if (messages.length <= maxHistoryMessages) {
    return {
      messages,
      wasSummarized: false,
      originalCount: messages.length,
      reducedCount: messages.length,
      summarizedRange: 'none'
    };
  }

  try {
    // US-328: Extract booking-critical facts and keep recent messages
    const result = summarizeConversationContext(messages, maxHistoryMessages);

    if (!result.summary) {
      // No facts extracted, but still reduced messages
      const reductionPercent = Math.round(result.messageReductionRatio * 100);
      logger.info(
        `[US-328] Conversation reduced to recent messages: ${messages.length} -> ${result.recentMessages.length} messages ` +
        `(${reductionPercent}% reduction)`,
        {
          originalCount: messages.length,
          recentCount: result.recentMessages.length,
          factsExtracted: Object.keys(result.factsExtracted).length,
        }
      );

      return {
        messages: result.recentMessages,
        wasSummarized: true,
        originalCount: messages.length,
        reducedCount: result.recentMessages.length,
        summarizedRange: 'recent-only'
      };
    }

    // Create summary message with extracted facts
    const summaryMessage: ChatMessage = {
      role: 'assistant',
      content: result.summary,
      timestamp: Math.floor(Date.now() / 1000)
    };

    // Reconstruct: summary + recent messages
    const reducedMessages = [summaryMessage, ...result.recentMessages];
    const reductionPercent = Math.round(result.messageReductionRatio * 100);

    logger.info(
      `[US-328] Conversation summarized: ${messages.length} -> ${reducedMessages.length} messages ` +
      `(${reductionPercent}% reduction)`,
      {
        originalCount: messages.length,
        reducedCount: reducedMessages.length,
        summaryLength: result.summary.length,
        factsExtracted: Object.keys(result.factsExtracted),
      }
    );

    return {
      messages: reducedMessages,
      wasSummarized: true,
      originalCount: messages.length,
      reducedCount: reducedMessages.length,
      summarizedRange: `fact-extraction-${maxHistoryMessages}`
    };
  } catch (error: any) {
    logger.error(`[US-328] Summarization failed: ${error.message}`, { error });
    // On error, return original messages (fail-safe)
    return {
      messages,
      wasSummarized: false,
      originalCount: messages.length,
      reducedCount: messages.length,
      summarizedRange: 'error'
    };
  }
}

/**
 * Get summarization stats for logging/debugging
 * US-328: Now using fact-extraction based summarization
 */
export function getSummarizationStats(): {
  enabled: boolean;
  method: string;
  maxHistoryMessages: number;
} {
  const settings = configStore.getSettings();
  const config = settings.conversation_management;

  return {
    enabled: config?.enabled ?? false,
    method: 'fact-extraction (US-328)',
    maxHistoryMessages: config?.max_history_messages ?? 10
  };
}
