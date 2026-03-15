/**
 * RAG Module — Hybrid Retrieval-Augmented Generation for KB queries.
 *
 * US-912: BM25 + vector search + RRF fusion + cross-encoder reranking.
 */

export { chunkFile, chunkAllFiles, type KBChunk } from './chunker.js';
export { BM25Index, type BM25Result } from './bm25.js';
export { HybridRetriever, type RetrievalResult, type ScoredChunk } from './hybrid-retriever.js';
