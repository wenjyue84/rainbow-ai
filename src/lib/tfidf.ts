/**
 * tfidf.ts — Lightweight TF-IDF implementation for keyword extraction.
 *
 * Used by the keyword suggestion engine (US-213) to identify
 * discriminative terms from escalated guest messages.
 */

export interface TfidfResult {
  term: string;
  score: number;
}

// Common stop words to filter out generic/low-value terms
const STOP_WORDS = new Set([
  // English
  'the','is','are','was','were','a','an','to','of','and','in','it',
  'i','my','me','we','do','you','can','how','what','when','where',
  'why','who','this','that','these','those','please','thank','thanks',
  'ok','okay','yes','no','not','have','get','hi','hey','hello',
  'want','need','would','like','just','also','for','from','with',
  'be','as','at','by','so','if','but','on','up','about','any',
  'more','will','could','should','has','had','been','your','our',
  'they','he','she','its','their','there','here','which','all',
  'im','ive','ill','its','dont','cant','wont','isnt','arent',
  'now','then','very','really','much','many','some','other',
  // Malay
  'saya','nak','boleh','bila','mana','berapa','untuk','yang','ada',
  'di','ke','dan','atau','tidak','ya','tolong','terima','kasih',
  'dengan','adalah','ini','itu','pada','juga','dari','sudah','masih',
  'kami','kita','mereka','dia','beliau','awak','siapa','bila','macam',
]);

/**
 * Tokenise a message into lowercase unigrams with stop word removal.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Build bigrams from a token list.
 */
export function buildBigrams(tokens: string[]): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}

/**
 * Compute TF-IDF scores for each intent's message corpus.
 *
 * @param intentMessages  Map of intentId -> array of message texts
 * @returns               Map of intentId -> ranked TF-IDF results (desc)
 */
export function computeTfidf(
  intentMessages: Map<string, string[]>
): Map<string, TfidfResult[]> {
  // Build per-intent term lists (unigrams + bigrams)
  const intentTerms = new Map<string, string[]>();
  for (const [intentId, messages] of intentMessages) {
    const allTokens: string[] = [];
    for (const msg of messages) {
      const tokens = tokenize(msg);
      allTokens.push(...tokens, ...buildBigrams(tokens));
    }
    intentTerms.set(intentId, allTokens);
  }

  const N = intentTerms.size;
  if (N === 0) return new Map();

  // Document frequency: how many intents contain each term
  const docFreq = new Map<string, number>();
  for (const terms of intentTerms.values()) {
    const unique = new Set(terms);
    for (const t of unique) {
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    }
  }

  const results = new Map<string, TfidfResult[]>();

  for (const [intentId, terms] of intentTerms) {
    if (terms.length === 0) {
      results.set(intentId, []);
      continue;
    }

    // Term frequency within this intent's corpus
    const tf = new Map<string, number>();
    for (const t of terms) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }

    // TF-IDF score = tf * log(N / (1 + df))
    const scored: TfidfResult[] = [];
    for (const [term, freq] of tf) {
      const idf = Math.log(N / (1 + (docFreq.get(term) ?? 0)));
      scored.push({ term, score: freq * idf });
    }

    scored.sort((a, b) => b.score - a.score);
    results.set(intentId, scored);
  }

  return results;
}

/**
 * Estimate the accuracy boost percentage for a set of suggested keywords
 * against the messages that triggered the analysis.
 *
 * Returns the percentage of messages that contain at least one suggested keyword.
 */
export function estimateAccuracyBoost(
  messages: string[],
  suggestedKeywords: string[]
): number {
  if (messages.length === 0 || suggestedKeywords.length === 0) return 0;
  const lower = suggestedKeywords.map(k => k.toLowerCase());
  const hits = messages.filter(msg => {
    const msgLower = msg.toLowerCase();
    return lower.some(kw => msgLower.includes(kw));
  });
  return Math.round((hits.length / messages.length) * 100);
}
