/**
 * Hybrid Retriever — RAG pipeline combining BM25 + vector search + cross-encoder reranking.
 *
 * US-912: Reciprocal Rank Fusion merges BM25 and vector rankings,
 * cross-encoder reranker re-scores top-20 candidates, returns top-3 chunks.
 * Falls back to no-context if best chunk score < relevance threshold (0.65).
 */

import { pipeline as transformersPipeline, env } from '@xenova/transformers';
import type { KBChunk } from './chunker.js';
import { chunkAllFiles } from './chunker.js';
import { BM25Index } from './bm25.js';

env.allowLocalModels = false;

// ─── Configuration ────────────────────────────────────────────────────

/** RRF constant k (standard value from literature) */
const RRF_K = 60;

/** Number of candidates from each retriever before fusion */
const CANDIDATES_PER_RETRIEVER = 20;

/** Number of candidates to pass to cross-encoder reranker */
const RERANK_TOP_K = 20;

/** Final number of chunks to return */
const FINAL_TOP_K = 3;

/** Minimum relevance score to include context (0-1 scale) */
const RELEVANCE_THRESHOLD = 0.65;

// ─── Types ────────────────────────────────────────────────────────────

export interface RetrievalResult {
  /** Top-K chunks ordered by relevance */
  chunks: ScoredChunk[];
  /** Whether any chunk passed the relevance threshold */
  hasRelevantContext: boolean;
  /** Retrieval latency in ms */
  latencyMs: number;
}

export interface ScoredChunk {
  chunk: KBChunk;
  /** Final score after reranking (0-1 for cross-encoder, or RRF score) */
  score: number;
  /** Score source: 'cross-encoder' or 'rrf' */
  scoreSource: string;
}

interface RRFCandidate {
  chunk: KBChunk;
  rrfScore: number;
  bm25Rank: number | null;
  vectorRank: number | null;
}

// ─── Hybrid Retriever ─────────────────────────────────────────────────

