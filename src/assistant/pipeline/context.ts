/**
 * context.ts — Conversation Context Relevance Reranker (US-308)
 *
 * Scores conversation messages by combining intent keyword overlap
 * and temporal recency decay. Used to filter history to the most
 * relevant messages before AI inference in multi-turn booking dialogs.
 */

import type { ChatMessage } from '../types.js';

/** Recency half-life: score halves every 5 minutes (300 seconds) */
const DEFAULT_HALF_LIFE_SECONDS = 300;

/** Intent-specific keyword banks for overlap scoring */
const INTENT_KEYWORDS: Record<string, string[]> = {
  booking: ['book', 'booking', 'reserve', 'reservation', 'check in', 'check out', 'nights', 'stay', 'dates', 'room', 'guests'],
  pricing: ['price', 'cost', 'rate', 'per night', 'how much', 'charge', 'payment', 'fee', 'total'],
  room_type: ['room', 'type', 'double', 'single', 'suite', 'upgrade', 'downgrade', 'bed'],
  availability: ['available', 'free', 'booked', 'open', 'vacant', 'availability', 'full'],
  checkout_info: ['check out', 'checkout', 'leave', 'depart', 'final', 'bill', 'receipt'],
  checkin_info: ['check in', 'checkin', 'arrive', 'arrival', 'keys', 'welcome'],
  greeting: ['hello', 'hi', 'hey', 'greetings', 'good morning', 'good afternoon'],
  wifi: ['wifi', 'wi-fi', 'internet', 'connection', 'password', 'network'],
  facilities: ['facility', 'facilities', 'amenities', 'gym', 'pool', 'kitchen', 'laundry', 'parking'],
  complaint: ['complaint', 'issue', 'problem', 'broken', 'not working', 'help', 'fix', 'dirty'],
};

/** Profile-specific keyword supplements */
const PROFILE_SUPPLEMENTS: Record<string, Record<string, string[]>> = {
  'data-southern': {
    booking: ['southern', 'homestay', 'villa', 'house'],
    facilities: ['bbq', 'garden', 'patio'],
  },
  'data-pelangi': {
    booking: ['pelangi', 'capsule', 'hostel', 'dorm'],
    facilities: ['locker', 'shower', 'common area'],
  },
};

/**
 * Score a single message for relevance to the current intent and profile.
 *
 * Score = keyword overlap (0-0.5) + recency decay (0-0.5)
 *
 * Keyword overlap: each matching keyword contributes 0.1, capped at 0.5.
 * Recency decay: exponential decay with 5-minute half-life.
 *
 * Note: message.timestamp is Unix epoch in SECONDS (per IncomingMessage contract).
 *
 * @param message       The chat message to score
 * @param currentIntent The current classified intent (e.g., "booking")
 * @param profile       The profile context (e.g., "data-pelangi")
 * @returns Relevance score in [0, 1]
 */
export function scoreMessageRelevance(
  message: ChatMessage,
  currentIntent: string,
  profile: string,
): number {
  if (!message.content || message.content.trim() === '') {
    return 0;
  }

  // ── Keyword overlap score (0-0.5) ─────────────────────────────────
  const contentLower = message.content.toLowerCase();
  const baseKeywords = INTENT_KEYWORDS[currentIntent] ?? [];
  const profileSupp = PROFILE_SUPPLEMENTS[profile]?.[currentIntent] ?? [];
  const allKeywords = [...baseKeywords, ...profileSupp];

  const matchCount = allKeywords.filter(kw => contentLower.includes(kw)).length;
  const keywordScore = Math.min(matchCount * 0.1, 0.5);

  // ── Recency decay score (0-0.5) ───────────────────────────────────
  // message.timestamp is Unix seconds; Date.now() is milliseconds
  const nowSeconds = Date.now() / 1000;
  const ageSeconds = Math.max(0, nowSeconds - message.timestamp);
  const lambda = Math.LN2 / DEFAULT_HALF_LIFE_SECONDS;
  const recencyScore = 0.5 * Math.exp(-lambda * ageSeconds);

  return Math.max(0, Math.min(1, keywordScore + recencyScore));
}

/**
 * Filter conversation history to the top-N most relevant messages.
 *
 * - Scores all messages against the current intent and profile
 * - Selects the top topN messages by score (above threshold)
 * - Always includes the most recent message
 * - Returns messages in original chronological order
 *
 * @param messages      Conversation history (chronological)
 * @param currentIntent The current classified intent
 * @param profile       The profile context
 * @param topN          Maximum messages to keep (default: 5)
 * @param threshold     Minimum relevance score to qualify (default: 0.05)
 * @returns Filtered messages in original chronological order
 */
export function filterContextByRelevance(
  messages: ChatMessage[],
  currentIntent: string,
  profile: string,
  topN: number = 5,
  threshold: number = 0.05,
): ChatMessage[] {
  if (messages.length <= topN) {
    return messages;
  }

  const scored = messages.map((msg, idx) => ({
    msg,
    idx,
    score: scoreMessageRelevance(msg, currentIntent, profile),
  }));

  // Keep messages above threshold, sorted by score descending, take top N
  const qualified = scored
    .filter(s => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  // Always include the most recent message
  const lastIdx = messages.length - 1;
  if (!qualified.some(s => s.idx === lastIdx)) {
    if (qualified.length >= topN) qualified.pop();
    qualified.push(scored[lastIdx]);
  }

  // Return in original chronological order
  return qualified
    .sort((a, b) => a.idx - b.idx)
    .map(s => s.msg);
}
