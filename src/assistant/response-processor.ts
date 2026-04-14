/**
 * Response Processor (US-524)
 *
 * Generates context-aware fallback suggestions based on conversation history.
 * When intent classification confidence is low (<0.6), analyzes recent conversation
 * intents and suggests 2-3 most relevant intents from knowledge base ranked by
 * keyword overlap with conversation history.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConversationIntentHistory } from '../lib/db.js';
import type { FallbackSuggestionsResponse, FallbackSuggestion } from './schemas.js';
import type { KnowledgeData, IntentKeywordsData } from './schemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Interface for Tamil template structure
 */
interface TamilTemplate {
  text: string;
  variables: string[];
}

interface TamilIntentTemplates {
  [templateKey: string]: TamilTemplate;
}

interface TamilResponseData {
  schema_version: string;
  language: string;
  description: string;
  intents: {
    [intent: string]: TamilIntentTemplates;
  };
}

/**
 * Load language-specific response templates (e.g., tamil-responses.json)
 * Supports profile-specific template files
 */
function loadTemplateByLanguage(
  language: string,
  profileId: string = 'pelangi'
): TamilResponseData | null {
  try {
    // Try profile-specific templates first
    const profileTemplatePath = path.join(
      __dirname,
      `data-${profileId}/${language}-responses.json`
    );
    if (fs.existsSync(profileTemplatePath)) {
      const data = fs.readFileSync(profileTemplatePath, 'utf-8');
      return JSON.parse(data) as TamilResponseData;
    }

    // Fall back to shared templates
    const sharedTemplatePath = path.join(__dirname, `data/${language}-responses.json`);
    if (fs.existsSync(sharedTemplatePath)) {
      const data = fs.readFileSync(sharedTemplatePath, 'utf-8');
      return JSON.parse(data) as TamilResponseData;
    }

    console.warn(
      `[ResponseProcessor] No ${language}-responses.json found for profile ${profileId}`
    );
    return null;
  } catch (error) {
    console.error(
      `[ResponseProcessor] Failed to load ${language} templates:`,
      error
    );
    return null;
  }
}

/**
 * Render a template by substituting variables with actual values
 */
function renderTemplate(
  template: TamilTemplate,
  variables: Record<string, string | number | undefined>
): string {
  let text = template.text;

  for (const variable of template.variables) {
    const placeholder = `{${variable}}`;
    const value = variables[variable];
    if (value !== undefined) {
      text = text.replace(new RegExp(placeholder, 'g'), String(value));
    }
  }

  return text;
}

/**
 * Load knowledge.json from the assistant data directory
 */
function loadKnowledgeBase(profileId: string = 'pelangi'): KnowledgeData | null {
  try {
    let dataPath = path.join(__dirname, 'data/knowledge.json');

    // Check for profile-specific knowledge files
    const profileKbPath = path.join(__dirname, `data-${profileId}/knowledge.json`);
    if (fs.existsSync(profileKbPath)) {
      dataPath = profileKbPath;
    }

    const data = fs.readFileSync(dataPath, 'utf-8');
    return JSON.parse(data) as KnowledgeData;
  } catch (error) {
    console.error('[ResponseProcessor] Failed to load knowledge base:', error);
    return null;
  }
}

/**
 * Load intent-keywords.json from the assistant data directory
 */
function loadIntentKeywords(profileId: string = 'pelangi'): IntentKeywordsData | null {
  try {
    let keywordsPath = path.join(__dirname, 'data/intent-keywords.json');

    // Check for profile-specific keywords file
    const profileKeywordsPath = path.join(__dirname, `data-${profileId}/intent-keywords.json`);
    if (fs.existsSync(profileKeywordsPath)) {
      keywordsPath = profileKeywordsPath;
    }

    const data = fs.readFileSync(keywordsPath, 'utf-8');
    return JSON.parse(data) as IntentKeywordsData;
  } catch (error) {
    console.error('[ResponseProcessor] Failed to load intent keywords:', error);
    return null;
  }
}

/**
 * Extract words from text, normalize to lowercase
 */
function extractWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2) // Filter out very short words
  );
}

/**
 * Calculate relevance score between conversation history and an intent
 * by counting keyword overlap
 *
 * @param conversationText - Summary of recent conversation
 * @param intent - Intent name to score
 * @param keywordsData - Intent keywords data
 * @returns Relevance score between 0 and 1
 */
function calculateRelevanceScore(
  conversationText: string,
  intent: string,
  keywordsData: IntentKeywordsData | null
): number {
  if (!keywordsData) return 0;

  // Find keywords for this intent
  const intentEntry = keywordsData.intents.find(i => i.intent === intent);
  if (!intentEntry) return 0;

  // Get all keywords for this intent across all languages
  const intentKeywords = new Set<string>();
  Object.values(intentEntry.keywords).forEach(langKeywords => {
    if (Array.isArray(langKeywords)) {
      langKeywords.forEach(keyword => {
        intentKeywords.add(keyword.toLowerCase());
      });
    }
  });

  if (intentKeywords.size === 0) return 0;

  // Extract words from conversation
  const conversationWords = extractWords(conversationText);

  // Count matches
  let matches = 0;
  intentKeywords.forEach(keyword => {
    const keywordWords = extractWords(keyword);
    keywordWords.forEach(word => {
      if (conversationWords.has(word)) {
        matches++;
      }
    });
  });

  // Normalize: matches / total keywords
  return Math.min(1, matches / intentKeywords.size);
}