export class HybridRetriever {
  private embedder: any = null;
  private crossEncoder: any = null;
  private bm25 = new BM25Index();
  private chunks: KBChunk[] = [];
  private chunkEmbeddings: Float32Array[] = [];
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the retriever: chunk KB files, build BM25 index, compute embeddings.
   *
   * @param kbCache - Map of filename → content from KnowledgeBaseInstance
   * @param excludeFiles - Files to exclude (e.g., core files always in system prompt)
   */
  async initialize(
    kbCache: Map<string, string>,
    excludeFiles: Set<string> = new Set()
  ): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._initialize(kbCache, excludeFiles);
    return this.initPromise;
  }

  private async _initialize(
    kbCache: Map<string, string>,
    excludeFiles: Set<string>
  ): Promise<void> {
    const start = Date.now();
    console.log('[RAG:Hybrid] Initializing hybrid retriever...');

    // Step 1: Chunk all KB files
    this.chunks = chunkAllFiles(kbCache, excludeFiles);
    if (this.chunks.length === 0) {
      console.warn('[RAG:Hybrid] No chunks to index — retriever will be inactive');
      this.initialized = true;
      return;
    }

    // Step 2: Build BM25 index
    this.bm25.index(this.chunks);

    // Step 3: Load embedding model (reuse same model as semantic-matcher)
    console.log('[RAG:Hybrid] Loading embedding model...');
    this.embedder = await transformersPipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { quantized: true }
    );

    // Step 4: Pre-compute embeddings for all chunks
    console.log(`[RAG:Hybrid] Computing embeddings for ${this.chunks.length} chunks...`);
    const embeddingStart = Date.now();
    this.chunkEmbeddings = [];

    // Batch embed for efficiency
    for (const chunk of this.chunks) {
      const embedding = await this.embed(chunk.text);
      this.chunkEmbeddings.push(embedding);
    }
    console.log(`[RAG:Hybrid] Embeddings computed in ${Date.now() - embeddingStart}ms`);

    // Step 5: Load cross-encoder model for reranking
    console.log('[RAG:Hybrid] Loading cross-encoder reranker...');
    try {
      this.crossEncoder = await transformersPipeline(
        'text-classification',
        'Xenova/ms-marco-MiniLM-L-6-v2',
        { quantized: true }
      );
      console.log('[RAG:Hybrid] Cross-encoder loaded successfully');
    } catch (err: any) {
      console.warn(`[RAG:Hybrid] Cross-encoder failed to load: ${err.message} — will use RRF scores only`);
      this.crossEncoder = null;
    }

    this.initialized = true;
    console.log(`[RAG:Hybrid] Initialization complete in ${Date.now() - start}ms (${this.chunks.length} chunks)`);
  }

  /**
   * Retrieve relevant KB chunks for a user query.
   *
   * Pipeline: BM25 search → Vector search → RRF fusion → Cross-encoder reranking → Top-3
   *
   * @param query - User message text
   * @returns Retrieval result with scored chunks and metadata
   */
  async retrieve(query: string): Promise<RetrievalResult> {
    const start = Date.now();

    if (!this.initialized || this.chunks.length === 0) {
      return { chunks: [], hasRelevantContext: false, latencyMs: 0 };
    }

    // Step 1: BM25 lexical search
    const bm25Results = this.bm25.search(query, CANDIDATES_PER_RETRIEVER);

    // Step 2: Vector semantic search
    const vectorResults = await this.vectorSearch(query, CANDIDATES_PER_RETRIEVER);

    // Step 3: Reciprocal Rank Fusion
    const rrfCandidates = this.reciprocalRankFusion(bm25Results, vectorResults);

    // Step 4: Cross-encoder reranking on top candidates
    const topCandidates = rrfCandidates.slice(0, RERANK_TOP_K);
    let scoredChunks: ScoredChunk[];

    if (this.crossEncoder && topCandidates.length > 0) {
      scoredChunks = await this.crossEncoderRerank(query, topCandidates);
    } else {
      // Fallback: use RRF scores directly
      scoredChunks = topCandidates.map(c => ({
        chunk: c.chunk,
        score: c.rrfScore,
        scoreSource: 'rrf',
      }));
    }

    // Step 5: Take top-3 and apply relevance threshold
    const finalChunks = scoredChunks.slice(0, FINAL_TOP_K);
    const hasRelevantContext = finalChunks.length > 0 && finalChunks[0].score >= RELEVANCE_THRESHOLD;

    const latencyMs = Date.now() - start;
    console.log(
      `[RAG:Hybrid] Retrieved ${finalChunks.length} chunks in ${latencyMs}ms ` +
      `(best=${finalChunks[0]?.score.toFixed(3) ?? 'N/A'}, threshold=${RELEVANCE_THRESHOLD}, ` +
      `relevant=${hasRelevantContext})`
    );

    return {
      chunks: hasRelevantContext ? finalChunks : [],
      hasRelevantContext,
      latencyMs,
    };
  }

  /**
   * Rebuild index when KB files change.
   */
  async rebuild(kbCache: Map<string, string>, excludeFiles: Set<string> = new Set()): Promise<void> {
    console.log('[RAG:Hybrid] Rebuilding index...');
    this.chunks = chunkAllFiles(kbCache, excludeFiles);
    this.bm25.index(this.chunks);

    // Recompute embeddings
    this.chunkEmbeddings = [];
    for (const chunk of this.chunks) {
      const embedding = await this.embed(chunk.text);
      this.chunkEmbeddings.push(embedding);
    }

    console.log(`[RAG:Hybrid] Index rebuilt with ${this.chunks.length} chunks`);
  }

  get isReady(): boolean {
    return this.initialized;
  }

  // ─── Private Methods ───────────────────────────────────────────────

  /**
   * Compute embedding for text using all-MiniLM-L6-v2.
   */
  private async embed(text: string): Promise<Float32Array> {
    const output = await this.embedder(text, {
      pooling: 'mean',
      normalize: true,
    });
    return new Float32Array(output.data);
  }

  /**
   * Vector similarity search using cosine similarity.
   */
  private async vectorSearch(
    query: string,
    topK: number
  ): Promise<Array<{ chunk: KBChunk; score: number; rank: number }>> {
    const queryEmbedding = await this.embed(query);

    // Compute cosine similarity with all chunks
    const scores: Array<{ idx: number; score: number }> = [];
    for (let i = 0; i < this.chunkEmbeddings.length; i++) {
      const score = this.cosineSimilarity(queryEmbedding, this.chunkEmbeddings[i]);
      if (score > 0) {
        scores.push({ idx: i, score });
      }
    }

    // Sort by score descending and take top-K
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK).map((item, rank) => ({
      chunk: this.chunks[item.idx],
      score: item.score,
      rank: rank + 1,
    }));
  }

  /**
   * Reciprocal Rank Fusion (RRF) — merges BM25 and vector rankings.
   *
   * score = Σ 1/(k + rank_i) where k=60
   */
  private reciprocalRankFusion(
    bm25Results: Array<{ chunk: KBChunk; score: number; rank: number }>,
    vectorResults: Array<{ chunk: KBChunk; score: number; rank: number }>
  ): RRFCandidate[] {
    const candidateMap = new Map<string, RRFCandidate>();

    // Add BM25 results
    for (const result of bm25Results) {
      const id = result.chunk.id;
      candidateMap.set(id, {
        chunk: result.chunk,
        rrfScore: 1 / (RRF_K + result.rank),
        bm25Rank: result.rank,
        vectorRank: null,
      });
    }

    // Add/merge vector results
    for (const result of vectorResults) {
      const id = result.chunk.id;
      const existing = candidateMap.get(id);
      if (existing) {
        existing.rrfScore += 1 / (RRF_K + result.rank);
        existing.vectorRank = result.rank;
      } else {
        candidateMap.set(id, {
          chunk: result.chunk,
          rrfScore: 1 / (RRF_K + result.rank),
          bm25Rank: null,
          vectorRank: result.rank,
        });
      }
    }

    // Sort by RRF score descending
    const candidates = Array.from(candidateMap.values());
    candidates.sort((a, b) => b.rrfScore - a.rrfScore);

    return candidates;
  }

  /**
   * Cross-encoder reranking using ms-marco-MiniLM-L-6-v2.
   * Takes (query, passage) pairs and produces relevance scores.
   */
  private async crossEncoderRerank(
    query: string,
    candidates: RRFCandidate[]
  ): Promise<ScoredChunk[]> {
    const scored: ScoredChunk[] = [];

    for (const candidate of candidates) {
      try {
        // Cross-encoder input: "[CLS] query [SEP] passage [SEP]"
        const input = `${query} [SEP] ${candidate.chunk.text}`;
        const result = await this.crossEncoder(input, { topk: 1 });

        // The model outputs logits; use sigmoid to get 0-1 score
        const rawScore = Array.isArray(result) ? result[0]?.score ?? 0 : result?.score ?? 0;
        const score = this.sigmoid(rawScore);

        scored.push({
          chunk: candidate.chunk,
          score,
          scoreSource: 'cross-encoder',
        });
      } catch {
        // Fallback to RRF score if cross-encoder fails for this pair
        scored.push({
          chunk: candidate.chunk,
          score: candidate.rrfScore,
          scoreSource: 'rrf',
        });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  /**
   * Cosine similarity between two Float32Array vectors.
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);
    if (magA === 0 || magB === 0) return 0;
    return dot / (magA * magB);
  }

  /**
   * Sigmoid function to normalize scores to 0-1.
   */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }
}
