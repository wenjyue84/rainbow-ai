/**
 * fallback-selector.ts — Context-aware fallback response selection
 *
 * When intent classification confidence < 0.70, loads the last 5 messages
 * and computes semantic relevance scores for all knowledge.json fallback options.
 * Selects the highest-scoring fallback; if score < 0.55, sets escalation_required=true.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Type Definitions ────────────────────────────────────────────────

export interface FallbackOption {
  intent: string;
  response: Record<string, string>;
  semantic_category?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface FallbackSelectionResult {
  fallback_intent: string;
  fallback_response: string;
  relevance_score: number;
  escalation_required: boolean;
  escalation_reason?: string;
}

// ─── Embedding & Scoring Functions ──────────────────────────────────

/**
 * Tokenize text into words
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2);
}

/**
 * Compute simple embedding vector using term frequency
 * Returns a map of term -> frequency
 */
function computeEmbedding(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const embedding = new Map<string, number>();

  for (const token of tokens) {
    embedding.set(token, (embedding.get(token) || 0) + 1);
  }

  return embedding;
}

/**
 * Compute cosine similarity between two embedding vectors
 */
function cosineSimilarity(
  vec1: Map<string, number>,
  vec2: Map<string, number>
): number {
  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  // Get all unique keys
  const allKeys = new Set([...vec1.keys(), ...vec2.keys()]);

  // Compute dot product and magnitudes
  for (const key of allKeys) {
    const val1 = vec1.get(key) || 0;
    const val2 = vec2.get(key) || 0;

    dotProduct += val1 * val2;
    magnitude1 += val1 * val1;
    magnitude2 += val2 * val2;
  }

  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);

  if (magnitude1 === 0 || magnitude2 === 0) return 0;
  return dotProduct / (magnitude1 * magnitude2);
}

// ─── Context Loading ────────────────────────────────────────────────

let cachedFallbackOptions: FallbackOption[] | null = null;

/**
 * Load fallback options from knowledge.json (cached)
 */
function loadFallbackOptions(): FallbackOption[] {
  if (cachedFallbackOptions) {
    return cachedFallbackOptions;
  }

  try {
    const knowledgePath = path.join(__dirname, 'data', 'knowledge.json');
    const content = fs.readFileSync(knowledgePath, 'utf-8');
    const knowledge = JSON.parse(content);
    cachedFallbackOptions = knowledge.static || [];
    return cachedFallbackOptions;
  } catch (error) {
    console.warn('[Fallback Selector] Failed to load knowledge.json:', error);
    return [];
  }
}

/**
 * Combine conversation history into a single context string
 * Uses last 5 messages
 */
function buildContextString(conversationHistory: ConversationMessage[]): string {
  // Take last 5 messages
  const recentMessages = conversationHistory.slice(-5);
  return recentMessages.map(msg => msg.content).join(' ');
}

// ─── Fallback Selection Logic ───────────────────────────────────────

/**
 * Select the most relevant fallback response based on conversation context
 *
 * @param conversationHistory Last messages from conversation
 * @param language Language preference ('en', 'ms', 'zh', 'ta')
 * @returns Selected fallback response with score and escalation flag
 */
export function selectFallback(
  conversationHistory: ConversationMessage[],
  language: string = 'en'
): FallbackSelectionResult {
  const MIN_RELEVANCE_THRESHOLD = 0.55;

  // Load available fallback options
  const fallbackOptions = loadFallbackOptions();
  if (fallbackOptions.length === 0) {
    return {
      fallback_intent: 'unknown',
      fallback_response: '',
      relevance_score: 0,
      escalation_required: true,
      escalation_reason: 'No fallback options available in knowledge.json',
    };
  }

  // Build context from conversation history
  const contextString = buildContextString(conversationHistory);
  if (!contextString.trim()) {
    return {
      fallback_intent: 'unknown',
      fallback_response: '',
      relevance_score: 0,
      escalation_required: true,
      escalation_reason: 'Empty conversation context',
    };
  }

  // Compute embedding for context
  const contextEmbedding = computeEmbedding(contextString);

  // Score each fallback option
  let bestFallback: FallbackOption | null = null;
  let bestScore = -1;

  for (const fallback of fallbackOptions) {
    // Use response text in the requested language, fallback to English
    const responseText = fallback.response[language] || fallback.response.en || '';
    if (!responseText) continue;

    const fallbackEmbedding = computeEmbedding(responseText);
    const score = cosineSimilarity(contextEmbedding, fallbackEmbedding);

    if (score > bestScore) {
      bestScore = score;
      bestFallback = fallback;
    }
  }

  // Determine if escalation is needed
  const escalationRequired = bestScore < MIN_RELEVANCE_THRESHOLD;

  if (!bestFallback) {
    return {
      fallback_intent: 'unknown',
      fallback_response: '',
      relevance_score: 0,
      escalation_required: true,
      escalation_reason: 'No matching fallback found',
    };
  }

  const fallbackResponse = bestFallback.response[language] || bestFallback.response.en || '';

  return {
    fallback_intent: bestFallback.intent,
    fallback_response: fallbackResponse,
    relevance_score: parseFloat(bestScore.toFixed(4)),
    escalation_required: escalationRequired,
    ...(escalationRequired && {
      escalation_reason: `Fallback relevance score ${bestScore.toFixed(4)} is below minimum threshold of ${MIN_RELEVANCE_THRESHOLD}`,
    }),
  };
}

/**
 * Simpler variant: select fallback for a specific query string
 * Useful for testing or direct fallback selection without conversation context
 */
export function selectFallbackForQuery(
  query: string,
  language: string = 'en'
): FallbackSelectionResult {
  const conversationHistory: ConversationMessage[] = [
    { role: 'user', content: query },
  ];
  return selectFallback(conversationHistory, language);
}
