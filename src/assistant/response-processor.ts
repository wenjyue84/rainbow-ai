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
