/**
 * RAG Module — Hybrid Retrieval-Augmented Generation for KB queries.
 *
 * US-912: BM25 + vector search + RRF fusion + cross-encoder reranking.
 * US-966: OWASP LLM06 vector store access control and namespace partitioning.
 */

export { chunkFile, chunkAllFiles, type KBChunk } from './chunker.js';
export { BM25Index, type BM25Result } from './bm25.js';
export { HybridRetriever, type RetrievalResult, type ScoredChunk } from './hybrid-retriever.js';
export {
  runAccessGuard,
  validateServiceIdentity,
  detectCrossNamespaceChunks,
  detectSimilarityAttack,
  type VectorQueryContext,
  type GuardResult,
} from './vector-access-guard.js';
export {
  runNamespaceAudit,
  auditRetriever,
  scanAccessLogs,
  type NamespaceAuditResult,
} from './ns-audit.js';