/**
 * Generate context-aware fallback suggestions based on conversation history
 *
 * @param phone - Phone number (session ID)
 * @param userMessage - Current user message
 * @param profileId - Profile ID (pelangi, makan, southern, etc.)
 * @returns Formatted response with suggestions or generic fallback
 */
export async function generateFallbackSuggestions(
  phone: string,
  userMessage: string,
  profileId: string = 'pelangi'
): Promise<FallbackSuggestionsResponse> {
  try {
    // Get last 3 intents from conversation history
    const intentHistory = await getConversationIntentHistory(phone, 3);

    // Build conversation summary from recent intents and current message
    const conversationParts = [
      ...intentHistory.map(msg => msg.intent || msg.content).filter(Boolean),
      userMessage
    ];
    const conversationSummary = conversationParts.join(' ');

    // Load knowledge base and keywords
    const knowledge = loadKnowledgeBase(profileId);
    const keywords = loadIntentKeywords(profileId);

    if (!knowledge) {
      return {
        message: 'I\'m temporarily having trouble understanding. Please try again in a moment.',
        suggestions: []
      };
    }

    // Score all intents in knowledge base
    const intentScores: Array<{ intent: string; score: number }> = [];

    knowledge.static.forEach(entry => {
      const score = calculateRelevanceScore(conversationSummary, entry.intent, keywords);
      if (score > 0) {
        intentScores.push({ intent: entry.intent, score });
      }
    });

    // Sort by score descending and take top 3
    intentScores.sort((a, b) => b.score - a.score);
    const topSuggestions = intentScores.slice(0, 3);

    // Filter by minimum relevance threshold (0.5)
    const filteredSuggestions = topSuggestions.filter(s => s.score >= 0.5);

    if (filteredSuggestions.length === 0) {
      // Generic fallback if no suggestions meet threshold
      return {
        message: 'Could you rephrase that?',
        suggestions: []
      };
    }

    // Build suggestion objects with keywords
    const suggestions: FallbackSuggestion[] = filteredSuggestions.map(({ intent, score }) => {
      // Get keywords for this intent
      const intentEntry = keywords?.intents.find(i => i.intent === intent);
      const intentKeywords = intentEntry
        ? Object.values(intentEntry.keywords).flat().slice(0, 3)
        : [];

      return {
        intent,
        relevanceScore: score,
        keywords: intentKeywords
      };
    });

    // Format response message
    const suggestionTexts = suggestions
      .map((s, i) => `${s.intent} (${Math.round(s.relevanceScore * 100)}% match)`)
      .join(', ');

    const message = `I'm not sure. Did you mean: ${suggestionTexts}?`;

    return {
      message,
      suggestions
    };
  } catch (error) {
    console.error('[ResponseProcessor] generateFallbackSuggestions failed:', error);
    return {
      message: 'Could you rephrase that?',
      suggestions: []
    };
  }
}

/**
 * Load error messages from profile-specific JSON files with fallback to English
 *
 * @param profileId - Profile ID (pelangi, makan, southern, etc.)
 * @returns Record of error key -> message, or null if loading fails
 */
interface ErrorMessagesData {
  schema_version: string;
  description: string;
  errors: Record<string, string>;
}

function loadErrorMessages(profileId: string = 'pelangi'): ErrorMessagesData | null {
  try {
    // Try profile-specific file first
    const profileErrorPath = path.join(
      __dirname,
      `data/error-messages-${profileId}.json`
    );

    if (fs.existsSync(profileErrorPath)) {
      const data = fs.readFileSync(profileErrorPath, 'utf-8');
      return JSON.parse(data) as ErrorMessagesData;
    }

    // Fallback to English error messages
    const enErrorPath = path.join(__dirname, 'data/error-messages-en.json');
    if (fs.existsSync(enErrorPath)) {
      const data = fs.readFileSync(enErrorPath, 'utf-8');
      return JSON.parse(data) as ErrorMessagesData;
    }

    console.warn(
      `[ResponseProcessor] No error messages found for profile ${profileId}, falling back to defaults`
    );
    return null;
  } catch (error) {
    console.error(
      `[ResponseProcessor] Failed to load error messages for profile ${profileId}:`,
      error
    );
    // Fallback to English
    try {
      const enErrorPath = path.join(__dirname, 'data/error-messages-en.json');
      const data = fs.readFileSync(enErrorPath, 'utf-8');
      return JSON.parse(data) as ErrorMessagesData;
    } catch (enError) {
      console.error('[ResponseProcessor] Failed to load English error messages:', enError);
      return null;
    }
  }
}

