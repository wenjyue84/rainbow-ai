/**
 * disambiguator.ts — Multi-intent disambiguation
 *
 * When top N intents have similar confidence scores (within 5%), generates
 * clarifying questions to disambiguate instead of guessing.
 *
 * US-551: Generate Clarifying Questions for Ambiguous Multi-Intent Classifications
 */

import type { AIResponse } from './ai-response-generator.js';
import type { ConfigStore } from './config-store.js';
import { configStore } from './config-store.js';
import type { SupportedLanguage } from './language-router.js';
import { classifyAndRespond } from './ai-response-generator.js';
import disambiguationPromptsData from './data/disambiguation-prompts.json' assert { type: 'json' };

// ─── Types ──────────────────────────────────────────────────────────

export interface IntentCandidate {
  intent: string;
  confidence: number;
}

export interface DisambiguationContext {
  topIntents: IntentCandidate[];
  language: SupportedLanguage;
  profileId?: string;
}

export interface DisambiguationPrompt {
  question: string;
  options: Array<{ intent: string; label: string }>;
  context_id: string; // Used to track clarification response back to this prompt
}

// ─── Ambiguity Detection ────────────────────────────────────────────

/**
 * Detect if top N intents are within 5% confidence margin.
 * Returns true if ambiguous: e.g., [booking: 0.65, inquiry: 0.62] → ambiguous
 */
export function detectAmbiguity(
  topIntents: IntentCandidate[],
  confidenceThreshold: number = 0.05
): boolean {
  if (topIntents.length < 2) {
    return false; // Not ambiguous — single intent
  }

  const highestConfidence = topIntents[0].confidence;
  const secondHighestConfidence = topIntents[1].confidence;

  // Use epsilon for floating-point comparison (handles precision issues)
  const epsilon = 1e-10;
  return (highestConfidence - secondHighestConfidence) <= (confidenceThreshold + epsilon);
}

// ─── Disambiguation Prompt Generation ────────────────────────────────

/**
 * Load disambiguation prompts from JSON file (cached)
 */
function loadDisambiguationPrompts(): Record<string, any> {
  // Use pre-loaded JSON data (imported with assert { type: 'json' })
  return disambiguationPromptsData || { intent_pairs: {} };
}

/**
 * Generate a clarifying question for ambiguous intents.
 * Uses templated messages from disambiguation-prompts.json with
 * profile and language-specific variations.
 *
 * @param topIntents Array of top intent candidates with confidence scores
 * @param language Detected/preferred language ('en', 'ms', 'zh', 'ta')
 * @param profileId Profile ID for profile-specific prompt variations (optional)
 * @returns DisambiguationPrompt with question and options
 */
export function generateDisambiguationPrompt(
  topIntents: IntentCandidate[],
  language: SupportedLanguage = 'en',
  profileId?: string
): DisambiguationPrompt {
  if (topIntents.length < 2) {
    throw new Error('Need at least 2 intent candidates for disambiguation');
  }

  const prompts = loadDisambiguationPrompts();
  const intent1 = topIntents[0].intent;
  const intent2 = topIntents[1].intent;

  // Build intent pair key (lexicographically sorted for consistency)
  const pairKey = [intent1, intent2].sort().join('_');
  const pairPrompts = prompts.intent_pairs?.[pairKey];

  if (!pairPrompts) {
    // Fallback generic template
    return {
      question: `Are you asking about ${intent1} or ${intent2}?`,
      options: [
        { intent: intent1, label: intent1 },
        { intent: intent2, label: intent2 }
      ],
      context_id: `disambig_${Date.now()}_${Math.random().toString(36).slice(2)}`
    };
  }

  // Get language-specific prompt (fallback to 'en' if not available)
  const langPrompts = pairPrompts[language] || pairPrompts.en || pairPrompts;
  const question = typeof langPrompts === 'object' ? langPrompts.question : langPrompts;
  const labels = typeof langPrompts === 'object' ? langPrompts.labels || {} : {};

  // Generate context ID for tracking clarification response
  const contextId = `disambig_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return {
    question,
    options: topIntents.slice(0, 2).map(ic => ({
      intent: ic.intent,
      label: labels[ic.intent] || ic.intent
    })),
    context_id: contextId
  };
}

// ─── Clarification Response Handling ─────────────────────────────────

/**
 * Process a clarification response and re-classify with added context.
 *
 * @param clarificationResponse User's response to the disambiguation prompt
 * @param originalMessage Original user message that was ambiguous
 * @param disambiguationContext Original context (topIntents, language, profileId)
 * @param systemPrompt System prompt for re-classification
 * @param history Conversation history for context
 * @param store Config store for the profile
 * @returns Re-classified AIResponse with refined intent and confidence
 */
export async function handleClarificationResponse(
  clarificationResponse: string,
  originalMessage: string,
  disambiguationContext: DisambiguationContext,
  systemPrompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  store?: ConfigStore
): Promise<AIResponse> {
  // Add clarification context to the original message for re-classification
  const enhancedMessage = `${originalMessage}\n[User clarified: ${clarificationResponse}]`;

  // Re-classify with the clarification added
  const result = await classifyAndRespond(
    systemPrompt,
    history,
    enhancedMessage,
    disambiguationContext.language,
    store
  );

  return result;
}

/**
 * Check if a clarification response selected one of the offered intents.
 * Returns the selected intent if detected, null otherwise.
 *
 * @param clarificationResponse User's response
 * @param options Array of offered intent options
 * @returns Selected intent or null
 */
export function parseIntentSelection(
  clarificationResponse: string,
  options: Array<{ intent: string; label: string }>
): string | null {
  const response = clarificationResponse.toLowerCase().trim();

  // Try to match by label or intent name
  for (const option of options) {
    if (
      response.includes(option.label.toLowerCase()) ||
      response.includes(option.intent.toLowerCase())
    ) {
      return option.intent;
    }
  }

  // Try numeric selection (e.g., "1", "2", "first", "second")
  const numericMatch = response.match(/^[12]$|^(first|second)$/i);
  if (numericMatch) {
    const index = response === '1' || response.toLowerCase() === 'first' ? 0 : 1;
    if (index < options.length) {
      return options[index].intent;
    }
  }

  return null;
}

/**
 * Check if a response is still ambiguous (e.g., user says "both" or doesn't clarify).
 * Used to determine if we should escalate to human.
 */
export function isStillAmbiguous(response: string): boolean {
  const lowerResponse = response.toLowerCase();
  const ambiguousPatterns = [
    /\bboth\b/i,
    /\beither\b/i,
    /\bdon't (know|care)/i,
    /\bno (preference|difference)/i,
    /\bdunno\b/i,
    /\buh\b/i
  ];

  return ambiguousPatterns.some(pattern => pattern.test(lowerResponse));
}
