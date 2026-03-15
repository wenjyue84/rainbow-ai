/**
 * BM25 — In-memory Best Matching 25 index for KB chunk retrieval.
 *
 * US-912: Lexical ranking component of hybrid retrieval.
 * Standard BM25 with k1=1.2, b=0.75 parameters.
 * Supports multilingual queries (English, Malay, Chinese, Tamil).
 */

import type { KBChunk } from './chunker.js';

/** BM25 scored result */
export interface BM25Result {
  chunk: KBChunk;
  score: number;
  rank: number;
}

// BM25 tuning parameters
const K1 = 1.2;
const B = 0.75;

// Common stop words (English + Malay)
const STOP_WORDS = new Set([
  // English
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'through', 'after', 'before', 'above', 'below', 'up', 'down', 'out',
  'off', 'over', 'under', 'and', 'but', 'or', 'nor', 'not', 'no',
  'so', 'if', 'then', 'than', 'that', 'this', 'it', 'its', 'i', 'me',
  'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
  'they', 'them', 'their', 'what', 'which', 'who', 'when', 'where',
  'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some',
  'any', 'such', 'only', 'very', 'just',
  // Malay
  'dan', 'atau', 'yang', 'di', 'ke', 'dari', 'untuk', 'dengan',
  'pada', 'ini', 'itu', 'adalah', 'akan', 'telah', 'sudah', 'juga',
  'tidak', 'bukan', 'ada', 'saya', 'kami', 'kita', 'anda', 'mereka',
]);

/**
 * Tokenize and normalize text for BM25.
 * Lowercases, removes punctuation, filters stop words.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff\u0b80-\u0bff]/g, ' ') // Keep CJK + Tamil chars
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * In-memory BM25 index over KB chunks.
 */
export class BM25Index {
  private documents: KBChunk[] = [];
  private docTokens: string[][] = [];
  private docLengths: number[] = [];
  private avgDocLength = 0;
  private termDocFreq = new Map<string, number>(); // term → number of docs containing it
  private N = 0; // total number of documents

  /**
   * Build the BM25 index from KB chunks.
   */
  index(chunks: KBChunk[]): void {
    const start = Date.now();
    this.documents = chunks;
    this.N = chunks.length;
    this.docTokens = [];
    this.docLengths = [];
    this.termDocFreq = new Map();

    let totalLength = 0;

    for (const chunk of chunks) {
      const tokens = tokenize(chunk.text);
      this.docTokens.push(tokens);
      this.docLengths.push(tokens.length);
      totalLength += tokens.length;

      // Count unique terms per document for DF
      const uniqueTerms = new Set(tokens);
      for (const term of uniqueTerms) {
        this.termDocFreq.set(term, (this.termDocFreq.get(term) || 0) + 1);
      }
    }

    this.avgDocLength = this.N > 0 ? totalLength / this.N : 0;
    console.log(`[RAG:BM25] Indexed ${this.N} chunks (${this.termDocFreq.size} unique terms) in ${Date.now() - start}ms`);
  }

  /**
   * Search the index with a query.
   *
   * @param query - User query text
   * @param topK - Number of top results to return
   * @returns Scored and ranked results
   */
  search(query: string, topK: number = 20): BM25Result[] {
    if (this.N === 0) return [];

    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    const scores: number[] = new Array(this.N).fill(0);

    for (const term of queryTerms) {
      const df = this.termDocFreq.get(term) || 0;
      if (df === 0) continue;

      // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
      const idf = Math.log((this.N - df + 0.5) / (df + 0.5) + 1);

      for (let i = 0; i < this.N; i++) {
        // Term frequency in document
        const tf = this.countTerm(this.docTokens[i], term);
        if (tf === 0) continue;

        // BM25 score component
        const docLen = this.docLengths[i];
        const numerator = tf * (K1 + 1);
        const denominator = tf + K1 * (1 - B + B * (docLen / this.avgDocLength));
        scores[i] += idf * (numerator / denominator);
      }
    }

    // Get top-K results
    const results: BM25Result[] = [];
    const indices = scores
      .map((score, idx) => ({ score, idx }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    for (let rank = 0; rank < indices.length; rank++) {
      const { score, idx } = indices[rank];
      results.push({
        chunk: this.documents[idx],
        score,
        rank: rank + 1,
      });
    }

    return results;
  }

  /**
   * Count occurrences of a term in a token array.
   */
  private countTerm(tokens: string[], term: string): number {
    let count = 0;
    for (const t of tokens) {
      if (t === term) count++;
    }
    return count;
  }

  /** Number of indexed documents */
  get size(): number {
    return this.N;
  }
}
