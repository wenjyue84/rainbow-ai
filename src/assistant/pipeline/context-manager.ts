/**
 * context-manager.ts — Conversation message relevance scoring and pruning
 *
 * Implements message relevance scoring to identify and prune stale context
 * from conversation history when it exceeds capacity.
 *
 * US-307: Logs WARN and increments a counter when conversation turns exceed
 * the context window size, tracking which profiles and intents generate
 * longer multi-turn dialogues.
 */

import type { ChatMessage } from '../types.js';
import { metrics } from '@opentelemetry/api';
import { createModuleLogger } from '../../lib/logger.js';

const logger = createModuleLogger('ContextManager');

/**
 * US-307: Maximum conversation turns before truncation warning fires.
 */
export const CONTEXT_WINDOW_SIZE = 10;

// ─── US-307: Prometheus-style counter via OpenTelemetry ─────────────
const meter = metrics.getMeter('rainbow-ai');

/**
 * Counter incremented each time a conversation exceeds CONTEXT_WINDOW_SIZE.
 * Labels: profile, intent.
 */
export const contextTruncationsCounter = meter.createCounter(
  'conversation_context_truncations_total',
  {
    description: 'Number of times a conversation exceeded the context window size and was truncated',
  },
);

/**
 * US-307: Check whether the conversation history exceeds the context window
 * size and, if so, emit a WARN log and increment the truncation counter.
 *
 * @param turnCount Number of turns (messages) in the conversation
 * @param profile   Profile identifier (e.g. "data-pelangi", "data-southern")
 * @param intent    Current classified intent
 * @returns true if truncation was detected (turnCount > CONTEXT_WINDOW_SIZE)
 */
export function checkContextTruncation(
  turnCount: number,
  profile: string,
  intent: string,
): boolean {
  if (turnCount > CONTEXT_WINDOW_SIZE) {
    logger.warn(
      `Context window exceeded: ${turnCount} turns (limit ${CONTEXT_WINDOW_SIZE})`,
      { profile, intent, turn_count: turnCount },
    );

    contextTruncationsCounter.add(1, { profile, intent });
    return true;
  }
  return false;
}

/**
 * Score a message for relevance to the current intent
 *
 * Scoring factors:
 * - Message role (assistant > user)
 * - Intent-related keywords
 * - Generic phrase penalties
 * - Temporal decay (older = lower)
 *
 * @param message The message to score
 * @param currentIntent The current intent being processed
 * @param messageIndex Position in history (0 = oldest)
 * @param totalMessages Total number of messages in history
 * @returns Relevance score between 0 and 1
 */
export function scoreMessageRelevance(
  message: ChatMessage,
  currentIntent: string,
  messageIndex: number,
  totalMessages: number
): number {
  // Return 0 for empty messages
  if (!message.content || message.content.trim() === '') {
    return 0;
  }

  let score = 0.27; // Base score for non-empty messages

  // Intent keyword matching
  const contentLower = message.content.toLowerCase();
  const intentKeywords = getIntentKeywords(currentIntent);
  let keywordMatches = 0;
  for (const keyword of intentKeywords) {
    if (contentLower.includes(keyword)) {
      keywordMatches++;
    }
  }
  // Boost by number of matching keywords (up to 0.1)
  score += Math.min(keywordMatches * 0.1, 0.1);

  // Role boost: assistant messages are more informative
  if (message.role === 'assistant') {
    score += 0.06;
  }

  // Temporal decay: newer messages score higher
  // messageIndex 0 = oldest, totalMessages-1 = newest
  const recencyFactor = messageIndex / Math.max(totalMessages - 1, 1);
  score += recencyFactor * 0.2;

  // Penalize generic phrases heavily
  const genericPhrases = ['ok', 'thanks', 'hi', 'hello', 'bye', 'sure', 'yes', 'no', 'ok thanks'];
  const genericCount = genericPhrases.filter(p => contentLower.includes(p)).length;
  score -= Math.min(genericCount * 0.1, 0.25);

  // Clamp to 0-1
  return Math.max(0, Math.min(score, 1));
}

