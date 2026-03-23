/**
 * context-manager.ts — Conversation message relevance scoring and pruning
 *
 * Implements message relevance scoring to identify and prune stale context
 * from conversation history when it exceeds capacity.
 */

import type { ChatMessage } from '../types.js';

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
 * @param nowMs Current timestamp in milliseconds
 * @returns Relevance score between 0 and 1
 */
export function scoreMessageRelevance(
  message: ChatMessage,
  currentIntent: string,
  messageIndex: number,
  totalMessages: number,
  nowMs: number
): number {
  let score = 0.5; // Base score

  // Role boost: assistant messages are more informative
  if (message.role === 'assistant') {
    score += 0.15;
  }

  // Intent keyword matching
  const contentLower = message.content.toLowerCase();
  const intentKeywords = getIntentKeywords(currentIntent);
  let keywordMatches = 0;
  for (const keyword of intentKeywords) {
    if (contentLower.includes(keyword)) {
      keywordMatches++;
    }
  }
  // Boost by number of matching keywords (up to 0.25)
  score += Math.min(keywordMatches * 0.08, 0.25);

  // Penalize generic phrases
  const genericPhrases = ['ok', 'thanks', 'hi', 'hello', 'bye', 'sure', 'yes', 'no', 'ok thanks'];
  const genericCount = genericPhrases.filter(p => contentLower.includes(p)).length;
  score -= Math.min(genericCount * 0.05, 0.15);

  // Temporal decay: newer messages score higher
  // messageIndex 0 = oldest, totalMessages-1 = newest
  const recencyFactor = messageIndex / Math.max(totalMessages - 1, 1);
  score += recencyFactor * 0.15;

  // Clamp to 0-1
  return Math.max(0, Math.min(score, 1));
}

/**
 * Get intent-specific keywords for relevance matching
 */
function getIntentKeywords(intent: string): string[] {
  const keywordMap: Record<string, string[]> = {
    booking: ['book', 'booking', 'reserve', 'check in', 'check out', 'nights', 'stay', 'dates'],
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

  const now = Date.now();

  // Calculate relevance scores for each message
  const scored = history.map((msg, idx) => ({
    message: msg,
    score: scoreMessageRelevance(msg, currentIntent, idx, history.length, now),
    originalIndex: idx,
  }));

  // Always keep first and last message as anchors
  const firstMsg = scored[0];
  const lastMsg = scored[scored.length - 1];

  // Filter middle messages by relevance threshold
  const middle = scored.slice(1, -1).filter(item => item.score >= relevanceThreshold);

  // Ensure we keep at least 2 messages total (first + last or at least first + one more)
  const result = [firstMsg, ...middle, lastMsg];

  // If we somehow have fewer than 2 unique messages, ensure at least 2
  const uniqueResult = Array.from(
    new Map(result.map(item => [item.originalIndex, item])).values()
  );

  if (uniqueResult.length < 2 && history.length >= 2) {
    // Keep at least the first and last
    return [history[0], history[history.length - 1]];
  }

  // Return messages in original order
  return uniqueResult
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map(item => item.message);
}
