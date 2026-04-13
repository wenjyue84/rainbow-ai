/**
 * context.ts — Conversation Context Message Relevance Scorer with Embeddings (US-369)
 *
 * Scores message relevance to current intent using embedding-based cosine similarity.
 * Filters low-relevance messages to prevent token waste and context pollution.
 */

import type { ChatMessage } from './types.js';

/**
 * Get character n-grams from text (3-grams by default).
 * Used for computing text similarity via cosine similarity of n-gram vectors.
 *
 * Example: "booking" → ["boo", "ook", "oki", "kin", "ing"]
 *
 * @param text The text to extract n-grams from
 * @param nGramSize Size of n-gram (default: 3)
 * @returns Set of n-grams
 */
export function getNGrams(text: string, nGramSize: number = 3): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\w]/g, '');
  const ngrams = new Set<string>();

  for (let i = 0; i <= normalized.length - nGramSize; i++) {
    ngrams.add(normalized.substring(i, i + nGramSize));
  }

  return ngrams;
}

/**
 * Simple text embedding: character n-gram frequency vector.
 * Returns a normalized frequency map where keys are character 3-grams.
 *
 * @param text The text to embed
 * @returns Record<ngram, frequency>
 */
export function getTextEmbedding(text: string): Record<string, number> {
  if (!text || text.trim() === '') {
    return {};
  }

  const ngrams = getNGrams(text);
  const embedding: Record<string, number> = {};

  for (const ngram of ngrams) {
    embedding[ngram] = (embedding[ngram] ?? 0) + 1;
  }

  // Normalize by total n-gram count
  const totalNGrams = Object.values(embedding).reduce((sum, count) => sum + count, 0);
  if (totalNGrams > 0) {
    for (const ngram in embedding) {
      embedding[ngram] /= totalNGrams;
    }
  }

  return embedding;
}

/**
 * Compute cosine similarity between two embedding vectors.
 *
 * cosine_similarity = (A · B) / (||A|| * ||B||)
 * where · is dot product and ||A|| is the magnitude
 *
 * @param embedding1 First embedding vector
 * @param embedding2 Second embedding vector
 * @returns Cosine similarity score (0-1)
 */
export function cosineSimilarity(
  embedding1: Record<string, number>,
  embedding2: Record<string, number>,
): number {
  if (Object.keys(embedding1).length === 0 || Object.keys(embedding2).length === 0) {
    return 0;
  }

  // Compute dot product
  let dotProduct = 0;
  for (const word in embedding1) {
    if (word in embedding2) {
      dotProduct += embedding1[word] * embedding2[word];
    }
  }

  // Compute magnitudes
  const magnitude1 = Math.sqrt(
    Object.values(embedding1).reduce((sum, val) => sum + val * val, 0),
  );
  const magnitude2 = Math.sqrt(
    Object.values(embedding2).reduce((sum, val) => sum + val * val, 0),
  );

  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }

  return dotProduct / (magnitude1 * magnitude2);
}

/**
 * Score a message's semantic relevance to a given intent.
 *
 * Uses character n-gram embedding + cosine similarity + keyword boost.
 *
 * Algorithm:
 * 1. Extract character 3-grams from both message and intent
 * 2. Create frequency vectors from n-grams
 * 3. Compute cosine similarity between the vectors
 * 4. Boost score if message contains the intent word or morphological variant
 *
 * This approach naturally handles morphological variants (book → booking)
 * through n-gram matching, while also directly rewarding intent keywords.
 *
 * Example:
 *  - Message: "I want to book a room" + Intent: "booking"
 *    → n-gram similarity (~0.2) + keyword boost (0.4) = ~0.6
 *  - Message: "Where is the bathroom?" + Intent: "booking"
 *    → n-gram similarity (~0.05) + no keyword boost = ~0.05
 *
 * @param message The chat message with content and timestamp
 * @param intent The current classified intent (e.g., "booking", "wifi")
 * @returns Relevance score between 0 and 1
 */
export function scoreMessageRelevance(message: ChatMessage, intent: string): number {
  if (!message.content || message.content.trim() === '') {
    return 0;
  }

  // Get n-gram embeddings for both message and intent
  const messageEmbedding = getTextEmbedding(message.content);
  const intentEmbedding = getTextEmbedding(intent);

  // Base score from n-gram cosine similarity
  let score = cosineSimilarity(messageEmbedding, intentEmbedding);

  // Keyword boost: check if message contains intent word or morphological variants
  const messageLower = message.content.toLowerCase().replace(/[^\w]/g, '');
  const intentLower = intent.toLowerCase();

  // Boost if message contains the intent word itself (exact match)
  if (messageLower.includes(intentLower)) {
    score = Math.min(1, score + 0.4);
  }
  // Boost for morphological variants where either:
  // 1. Intent is plural/variant of message word (e.g., "book" → "booking", "check" → "checkin")
  // 2. Message is plural/variant of intent (e.g., "bookings" contains "booking")
  else if (intentLower.startsWith(messageLower) && messageLower.length > 2) {
    // Intent contains message as root (e.g., "booking" starts with "book")
    score = Math.min(1, score + 0.35);
  } else if (messageLower.includes(intentLower.substring(0, Math.min(4, intentLower.length)))) {
    // Message contains first 4 chars of intent
    score = Math.min(1, score + 0.25);
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Filter conversation history by message relevance to current intent.
 *
 * - If messages.length <= topN, returns all messages unchanged
 * - Otherwise, removes messages with relevance_score < threshold
 * - Always includes the most recent message to maintain conversation continuity
 *
 * @param messages Conversation history (chronological)
 * @param intent The current classified intent
 * @param topN Maximum messages to keep (default: 5)
 * @param threshold Minimum relevance score to keep (default: 0.3)
 * @returns Filtered messages in original chronological order
 */
export function filterContextByRelevance(
  messages: ChatMessage[],
  intent: string,
  topN: number = 5,
  threshold: number = 0.3,
): ChatMessage[] {
  if (messages.length === 0) {
    return [];
  }

  // If small conversation, keep all messages
  if (messages.length <= topN) {
    return messages;
  }

  // Score all messages
  const scored = messages.map((msg, idx) => ({
    msg,
    idx,
    score: scoreMessageRelevance(msg, intent),
  }));

  // Keep messages above threshold, sorted by score descending, take top N
  const qualified = scored
    .filter(s => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  // Always include the most recent message (to maintain context continuity)
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
