/**
 * relevance-scorer.ts — Conversation Context Relevance Scoring (US-553)
 *
 * Scores historical conversation messages by relevance to the current user intent,
 * enabling token-aware context filtering to reduce bloat in multi-turn dialogues.
 *
 * Scoring formula (weighted sum, 0–1 range):
 *   40% — Keyword overlap: message contains keywords matching the detected intent
 *   30% — Recency decay: messages from the last N minutes score higher
 *   30% — Turn distance: messages closer to the current turn score higher
 */

import type { ChatMessage } from '../assistant/types.js';
import intentKeywordsData from '../assistant/data/intent-keywords.json' assert { type: 'json' };

const RECENCY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Build a flat lowercase keyword list for a given intent from all languages.
 */
function getIntentKeywords(intent: string): string[] {
  const intentEntry = (intentKeywordsData as any).intents?.find(
    (i: any) => i.intent === intent
  );
  if (!intentEntry?.keywords) return [];

  const allKeywords: string[] = [];
  for (const lang of Object.values(intentEntry.keywords) as string[][]) {
    for (const kw of lang) {
      allKeywords.push(kw.toLowerCase());
    }
  }
  return allKeywords;
}

/**
 * Compute the keyword overlap sub-score (0–1).
 *
 * Returns 1.0 if the message content matches at least one intent keyword,
 * 0.0 otherwise. Simple binary match is sufficient for this use case.
 */
function keywordOverlapScore(message: ChatMessage, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const lower = message.content.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw)) return 1;
  }
  return 0;
}

/**
 * Compute the recency decay sub-score (0–1).
 *
 * Messages within RECENCY_WINDOW_MS of `nowMs` score 1.0; older messages
 * score linearly lower toward 0.0.
 */
function recencyScore(message: ChatMessage, nowMs: number): number {
  const ageMs = nowMs - message.timestamp;
  if (ageMs <= 0) return 1;
  if (ageMs >= RECENCY_WINDOW_MS) return 0;
  return 1 - ageMs / RECENCY_WINDOW_MS;
}

/**
 * Compute the turn-distance sub-score (0–1).
 *
 * The most recent message gets 1.0; each step back reduces the score
 * proportionally. Turn-0 (current) messages are not passed here (they come
 * from the live input), so the oldest message in `allMessages` gets ~0.
 */
function turnDistanceScore(message: ChatMessage, allMessages: ChatMessage[]): number {
  const total = allMessages.length;
  if (total === 0) return 0;
  const idx = allMessages.indexOf(message);
  if (idx === -1) return 0;
  // idx 0 = oldest, idx (total-1) = most recent
  return (idx + 1) / total;
}

/**
 * Score a single conversation message against the current intent.
 *
 * @param message   - The historical message to score
 * @param intent    - The currently detected user intent (e.g. "booking", "check_in")
 * @param allMessages - Full ordered message history (oldest → newest)
 * @param nowMs     - Current timestamp in milliseconds (defaults to Date.now())
 * @returns A relevance score in [0, 1]
 */
export function scoreMessageRelevance(
  message: ChatMessage,
  intent: string,
  allMessages: ChatMessage[],
  nowMs: number = Date.now()
): number {
  const keywords = getIntentKeywords(intent);

  const kwScore = keywordOverlapScore(message, keywords);
  const recency = recencyScore(message, nowMs);
  const turnDist = turnDistanceScore(message, allMessages);

  return 0.4 * kwScore + 0.3 * recency + 0.3 * turnDist;
}
