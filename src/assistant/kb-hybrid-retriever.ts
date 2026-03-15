/**
 * kb-hybrid-retriever.ts — Hybrid RAG Retrieval for Knowledge Base
 *
 * US-912: Combines BM25 keyword ranking + vector cosine similarity via
 * Reciprocal Rank Fusion (RRF), followed by cross-encoder reranking.
 *
 * Pipeline:
 *   1. Chunk KB content into ~300-token pieces with 15% overlap
 *   2. BM25 keyword ranking over all chunks
 *   3. Vector cosine similarity ranking (Xenova/all-MiniLM-L6-v2)
 *   4. RRF fusion: score = Σ 1/(k + rank_i), k=60
 *   5. Cross-encoder reranking of top-20 candidates
 *   6. Return top-3 chunks above relevance threshold (default 0.65)
 */

import { pipeline, env } from '@xenova/transformers';

// Use cached models only
env.allowLocalModels = false;

// ─── Constants ────────────────────────────────────────────────────────

const CHUNK_SIZE_WORDS = 300;      // ~300 tokens (1 word ≈ 1.3 tokens)
const OVERLAP_RATIO = 0.15;        // 15% overlap
const OVERLAP_WORDS = Math.round(CHUNK_SIZE_WORDS * OVERLAP_RATIO); // ~45 words
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const RRF_K = 60;
const RERANK_CANDIDATES = 20;
const DEFAULT_TOP_K = 3;
const DEFAULT_THRESHOLD = 0.65;
const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
const CROSS_ENCODER_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';

// ─── Types ────────────────────────────────────────────────────────────

export interface KBChunk {
  id: string;
  filename: string;
  content: string;
  tokens: number;
}

export interface RetrievalResult {
  chunks: string[];
  belowThreshold: boolean;
  retrievalTimeMs: number;
}

// ─── Text Utilities ───────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Chunk text into ~CHUNK_SIZE_WORDS pieces with OVERLAP_WORDS overlap.
 * Splits on sentence boundaries when possible.
 */
function chunkText(text: string, chunkWords: number, overlapWords: number): string[] {
  const sentences = text
    .replace(/\n{2,}/g, '\n\n')
    .split(/(?<=[.!?\n])\s+/)
    .filter(s => s.trim().length > 0);

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWordCount = 0;

  for (const sentence of sentences) {
    const sentWords = countWords(sentence);

    if (currentWordCount + sentWords > chunkWords && current.length > 0) {
      chunks.push(current.join(' '));

      // Overlap: keep last overlapWords words
      const overlap: string[] = [];
      let overlapCount = 0;
      for (let i = current.length - 1; i >= 0 && overlapCount < overlapWords; i--) {
        const w = countWords(current[i]);
        overlap.unshift(current[i]);
        overlapCount += w;
      }
      current = overlap;
      currentWordCount = overlapCount;
    }

    current.push(sentence);
    currentWordCount += sentWords;
  }

  if (current.length > 0) {
    chunks.push(current.join(' '));
  }

  return chunks.filter(c => c.trim().length > 0);
}

// ─── BM25 ─────────────────────────────────────────────────────────────

interface BM25Index {
  chunks: KBChunk[];
  termDf: Map<string, number>;       // term -> document frequency
  docLengths: number[];              // word count per chunk
  avgDocLen: number;
}

function buildBM25Index(chunks: KBChunk[]): BM25Index {
  const termDf = new Map<string, number>();
  const docLengths: number[] = [];
  let totalLen = 0;

  for (const chunk of chunks) {
    const terms = new Set(tokenize(chunk.content));
    const wordCount = countWords(chunk.content);
    docLengths.push(wordCount);
    totalLen += wordCount;
    for (const term of terms) {
      termDf.set(term, (termDf.get(term) ?? 0) + 1);
    }
  }

  return {
    chunks,
    termDf,
    docLengths,
    avgDocLen: chunks.length > 0 ? totalLen / chunks.length : 1,
  };
}

function bm25Score(index: BM25Index, query: string): Array<{ idx: number; score: number }> {
  const queryTerms = tokenize(query);
  const N = index.chunks.length;
  const scores: number[] = new Array(N).fill(0);

  for (const term of queryTerms) {
    const df = index.termDf.get(term) ?? 0;
    if (df === 0) continue;

    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

    for (let i = 0; i < N; i++) {
      const docTerms = tokenize(index.chunks[i].content);
      const tf = docTerms.filter(t => t === term).length;
      if (tf === 0) continue;

      const dl = index.docLengths[i];
      const normTf = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * dl / index.avgDocLen));
      scores[i] += idf * normTf;
    }
  }

  return scores
    .map((score, idx) => ({ idx, score }))
    .sort((a, b) => b.score - a.score);
}