/**
 * Normalize profile ID to canonical form (pelangi, makan, southern)
 * Handles aliases and partial matches
 */
function normalizeProfileId(profileId: string): string {
  const lower = profileId.toLowerCase();

  // Exact matches
  if (lower === 'pelangi') return 'pelangi';
  if (lower === 'makan') return 'makan';
  if (lower === 'southern') return 'southern';

  // Aliases
  if (lower === 'pelangi-capsule') return 'pelangi';
  if (lower === 'southern-homestay') return 'southern';
  if (lower === 'makan-moments') return 'makan';

  // Partial substring matches
  if (lower.includes('pelangi')) return 'pelangi';
  if (lower.includes('makan')) return 'makan';
  if (lower.includes('southern')) return 'southern';

  return 'pelangi'; // Default fallback
}

/**
 * Get a specific error message for a profile and error type
 *
 * @param errorType - Error type key (e.g., 'booking_error', 'payment_failed')
 * @param profileId - Profile ID (pelangi, makan, southern, etc.)
 * @returns Error message string, or a generic message if not found
 */
export function getErrorMessage(errorType: string, profileId: string = 'pelangi'): string {
  const normalizedProfile = normalizeProfileId(profileId);
  const errorMessages = loadErrorMessages(normalizedProfile);

  if (!errorMessages) {
    return 'We encountered an issue. Please contact our staff for assistance.';
  }

  const message = errorMessages.errors[errorType];
  if (message) {
    return message;
  }

  // Fallback to system_error if specific type not found
  const systemError = errorMessages.errors.system_error;
  if (systemError) {
    return systemError;
  }

  return 'We encountered an issue. Please contact our staff for assistance.';
}

/**
 * Interface for clarifying questions
 */
interface ClarifyingQuestionsData {
  schema_version: string;
  description: string;
  clarifying_questions: Record<string, Record<string, string[]>>;
}

/**
 * Load clarifying-questions.json for low-confidence intents
 * Returns intent-specific questions with multilingual support
 */
function loadClarifyingQuestions(profileId: string = 'pelangi'): ClarifyingQuestionsData | null {
  try {
    // Try profile-specific questions first
    const profileQuestionsPath = path.join(
      __dirname,
      `data-${profileId}/clarifying-questions.json`
    );
    if (fs.existsSync(profileQuestionsPath)) {
      const data = fs.readFileSync(profileQuestionsPath, 'utf-8');
      return JSON.parse(data) as ClarifyingQuestionsData;
    }

    // Fall back to shared questions
    const sharedQuestionsPath = path.join(__dirname, 'data/clarifying-questions.json');
    if (fs.existsSync(sharedQuestionsPath)) {
      const data = fs.readFileSync(sharedQuestionsPath, 'utf-8');
      return JSON.parse(data) as ClarifyingQuestionsData;
    }

    console.warn(
      `[ResponseProcessor] No clarifying-questions.json found for profile ${profileId}`
    );
    return null;
  } catch (error) {
    console.error('[ResponseProcessor] Failed to load clarifying questions:', error);
    return null;
  }
}

/**
 * Generate context-aware clarifying questions for low-confidence intents
 *
 * @param intent - The classified intent with low confidence
 * @param language - Language code (en, ms, zh, ta)
 * @param recentMessages - Last 3 messages from conversation for context
 * @param profileId - Profile ID (pelangi, makan, southern, etc.)
 * @returns Array of 2-3 clarifying questions or empty array if not found
 */
export interface ClarifyingResponse {
  message: string;
  suggestions: Array<{
    text: string;
    payload: string;
  }>;
}

export function generateClarifyingQuestions(
  intent: string,
  language: string = 'en',
  recentMessages: Array<{ content: string }> = [],
  profileId: string = 'pelangi'
): ClarifyingResponse {
  const questions = loadClarifyingQuestions(profileId);

  if (!questions) {
    return {
      message: 'Could you provide more details about what you need?',
      suggestions: []
    };
  }

  // Get questions for this intent, or use default
  const intentQuestions = questions.clarifying_questions[intent] || questions.clarifying_questions['default'];

  if (!intentQuestions) {
    return {
      message: 'Could you provide more details about what you need?',
      suggestions: []
    };
  }

  // Get questions in the requested language, fallback to English
  const questionsForLang = intentQuestions[language] || intentQuestions['en'] || [];

  if (questionsForLang.length === 0) {
    return {
      message: 'Could you provide more details about what you need?',
      suggestions: []
    };
  }

  // Take 2-3 questions (pick first 2 for conciseness)
  const selectedQuestions = questionsForLang.slice(0, 2);

  // Build response message - combine questions into one message
  const combinedMessage = selectedQuestions.join('\n\n');

  // Create button suggestions from the questions
  const suggestions = selectedQuestions.map((question, index) => ({
    text: question,
    payload: `${index + 1}`
  }));

  return {
    message: combinedMessage,
    suggestions
  };
}

// Export template functions for use in tests and other modules
export { loadTemplateByLanguage, renderTemplate, loadErrorMessages, loadClarifyingQuestions };
