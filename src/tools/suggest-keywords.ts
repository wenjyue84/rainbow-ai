/**
 * US-213: Intent Keyword Suggestion Engine from Escalated Conversation Analysis
 *
 * Analyzes escalation_queue table to extract keyword suggestions using TF-IDF
 * scoring. Groups low-confidence messages by intent, identifies discriminative
 * terms, and recommends 2-3 high-impact keywords per intent.
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeywordSuggestion {
  intent_id: string;
  current_keyword_count: number;
  suggested_keywords: string[];
  estimated_accuracy_boost_percent: number;
}

export interface SuggestKeywordsOutput {
  timestamp: string;
  profile: string;
  days_analyzed: number;
  total_escalations: number;
  suggestions: KeywordSuggestion[];
}

export interface EscalationRow {
  original_intent: string;
  message_preview: string | null;
  confidence_score: number;
  profile: string;
  timestamp: Date | string;
}

// ---------------------------------------------------------------------------
// Stop words — common English words that should never be suggested as keywords
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  // articles / determiners
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  // pronouns
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them',
  // prepositions
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between',
  // conjunctions
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
  // auxiliaries / verbs
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'shall', 'should', 'may', 'might',
  'must', 'can', 'could',
  // common adverbs
  'very', 'really', 'just', 'also', 'too', 'here', 'there', 'now', 'then',
  // misc
  'yes', 'no', 'ok', 'okay', 'please', 'thank', 'thanks', 'hi', 'hello', 'hey',
  'what', 'when', 'where', 'who', 'how', 'why', 'which',
  'all', 'any', 'some', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'if', 'than', 'because', 'as', 'until', 'while', 'since',
  'get', 'got', 'go', 'going', 'come', 'want', 'need', 'like', 'know',
  'think', 'see', 'make', 'take', 'let', 'say', 'said', 'tell',
]);

// ---------------------------------------------------------------------------
// Profile configuration
// ---------------------------------------------------------------------------

const PROFILE_KEYWORD_DIRS: Record<string, string> = {
  pelangi: 'src/assistant/data',
  makan: 'src/assistant/data-makan',
  southern: 'src/assistant/data-southern',
};

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize a message into lowercase words, filtering out short words,
 * numbers, and stop words.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

// ---------------------------------------------------------------------------
// TF-IDF calculation
// ---------------------------------------------------------------------------

/**
 * Compute TF-IDF scores for terms across a set of documents (messages)
 * grouped by intent. Returns top terms per intent, excluding terms that
 * already exist as keywords.
 */
export function computeTfIdf(
  intentMessages: Map<string, string[]>,
  existingKeywords: Map<string, Set<string>>,
  maxSuggestions: number = 3,
): KeywordSuggestion[] {
  const totalIntents = intentMessages.size;
  if (totalIntents === 0) return [];

  // Build document frequency (DF): how many intents contain each term
  const df = new Map<string, number>();
  const intentTermFreqs = new Map<string, Map<string, number>>();

  for (const [intent, messages] of intentMessages) {
    const termFreq = new Map<string, number>();
    const intentTermsSet = new Set<string>();

    for (const msg of messages) {
      const tokens = tokenize(msg);
      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) || 0) + 1);
        intentTermsSet.add(token);
      }
    }

    intentTermFreqs.set(intent, termFreq);

    // Update DF
    for (const term of intentTermsSet) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  // Compute TF-IDF per intent and select top terms
  const suggestions: KeywordSuggestion[] = [];

  for (const [intent, termFreq] of intentTermFreqs) {
    const existingKw = existingKeywords.get(intent) || new Set<string>();
    const totalTerms = Array.from(termFreq.values()).reduce((a, b) => a + b, 0);

    // Score each term: TF * IDF
    const scored: Array<{ term: string; score: number }> = [];
    for (const [term, freq] of termFreq) {
      // Skip terms already in keywords
      if (existingKw.has(term)) continue;

      const tf = freq / totalTerms;
      const idf = Math.log(totalIntents / (df.get(term) || 1));
      scored.push({ term, score: tf * idf });
    }

    // Sort by score descending, take top N
    scored.sort((a, b) => b.score - a.score);
    const topTerms = scored.slice(0, maxSuggestions).map(s => s.term);

    if (topTerms.length === 0) continue;

    // Estimate accuracy boost: heuristic based on message count and keyword gap
    const messageCount = intentMessages.get(intent)?.length || 0;
    const currentCount = existingKw.size;
    const boost = Math.min(
      15,
      Math.round((topTerms.length / Math.max(currentCount, 1)) * messageCount * 0.5),
    );

    suggestions.push({
      intent_id: intent,
      current_keyword_count: currentCount,
      suggested_keywords: topTerms,
      estimated_accuracy_boost_percent: Math.max(1, boost),
    });
  }

  // Sort by estimated boost descending
  suggestions.sort((a, b) => b.estimated_accuracy_boost_percent - a.estimated_accuracy_boost_percent);

  return suggestions;
}

// ---------------------------------------------------------------------------
// Load existing keywords for a profile
// ---------------------------------------------------------------------------

export function loadExistingKeywords(rootDir: string, profile: string): Map<string, Set<string>> {
  const dir = PROFILE_KEYWORD_DIRS[profile] || PROFILE_KEYWORD_DIRS['pelangi'];
  const filePath = path.join(rootDir, dir, 'intent-keywords.json');
  const result = new Map<string, Set<string>>();

  if (!fs.existsSync(filePath)) return result;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    for (const entry of data.intents || []) {
      const allKw = new Set<string>();
      for (const keywords of Object.values(entry.keywords || {})) {
        for (const kw of keywords as string[]) {
          allKw.add(kw.toLowerCase());
        }
      }
      result.set(entry.intent, allKw);
    }
  } catch {
    // Return empty map if file can't be parsed
  }

  return result;
}

// ---------------------------------------------------------------------------
// Analyze escalation data and generate suggestions
// ---------------------------------------------------------------------------

export function analyzeEscalations(
  rows: EscalationRow[],
  existingKeywords: Map<string, Set<string>>,
  maxSuggestions: number = 3,
): KeywordSuggestion[] {
  // Group messages by intent
  const intentMessages = new Map<string, string[]>();

  for (const row of rows) {
    if (!row.message_preview) continue;
    const intent = row.original_intent;
    if (!intentMessages.has(intent)) {
      intentMessages.set(intent, []);
    }
    intentMessages.get(intent)!.push(row.message_preview);
  }

  return computeTfIdf(intentMessages, existingKeywords, maxSuggestions);
}