// ─── Vector Search ────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

async function embedText(embedder: any, text: string): Promise<number[]> {
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

// ─── RRF ──────────────────────────────────────────────────────────────

function rrfFuse(
  rankListA: Array<{ idx: number; score: number }>,
  rankListB: Array<{ idx: number; score: number }>,
  k: number = RRF_K
): Array<{ idx: number; rrfScore: number }> {
  const scores = new Map<number, number>();

  for (let rank = 0; rank < rankListA.length; rank++) {
    const { idx } = rankListA[rank];
    scores.set(idx, (scores.get(idx) ?? 0) + 1 / (k + rank + 1));
  }
  for (let rank = 0; rank < rankListB.length; rank++) {
    const { idx } = rankListB[rank];
    scores.set(idx, (scores.get(idx) ?? 0) + 1 / (k + rank + 1));
  }

  return Array.from(scores.entries())
    .map(([idx, rrfScore]) => ({ idx, rrfScore }))
    .sort((a, b) => b.rrfScore - a.rrfScore);
}

// ─── KBHybridRetriever ────────────────────────────────────────────────

export class KBHybridRetriever {
  private chunks: KBChunk[] = [];
  private bm25Index: BM25Index | null = null;
  private chunkEmbeddings: number[][] | null = null;

  private embedder: any = null;
  private crossEncoder: any = null;
  private embedderLoading: Promise<void> | null = null;
  private crossEncoderLoading: Promise<void> | null = null;

  private indexVersion = 0;

  /**
   * Build in-memory index from KB file map.
   * Skips memory/ files (they are operational context, not KB content).
   * Called on init and KB reload.
   */
  buildIndex(files: Map<string, string>): void {
    const newChunks: KBChunk[] = [];

    for (const [filename, content] of files) {
      if (!content || filename.startsWith('memory/') || filename === 'memory.md') continue;
      // Skip empty-ish files
      if (content.trim().length < 20) continue;

      const fileChunks = chunkText(content, CHUNK_SIZE_WORDS, OVERLAP_WORDS);
      for (let i = 0; i < fileChunks.length; i++) {
        newChunks.push({
          id: `${filename}:${i}`,
          filename,
          content: fileChunks[i].trim(),
          tokens: Math.round(countWords(fileChunks[i]) * 1.3),
        });
      }
    }

    this.chunks = newChunks;
    this.bm25Index = buildBM25Index(newChunks);
    this.chunkEmbeddings = null; // reset; will be rebuilt lazily
    this.indexVersion++;

    console.log(`[KBHybrid] Index built: ${newChunks.length} chunks from ${files.size} files (v${this.indexVersion})`);
  }

  /** Pre-warm embeddings asynchronously (call after buildIndex at startup) */
  async precomputeEmbeddings(): Promise<void> {
    if (this.chunks.length === 0) return;
    try {
      const embedder = await this.getEmbedder();
      console.log(`[KBHybrid] Pre-computing ${this.chunks.length} chunk embeddings...`);
      const start = Date.now();
      this.chunkEmbeddings = await Promise.all(
        this.chunks.map(chunk => embedText(embedder, chunk.content))
      );
      console.log(`[KBHybrid] Chunk embeddings ready in ${Date.now() - start}ms`);
    } catch (err: any) {
      console.warn('[KBHybrid] Pre-compute embeddings failed:', err.message);
    }
  }

  /**
   * Retrieve top-K relevant chunks for a query.
   *
   * Returns { chunks: string[], belowThreshold: boolean }
   * If no chunk exceeds the threshold, belowThreshold=true and chunks=[]
   * (caller should NOT inject KB context — let AI answer from training data)
   */
  async retrieve(
    query: string,
    topK: number = DEFAULT_TOP_K,
    threshold: number = DEFAULT_THRESHOLD
  ): Promise<RetrievalResult> {
    const start = Date.now();

    if (this.chunks.length === 0 || !this.bm25Index) {
      return { chunks: [], belowThreshold: true, retrievalTimeMs: Date.now() - start };
    }

    try {
      // Step 1: BM25 ranking
      const bm25Ranks = bm25Score(this.bm25Index, query);

      // Step 2: Vector ranking (lazy init embeddings)
      let vectorRanks: Array<{ idx: number; score: number }> = [];
      try {
        const embedder = await this.getEmbedder();
        const queryEmbed = await embedText(embedder, query);

        // Ensure chunk embeddings are available
        if (!this.chunkEmbeddings || this.chunkEmbeddings.length !== this.chunks.length) {
          this.chunkEmbeddings = await Promise.all(
            this.chunks.map(chunk => embedText(embedder, chunk.content))
          );
        }

        vectorRanks = this.chunkEmbeddings
          .map((emb, idx) => ({ idx, score: cosineSimilarity(queryEmbed, emb) }))
          .sort((a, b) => b.score - a.score);
      } catch (err: any) {
        console.warn('[KBHybrid] Vector ranking failed, using BM25 only:', err.message);
        vectorRanks = bm25Ranks;
      }

      // Step 3: RRF fusion
      const rrfRanked = rrfFuse(bm25Ranks, vectorRanks, RRF_K);
      const top20Indices = rrfRanked.slice(0, RERANK_CANDIDATES).map(r => r.idx);

      // Step 4: Cross-encoder reranking
      const reranked = await this.crossEncoderRerank(query, top20Indices);

      // Step 5: Apply threshold
      if (reranked.length === 0 || reranked[0].score < threshold) {
        const elapsed = Date.now() - start;
        console.log(`[KBHybrid] Query below threshold (best=${reranked[0]?.score?.toFixed(3) ?? 'n/a'}, threshold=${threshold}) in ${elapsed}ms`);
        return { chunks: [], belowThreshold: true, retrievalTimeMs: elapsed };
      }

      const topChunks = reranked
        .slice(0, topK)
        .filter(r => r.score >= threshold)
        .map(r => this.chunks[r.idx].content);

      const elapsed = Date.now() - start;
      console.log(`[KBHybrid] Retrieved ${topChunks.length} chunks (best=${reranked[0].score.toFixed(3)}) in ${elapsed}ms`);

      return { chunks: topChunks, belowThreshold: topChunks.length === 0, retrievalTimeMs: elapsed };

    } catch (err: any) {
      console.warn('[KBHybrid] Retrieval failed, returning empty:', err.message);
      return { chunks: [], belowThreshold: true, retrievalTimeMs: Date.now() - start };
    }
  }

  // ─── Private: Model Loading ──────────────────────────────────────────

  private async getEmbedder(): Promise<any> {
    if (this.embedder) return this.embedder;
    if (this.embedderLoading) return this.embedderLoading.then(() => this.embedder);

    this.embedderLoading = (async () => {
      console.log('[KBHybrid] Loading embedding model...');
      const start = Date.now();
      this.embedder = await pipeline('feature-extraction', EMBED_MODEL, { quantized: true });
      console.log(`[KBHybrid] Embedding model ready in ${Date.now() - start}ms`);
    })();

    await this.embedderLoading;
    return this.embedder;
  }

  private async getCrossEncoder(): Promise<any> {
    if (this.crossEncoder) return this.crossEncoder;
    if (this.crossEncoderLoading) return this.crossEncoderLoading.then(() => this.crossEncoder);

    this.crossEncoderLoading = (async () => {
      console.log('[KBHybrid] Loading cross-encoder model...');
      const start = Date.now();
      this.crossEncoder = await pipeline('text-classification', CROSS_ENCODER_MODEL, { quantized: true });
      console.log(`[KBHybrid] Cross-encoder ready in ${Date.now() - start}ms`);
    })();

    await this.crossEncoderLoading;
    return this.crossEncoder;
  }

  // ─── Private: Cross-encoder Reranking ───────────────────────────────

  private async crossEncoderRerank(
    query: string,
    candidateIndices: number[]
  ): Promise<Array<{ idx: number; score: number }>> {
    if (candidateIndices.length === 0) return [];

    try {
      const crossEncoder = await this.getCrossEncoder();

      // Score each candidate
      const pairs = candidateIndices.map(idx => ({
        idx,
        text: query,
        text_pair: this.chunks[idx].content,
      }));

      const scores: Array<{ idx: number; score: number }> = [];
      for (const pair of pairs) {
        const result = await crossEncoder(pair.text, { text_pair: pair.text_pair });
        // ms-marco models output logit; higher = more relevant
        const rawScore = Array.isArray(result) ? result[0]?.score ?? 0 : result?.score ?? 0;
        // Normalize to 0-1 range using sigmoid
        const normalizedScore = 1 / (1 + Math.exp(-rawScore));
        scores.push({ idx: pair.idx, score: normalizedScore });
      }

      return scores.sort((a, b) => b.score - a.score);

    } catch (err: any) {
      console.warn('[KBHybrid] Cross-encoder reranking failed, using RRF order:', err.message);
      // Fall back to RRF ranking with uniform scores (slightly above threshold)
      return candidateIndices.map((idx, rank) => ({
        idx,
        score: Math.max(0, 0.8 - rank * 0.02), // degrading scores from 0.8
      }));
    }
  }
}
