/**
 * context-pruner.ts — Token-aware conversation context pruning
 *
 * Ensures conversation history stays within a configurable token budget
 * before each LLM call. Strategy:
 * 1. Keep last N turns (default 4) verbatim — preserves immediate context
 * 2. If remaining older messages exceed budget, summarize them into one message
 * 3. Summary is generated using a cheap/fast model via configurable summarization_providers
 *    to minimize cost overhead (US-978)
 */

import type { ChatMessage } from './types.js';
import { configStore } from './config-store.js';
import { chatWithFallback, getAISettings, isAIAvailable } from './ai-provider-manager.js';
import { estimateTokens, estimateMessagesTokens } from '../lib/token-counter.js';

const DEFAULT_MAX_CONTEXT_TOKENS = 6000;
const DEFAULT_KEEP_RECENT_TURNS = 4; // 4 turns = 8 messages (user + assistant)

export interface PruningResult {
  messages: ChatMessage[];
  wasPruned: boolean;
  originalTokens: number;
  prunedTokens: number;
  originalCount: number;
  prunedCount: number;
}

/**
 * Get pruning config from settings.json conversation_management section.
 */
function getPruningConfig(): {
  maxContextTokens: number;
  keepRecentTurns: number;
  enabled: boolean;
  summarizationProviders: string[];
} {
  const settings = configStore.getSettings();
  const config = settings.conversation_management;

  return {
    enabled: config?.enabled ?? true,
    maxContextTokens: (config as any)?.max_context_tokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
    keepRecentTurns: (config as any)?.keep_recent_turns ?? DEFAULT_KEEP_RECENT_TURNS,
    summarizationProviders: (config as any)?.summarization_providers ?? [],
  };
}

/**
 * Apply token-aware context pruning to conversation messages.
 *
 * If total tokens exceed maxContextTokens, older messages (beyond the
 * last keepRecentTurns * 2 messages) are summarized into a single
 * "[Conversation Summary]" assistant message.
 *
 * @param messages - Conversation history (excluding current user message)
 * @returns Pruned messages that fit within the token budget
 */
export async function pruneContext(messages: ChatMessage[]): Promise<PruningResult> {
  const config = getPruningConfig();

  if (!config.enabled) {
    return {
      messages,
      wasPruned: false,
      originalTokens: estimateMessagesTokens(messages),
      prunedTokens: estimateMessagesTokens(messages),
      originalCount: messages.length,
      prunedCount: messages.length,
    };
  }

  const originalTokens = estimateMessagesTokens(messages);

  // If within budget, return as-is
  if (originalTokens <= config.maxContextTokens) {
    return {
      messages,
      wasPruned: false,
      originalTokens,
      prunedTokens: originalTokens,
      originalCount: messages.length,
      prunedCount: messages.length,
    };
  }

  // Split: keep recent turns verbatim, summarize older ones
  const keepCount = config.keepRecentTurns * 2; // turns -> messages (user + assistant)
  const recentMessages = messages.slice(-keepCount);
  const olderMessages = messages.slice(0, -keepCount);

  // If no older messages to summarize, just return recent (edge case)
  if (olderMessages.length === 0) {
    return {
      messages: recentMessages,
      wasPruned: true,
      originalTokens,
      prunedTokens: estimateMessagesTokens(recentMessages),
      originalCount: messages.length,
      prunedCount: recentMessages.length,
    };
  }

  console.log(
    `[ContextPruner] Budget exceeded: ${originalTokens} tokens > ${config.maxContextTokens} limit. ` +
    `Summarizing ${olderMessages.length} older messages, keeping ${recentMessages.length} recent.`
  );

  try {
    const summary = await summarizeMessages(olderMessages, config.summarizationProviders);

    const summaryMessage: ChatMessage = {
      role: 'assistant',
      content: `[Conversation Summary]: ${summary}`,
      timestamp: olderMessages[0]?.timestamp || Math.floor(Date.now() / 1000),
    };

    const prunedMessages = [summaryMessage, ...recentMessages];
    const prunedTokens = estimateMessagesTokens(prunedMessages);

    console.log(
      `[ContextPruner] Pruned: ${originalTokens} -> ${prunedTokens} tokens ` +
      `(${Math.round((1 - prunedTokens / originalTokens) * 100)}% reduction), ` +
      `${messages.length} -> ${prunedMessages.length} messages`
    );

    return {
      messages: prunedMessages,
      wasPruned: true,
      originalTokens,
      prunedTokens,
      originalCount: messages.length,
      prunedCount: prunedMessages.length,
    };
  } catch (error: any) {
    console.error(`[ContextPruner] Summarization failed: ${error.message}. Falling back to truncation.`);

    // Fallback: just keep recent messages without summary
    return {
      messages: recentMessages,
      wasPruned: true,
      originalTokens,
      prunedTokens: estimateMessagesTokens(recentMessages),
      originalCount: messages.length,
      prunedCount: recentMessages.length,
    };
  }
}

/**
 * US-978: Summarize a set of messages into a concise paragraph.
 * Uses configurable summarization_providers to route to a cheap/fast model,
 * minimising cost overhead for summarisation calls.
 *
 * @param messages - Older messages to summarize
 * @param providerIds - Optional list of cheap provider IDs for summarization
 */
async function summarizeMessages(messages: ChatMessage[], providerIds?: string[]): Promise<string> {
  if (!isAIAvailable()) {
    throw new Error('AI not available for summarization');
  }

  const conversationText = messages
    .map(m => `${m.role === 'user' ? 'Guest' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const systemPrompt = 'You are a concise summarizer. Preserve all named entities and key facts.';
  const userPrompt = `Summarize this conversation into 2-3 concise sentences. Preserve: user name, items ordered/requested, any commitments made, outstanding questions, dates, capsule/room numbers, booking references, complaint details, phone numbers.

Conversation:
${conversationText}

Summary:`;

  const llmMessages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const aiCfg = getAISettings();
  const useProviders = providerIds && providerIds.length > 0 ? providerIds : undefined;

  if (useProviders) {
    console.log(`[ContextPruner] US-978: Using cheap model(s) for summarization: ${useProviders.join(', ')}`);
  }

  const { content } = await chatWithFallback(
    llmMessages,
    aiCfg.max_chat_tokens,
    aiCfg.chat_temperature,
    false,
    useProviders
  );

  if (content) return content;
  throw new Error('Summarization returned empty content');
}
