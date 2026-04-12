/**
 * Message Processor with Conversation Query Cache (US-526)
 *
 * Wraps LLM calls with the ConversationCache (Redis-backed L1/L2).
 * Cache key = SHA256(conversation_id + normalized_query), TTL = 300s.
 *
 * Usage:
 *   const result = await processQueryWithCache(
 *     conversationId,
 *     userQuery,
 *     async (query) => callLLM(query),
 *   );
 *   // result.source === 'cache' on hit, 'llm' on miss
 */

import { conversationCache, CONVERSATION_CACHE_TTL_SECONDS } from '../../lib/conversation-cache.js';
import { createModuleLogger } from '../../lib/logger.js';

const logger = createModuleLogger('MessageProcessor');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProcessQueryResult {
  response: string;
  source: 'cache' | 'llm';
}

// ─── Core Function ────────────────────────────────────────────────────────────

/**
 * Process a user query with transparent cache-through logic.
 *
 * 1. Compute cache key for (conversationId, query).
 * 2. On cache hit: return stored response with source='cache' in <10ms.
 * 3. On cache miss: invoke llmCaller, store result, return with source='llm'.
 *
 * @param conversationId - Unique identifier for the conversation (e.g. phone number)
 * @param query          - Raw user query text (normalized before hashing)
 * @param llmCaller      - Async function that calls the LLM and returns a response string
 * @returns ProcessQueryResult with response text and source metadata
 */
export async function processQueryWithCache(
  conversationId: string,
  query: string,
  llmCaller: (query: string) => Promise<string>,
): Promise<ProcessQueryResult> {
  const key = conversationCache.cacheKey(conversationId, query);

  // ── Cache check ───────────────────────────────────────────────────────────
  const cached = conversationCache.get(key);
  if (cached) {
    logger.debug(`[US-526] Cache HIT conv=${conversationId.slice(-4)} key=${key.slice(0, 8)}…`);
    return { response: cached.response, source: 'cache' };
  }

  // ── LLM call (cache miss) ─────────────────────────────────────────────────
  logger.debug(`[US-526] Cache MISS conv=${conversationId.slice(-4)} — calling LLM`);
  const response = await llmCaller(query);

  // Store result only when LLM returned a non-empty response
  if (response) {
    conversationCache.set(
      key,
      { intent: 'cached', action: 'reply', response, confidence: 1 },
      CONVERSATION_CACHE_TTL_SECONDS,
    );
  }

  return { response, source: 'llm' };
}