/**
 * Get intent-specific keywords for relevance matching
 */
function getIntentKeywords(intent: string): string[] {
  const keywordMap: Record<string, string[]> = {
    booking: ['book', 'booking', 'reserve', 'check in', 'check out', 'nights', 'stay', 'dates', 'room'],
    pricing: ['price', 'cost', 'rate', 'per night', 'how much', 'charge', '$', 'payment'],
    room_type: ['room', 'type', 'double', 'single', 'suite', 'upgrade', 'downgrade'],
    availability: ['available', 'free', 'booked', 'open', 'vacant', 'availability'],
    checkout: ['check out', 'checkout', 'leave', 'depart', 'final', 'bill'],
    checkin: ['check in', 'checkin', 'arrive', 'arrival', 'keys', 'welcome'],
    greeting: ['hello', 'hi', 'hey', 'greetings', 'good morning', 'good afternoon'],
    wifi: ['wifi', 'wi-fi', 'internet', 'connection', 'password', 'network'],
    facilities: ['facility', 'facilities', 'amenities', 'gym', 'pool', 'kitchen', 'laundry'],
    complaint: ['complaint', 'issue', 'problem', 'broken', 'not working', 'help', 'fix'],
  };

  return keywordMap[intent] || [];
}

/**
 * Filter conversation history by relevance to current intent
 *
 * Alias for pruneContextByRelevance with parameter order adjusted.
 * Used by tests and some callers that expect a different parameter order.
 *
 * @param messages The conversation history
 * @param intent The current intent being processed
 * @param relevanceThreshold Minimum relevance score to keep (e.g., 0.3)
 * @param maxThresholdLength Maximum length before pruning triggers (e.g., 8)
 * @returns Filtered conversation history
 */
export function filterByRelevance(
  messages: ChatMessage[],
  intent: string,
  relevanceThreshold: number,
  maxThresholdLength: number
): ChatMessage[] {
  return pruneContextByRelevance(messages, intent, maxThresholdLength, relevanceThreshold);
}

/**
 * Prune conversation history by relevance scores
 *
 * Removes low-relevance messages when history exceeds threshold,
 * while preserving recent/important context.
 *
 * @param history The full conversation history
 * @param currentIntent The current intent being processed
 * @param thresholdLength Minimum length before pruning triggers (e.g., 8)
 * @param relevanceThreshold Minimum relevance score to keep (e.g., 0.3)
 * @returns Pruned conversation history
 */
export function pruneContextByRelevance(
  history: ChatMessage[],
  currentIntent: string,
  thresholdLength: number,
  relevanceThreshold: number
): ChatMessage[] {
  // Don't prune if below threshold
  if (history.length <= thresholdLength) {
    return history;
  }

  // Calculate relevance scores for each message
  const scored = history.map((msg, idx) => ({
    message: msg,
    score: scoreMessageRelevance(msg, currentIntent, idx, history.length),
    originalIndex: idx,
  }));

  // Filter messages by relevance threshold
  const filtered = scored.filter(item => item.score >= relevanceThreshold);

  // Ensure we keep at least the last message (most recent)
  const lastMsg = scored[scored.length - 1];
  if (!filtered.includes(lastMsg)) {
    filtered.push(lastMsg);
  }

  // If we filtered too much and have fewer than 2 messages, keep at least 2
  if (filtered.length < 2 && history.length >= 2) {
    // Find the 2 highest-scoring messages
    const topTwo = scored.sort((a, b) => b.score - a.score).slice(0, 2);
    return topTwo
      .sort((a, b) => a.originalIndex - b.originalIndex)
      .map(item => item.message);
  }

  // Return messages in original order
  return filtered
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map(item => item.message);
}
