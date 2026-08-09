/**
 * US-323: Intent Keyword Auto-Miner from Production Misclassifications
 *
 * Analyzes failed/low-confidence booking intents from production logs,
 * extracts unmatched keywords, and suggests adding them to intent-keywords.json
 * with admin approval workflow.
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';

// ─── Types ──────────────────────────────────────────────────────────────

export interface KeywordSuggestion {
  keyword: string;
  intent: string;
  frequency: number;
  suggestedProfile: string;
}

export interface MineKeywordSuggestionsOutput {
  timestamp: string;
  profile: string;
  window_days: number;
  total_predictions: number;
  low_confidence_count: number;
  failed_count: number;
  suggestions: KeywordSuggestion[];
  duplicates_filtered: number;
}

// ─── Stop words ─────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'shall', 'should', 'may', 'might',
  'must', 'can', 'could',
  'very', 'really', 'just', 'also', 'too', 'here', 'there', 'now', 'then',
  'yes', 'no', 'ok', 'okay', 'please', 'thank', 'thanks', 'hi', 'hello', 'hey',
  'what', 'when', 'where', 'who', 'how', 'why', 'which',
  'all', 'any', 'some', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'if', 'than', 'because', 'as', 'until', 'while', 'since',
]);

// ─── Profile configuration ──────────────────────────────────────────────

const PROFILE_KEYWORD_DIRS: Record<string, string> = {
  pelangi: 'src/assistant/data',
  makan: 'src/assistant/data-makan',
  southern: 'src/assistant/data-southern',
};

// ─── Database querying ──────────────────────────────────────────────────

export async function fetchLowConfidencePredictions(
  profile: string,
  windowDays: number,
  dbUrl: string,
  confidenceThreshold: number = 0.75,
): Promise<{ predictions: Array<{ messageText: string; predictedIntent: string }>, total: number, failedCount: number }> {
  if (!dbUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
    max: 2,
    idleTimeoutMillis: 5000,
  });

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);

    // Get low-confidence predictions
    const lowConfResult = await pool.query<{
      message_text: string;
      predicted_intent: string;
    }>(
      `SELECT message_text, predicted_intent
       FROM intent_predictions
       WHERE profile = $1
       AND created_at >= $2
       AND confidence < $3
       AND message_text IS NOT NULL
       AND length(message_text) > 0
       ORDER BY confidence ASC
       LIMIT 10000`,
      [profile, cutoff.toISOString(), confidenceThreshold],
    );

    // Get failed predictions (where wasCorrect = false)
    const failedResult = await pool.query<{
      message_text: string;
      predicted_intent: string;
    }>(
      `SELECT message_text, predicted_intent
       FROM intent_predictions
       WHERE profile = $1
       AND created_at >= $2
       AND was_correct = false
       AND message_text IS NOT NULL
       AND length(message_text) > 0
       ORDER BY created_at DESC
       LIMIT 5000`,
      [profile, cutoff.toISOString()],
    );

    // Combine results
    const predictions = [
      ...lowConfResult.rows.map(row => ({
        messageText: row.message_text,
        predictedIntent: row.predicted_intent,
      })),
      ...failedResult.rows.map(row => ({
        messageText: row.message_text,
        predictedIntent: row.predicted_intent,
      })),
    ];

    // Deduplicate by message text
    const seen = new Set<string>();
    const deduped = predictions.filter(p => {
      if (seen.has(p.messageText)) return false;
      seen.add(p.messageText);
      return true;
    });

    return {
      predictions: deduped,
      total: lowConfResult.rows.length,
      failedCount: failedResult.rows.length,
    };
  } finally {
    await pool.end();
  }
}

// ─── Tokenization ──────────────────────────────────────────────────────

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

// ─── Extract n-grams from message ──────────────────────────────────────

export function extractNGrams(text: string, maxNGramSize: number = 3): string[] {
  const tokens = tokenize(text);
  const ngrams: string[] = [];

  // Add individual tokens (unigrams)
  for (const token of tokens) {
    ngrams.push(token);
  }

  // Add bigrams and trigrams
  for (let size = 2; size <= Math.min(maxNGramSize, tokens.length); size++) {
    for (let i = 0; i <= tokens.length - size; i++) {
      const ngram = tokens.slice(i, i + size).join(' ');
      ngrams.push(ngram);
    }
  }

  return ngrams;
}

// ─── Load existing keywords from file ───────────────────────────────────

export function loadExistingKeywords(profileKeywordDir: string): Map<string, Set<string>> {
  const keywordFile = path.join(profileKeywordDir, 'intent-keywords.json');

  if (!fs.existsSync(keywordFile)) {
    return new Map();
  }

  const content = fs.readFileSync(keywordFile, 'utf-8');
  const data = JSON.parse(content) as {
    intents: Array<{ intent: string; keywords: Record<string, string[]> }>;
  };

  const keywordsByIntent = new Map<string, Set<string>>();

  for (const item of data.intents) {
    const allKeywords = new Set<string>();
    for (const langKeywords of Object.values(item.keywords)) {
      for (const kw of langKeywords) {
        allKeywords.add(kw.toLowerCase());
      }
    }
    keywordsByIntent.set(item.intent, allKeywords);
  }

  return keywordsByIntent;
}

// ─── Mine keyword suggestions ──────────────────────────────────────────

export async function mineKeywordSuggestions(
  profile: string,
  windowDays: number,
  dbUrl: string,
  rootDir: string = '.',
): Promise<MineKeywordSuggestionsOutput> {
  const profileKeywordDir = path.join(rootDir, PROFILE_KEYWORD_DIRS[profile] || 'src/assistant/data');
  const existingKeywords = loadExistingKeywords(profileKeywordDir);

  // Fetch predictions from DB
  const { predictions, total, failedCount } = await fetchLowConfidencePredictions(
    profile,
    windowDays,
    dbUrl,
  );

  // Extract keywords from messages, grouped by intent
  const keywordFreq = new Map<string, Map<string, number>>(); // intent -> keyword -> count

  for (const pred of predictions) {
    const ngrams = extractNGrams(pred.messageText);
    const intent = pred.predictedIntent || 'unknown';

    if (!keywordFreq.has(intent)) {
      keywordFreq.set(intent, new Map());
    }

    const intentKeywords = keywordFreq.get(intent)!;
    for (const ngram of ngrams) {
      // Skip if already in keywords
      const existingForIntent = existingKeywords.get(intent) || new Set();
      if (existingForIntent.has(ngram)) {
        continue;
      }

      intentKeywords.set(ngram, (intentKeywords.get(ngram) || 0) + 1);
    }
  }

  // Select top keywords per intent (by frequency, then alphabetical)
  const suggestions: KeywordSuggestion[] = [];
  const suggestionSet = new Set<string>(); // For deduplication

  for (const [intent, keywords] of keywordFreq) {
    // Sort by frequency (descending) then alphabetically
    const sorted = Array.from(keywords.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 20); // Top 20 per intent

    for (const [keyword, frequency] of sorted) {
      // Minimum frequency threshold
      if (frequency < 2) continue;

      const key = `${intent}:${keyword}`;
      if (suggestionSet.has(key)) continue;

      suggestionSet.add(key);
      suggestions.push({
        keyword,
        intent,
        frequency,
        suggestedProfile: profile,
      });
    }
  }

  // Filter duplicates within 14-day window (for simplicity, we'll just dedup by keyword:intent)
  const filtered = Array.from(new Map(suggestions.map(s => [`${s.intent}:${s.keyword}`, s])).values());

  // Sort by frequency descending
  filtered.sort((a, b) => b.frequency - a.frequency);

  return {
    timestamp: new Date().toISOString(),
    profile,
    window_days: windowDays,
    total_predictions: total,
    low_confidence_count: predictions.length,
    failed_count: failedCount,
    suggestions: filtered.slice(0, 100), // Limit to top 100
    duplicates_filtered: suggestions.length - filtered.length,
  };
}
