/**
 * Intent Classifier with Explainability (US-628)
 *
 * Provides explainIntentClassification() — a single-call function that classifies
 * a message and returns metadata: matched keywords, confidence, and classification method.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import defaultKeywordsData from './data/intent-keywords.json' with { type: 'json' };

export interface MatchedKeyword {
  keyword: string;
  score: number;
}

export type ClassificationMethod = 'keyword_match' | 'ai_classification' | 'fallback';

export interface IntentClassificationResult {
  intent: string;
  confidence: number;
  matchedKeywords: MatchedKeyword[];
  classificationMethod: ClassificationMethod;
  processingTime: number;
}

// ─── Keyword Loading ─────────────────────────────────────────────────────────

function loadKeywordsForProfile(profile: string): typeof defaultKeywordsData {
  const dataDir = join(process.cwd(), 'src', 'assistant', 'data');
  const profilePath = join(dataDir, `intent-keywords-${profile}.json`);
  if (existsSync(profilePath)) {
    try {
      return JSON.parse(readFileSync(profilePath, 'utf-8'));
    } catch {
      // fall through to default
    }
  }
  return defaultKeywordsData;
}

// ─── Keyword Scoring ─────────────────────────────────────────────────────────

function scoreKeyword(messageNorm: string, keywordNorm: string): number {
  if (!keywordNorm) return 0;

  // Exact match
  if (messageNorm === keywordNorm) return 1.0;

  // Substring match (keyword inside message)
  if (messageNorm.includes(keywordNorm)) return 0.85;

  // Any word from keyword found in message
  const keywordWords = keywordNorm.split(/\s+/);
  if (keywordWords.some(w => w.length >= 3 && messageNorm.includes(w))) return 0.65;

  // Prefix-overlap fuzzy match
  const messageWords = messageNorm.split(/\s+/);
  for (const mw of messageWords) {
    for (const kw of keywordWords) {
      const prefixLen = Math.min(3, kw.length, mw.length);
      if (prefixLen >= 3 && mw.startsWith(kw.substring(0, prefixLen))) {
        return 0.5;
      }
    }
  }

  return 0;
}

function extractKeywordMatches(
  message: string,
  intentName: string,
  keywordsData: typeof defaultKeywordsData
): MatchedKeyword[] {
  const messageNorm = message.toLowerCase().trim();
  const intentData = keywordsData.intents.find(i => i.intent === intentName);
  if (!intentData) return [];

  const allKeywords: string[] = [];
  Object.values(intentData.keywords).forEach((kws: any) => {
    if (Array.isArray(kws)) allKeywords.push(...kws);
  });

  const matches: MatchedKeyword[] = [];
  for (const kw of allKeywords) {
    const score = scoreKeyword(messageNorm, kw.toLowerCase().trim());
    if (score > 0) {
      matches.push({ keyword: kw, score: parseFloat(score.toFixed(2)) });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

// ─── Intent Classification ────────────────────────────────────────────────────

/**
 * Classify a message with full explainability metadata.
 *
 * Classification method priority:
 *   1. keyword_match — if any keyword matches with score >= 0.5
 *   2. fallback      — if no keywords matched
 *
 * Note: 'ai_classification' is reserved for messages that were routed to the LLM
 * tier. This synchronous function cannot call the LLM, so it uses keyword_match
 * or fallback only.
 */
export function explainIntentClassification(
  message: string,
  profile: string = 'pelangi'
): IntentClassificationResult {
  const startTime = Date.now();
  const keywordsData = loadKeywordsForProfile(profile);
  const messageNorm = message.toLowerCase().trim();

  let bestIntent = 'fallback';
  let bestScore = 0;
  let bestMatches: MatchedKeyword[] = [];

  for (const intentDef of keywordsData.intents) {
    const matches = extractKeywordMatches(message, intentDef.intent, keywordsData);
    if (matches.length > 0 && matches[0].score > bestScore) {
      bestScore = matches[0].score;
      bestIntent = intentDef.intent;
      bestMatches = matches;
    }
  }

  const classificationMethod: ClassificationMethod =
    bestScore >= 0.5 ? 'keyword_match' : 'fallback';

  if (classificationMethod === 'fallback') {
    bestIntent = 'fallback';
    bestScore = 0;
    bestMatches = [];
  }

  const processingTime = Date.now() - startTime;

  return {
    intent: bestIntent,
    confidence: parseFloat(bestScore.toFixed(2)),
    matchedKeywords: bestMatches.slice(0, 10), // return top-10 at most
    classificationMethod,
    processingTime,
  };
}
