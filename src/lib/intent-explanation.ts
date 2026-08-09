/**
 * Intent Classification Explanation Generator
 *
 * Provides explainability for intent classification decisions by analyzing:
 * - Which keywords matched from the classified intent
 * - Confidence scores for each matched keyword
 * - Which patterns fired during classification
 */

import { FuzzyIntentMatcher, type KeywordIntent } from '../assistant/fuzzy-matcher.js';
import intentKeywordsData from '../assistant/data/intent-keywords.json' with { type: 'json' };

export interface IntentExplanation {
  top_keywords: string[];
  classifier_scores: Record<string, number>;
  matched_patterns: string[];
}

/**
 * Extract matched keywords for a given intent from user message
 * Returns top keywords with their match scores
 */
function extractMatchedKeywords(message: string, intent: string): { keyword: string; score: number }[] {
  const messageNorm = message.toLowerCase().trim();
  const intentData = intentKeywordsData.intents.find(i => i.intent === intent);

  if (!intentData) return [];

  // Flatten all keywords from all languages for this intent
  const allKeywords: string[] = [];
  Object.values(intentData.keywords).forEach((keywords: any) => {
    if (Array.isArray(keywords)) {
      allKeywords.push(...keywords);
    }
  });

  // Calculate match score for each keyword
  const matches: { keyword: string; score: number }[] = [];

  for (const keyword of allKeywords) {
    const keywordNorm = keyword.toLowerCase().trim();
    let score = 0;

    // Exact match (highest score)
    if (messageNorm === keywordNorm) {
      score = 1.0;
    }
    // Substring match (high score)
    else if (messageNorm.includes(keywordNorm)) {
      score = 0.85;
    }
    // Partial word match (medium-high score)
    else if (keywordNorm.split(/\s+/).some(word => messageNorm.includes(word))) {
      score = 0.65;
    }
    // Fuzzy match using simple character overlap (medium score)
    else {
      const messageWords = messageNorm.split(/\s+/);
      const keywordWords = keywordNorm.split(/\s+/);

      for (const mw of messageWords) {
        for (const kw of keywordWords) {
          if (mw.startsWith(kw.substring(0, 3)) || kw.startsWith(mw.substring(0, 3))) {
            score = Math.max(score, 0.50);
          }
        }
      }
    }

    if (score > 0) {
      matches.push({ keyword, score });
    }
  }

  // Sort by score (descending) and return top matches
  return matches.sort((a, b) => b.score - a.score);
}

/**
 * Generate explanation for an intent classification
 * Takes a message and the classified intent, returns keywords, scores, and patterns
 */
export function generateIntentExplanation(message: string, intent: string): IntentExplanation {
  const topKeywords: string[] = [];
  const classifierScores: Record<string, number> = {};
  const matchedPatterns: string[] = [];

  // Handle fallback intent with empty explanation
  if (intent === 'fallback' || !intent) {
    return {
      top_keywords: [],
      classifier_scores: {},
      matched_patterns: []
    };
  }

  // Extract matched keywords for this intent
  const matches = extractMatchedKeywords(message, intent);

  // Take top 3 keywords
  const top3Matches = matches.slice(0, 3);

  for (const match of top3Matches) {
    topKeywords.push(match.keyword);
    classifierScores[match.keyword] = parseFloat(match.score.toFixed(2));
  }

  // Detect patterns (simple pattern detection based on content)
  const messageNorm = message.toLowerCase();

  // Booking-related patterns
  if (/\b(check[- ]?in|check[- ]?out|booking|reserve|room|night|guest|arrive|depart)\b/i.test(message)) {
    matchedPatterns.push('booking_pattern');
  }

  // Date/time patterns
  if (/\b(\d{1,2}[\/\-]\d{1,2}|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|besok|hari ini)\b/i.test(message)) {
    matchedPatterns.push('date_pattern');
  }

  // Number patterns (for guest count, duration, etc.)
  if (/\b(\d+\s*(people|person|guest|pax|night|nights|day|days|orang|malam|hari|人|晚|天)|one|two|three|four|five|six|seven|eight|nine|ten|satu|dua|tiga|empat|lima)\b/i.test(message)) {
    matchedPatterns.push('number_pattern');
  }

  // Question patterns
  if (/^(what|where|when|how|why|which|who|can|do|does|is|are|any|nasihat apa|berapa|dimana|bagaimana|apakah|什么|哪里|什么时候|怎么|谁)\b/i.test(message)) {
    matchedPatterns.push('question_pattern');
  }

  return {
    top_keywords: topKeywords,
    classifier_scores: classifierScores,
    matched_patterns: matchedPatterns
  };
}

/**
 * Alternative function name for backward compatibility
 */
export function explainIntentClassification(message: string, intent: string): IntentExplanation {
  return generateIntentExplanation(message, intent);
}
