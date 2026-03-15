/**
 * Vector Access Guard — OWASP LLM06:2025 compliance layer.
 *
 * US-966: Implements access control and auditing for vector store queries:
 *   1. Namespace enforcement: verifies all returned chunks belong to the
 *      requesting property's namespace (cross-tenant leak detection).
 *   2. Access logging: writes every retrieval to vector_access_logs for
 *      90-day audit trail retention.
 *   3. Similarity attack detection: flags queries where the top-score chunk
 *      has an anomalously high match (> ATTACK_SCORE_THRESHOLD) — potential
 *      embedding inversion or adversarial similarity attack.
 *   4. Service identity check: rejects retrieval requests that lack a valid
 *      service identity token.
 *
 * Reference: https://genai.owasp.org/llmrisk/llm062025-vector-and-embedding-weaknesses/
 */

import { createHash } from 'crypto';
import type { ScoredChunk } from './hybrid-retriever.js';

// ─── Configuration ─────────────────────────────────────────────────────────

/** Score above which a match is considered suspiciously high (similarity attack signal). */
const ATTACK_SCORE_THRESHOLD = 0.97;

/** Valid service identities allowed to perform vector retrievals. */
const VALID_SERVICE_IDENTITIES = new Set([
  'rainbow-ai',
  'rainbow-ai-southern',
  'rainbow-ai-makan',
  'admin-panel',
  'test-harness',
]);

// ─── Types ─────────────────────────────────────────────────────────────────

export interface VectorQueryContext {
  /** The property making the retrieval request. */
  propertyId: string;
  /** Service identity token (must be in VALID_SERVICE_IDENTITIES). */
  serviceIdentity: string;
}

export interface GuardResult {
  /** Whether the retrieval is allowed to proceed. */
  allowed: boolean;
  /** HTTP-equivalent status code (200, 403). */
  status: 200 | 403;
  /** Human-readable reason for denial (if not allowed). */
  reason?: string;
  /** Whether cross-namespace contamination was detected in results. */
  crossNamespaceDetected: boolean;
  /** Whether a similarity attack was suspected. */
  similarityAttackSuspected: boolean;
}

// ─── Access Control ────────────────────────────────────────────────────────

/**
 * Validate that the caller has a valid service identity.
 * Unauthenticated callers are denied (OWASP LLM06 AC2).
 */
export function validateServiceIdentity(context: VectorQueryContext): boolean {
  return VALID_SERVICE_IDENTITIES.has(context.serviceIdentity);
}

/**
 * Enforce namespace isolation on retrieved chunks (OWASP LLM06 AC1).
 *
 * Verifies all returned chunks belong to the requesting property's namespace.
 * Returns any chunks whose propertyId does not match the expected namespace.
 *
 * @param chunks - Retrieved scored chunks
 * @param expectedPropertyId - The property that issued the query
 * @returns Array of chunks with mismatched propertyId (empty = clean)
 */
export function detectCrossNamespaceChunks(
  chunks: ScoredChunk[],
  expectedPropertyId: string
): ScoredChunk[] {
  return chunks.filter(sc => {
    const chunkProp = sc.chunk.propertyId;
    // Only flag if the chunk has a propertyId set AND it differs from expected
    return chunkProp !== undefined && chunkProp !== expectedPropertyId;
  });
}

/**
 * Detect similarity attack signal (OWASP LLM06 AC5).
 *
 * A suspiciously high-score match (> 0.97) that comes from outside the expected
 * namespace may indicate an adversarial query or embedding inversion attack.
 *
 * @param chunks - Retrieved scored chunks
 * @param expectedPropertyId - The property that issued the query
 * @returns true if a potential similarity attack is detected
 */
export function detectSimilarityAttack(
  chunks: ScoredChunk[],
  expectedPropertyId: string
): boolean {
  for (const sc of chunks) {
    if (sc.score >= ATTACK_SCORE_THRESHOLD) {
      const chunkProp = sc.chunk.propertyId;
      // Flag if: chunk has a different propertyId OR score is suspiciously perfect (1.0)
      if ((chunkProp !== undefined && chunkProp !== expectedPropertyId) || sc.score >= 0.999) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Run the full access guard pipeline for a vector retrieval result.
 *
 * 1. Validates service identity
 * 2. Detects cross-namespace chunks
 * 3. Detects similarity attack signal
 * 4. Logs the access event to DB (async, non-blocking)
 *
 * @param context - Who is making the query
 * @param query - Original query text (hashed for privacy in logs)
 * @param chunks - Retrieved chunks to validate
 * @param latencyMs - Retrieval latency
 * @returns GuardResult — callers must check `allowed` before using chunks
 */
export async function runAccessGuard(
  context: VectorQueryContext,
  query: string,
  chunks: ScoredChunk[],
  latencyMs: number
): Promise<GuardResult> {
  // Step 1: Service identity check
  if (!validateServiceIdentity(context)) {
    console.warn(
      `[VectorGuard] DENIED: invalid service identity "${context.serviceIdentity}" ` +
      `for property "${context.propertyId}"`
    );
    logAccessEvent(context, query, chunks, latencyMs, false, false).catch(() => {});
    return {
      allowed: false,
      status: 403,
      reason: `Invalid service identity: ${context.serviceIdentity}`,
      crossNamespaceDetected: false,
      similarityAttackSuspected: false,
    };
  }

  // Step 2: Cross-namespace detection
  const crossNamespaceChunks = detectCrossNamespaceChunks(chunks, context.propertyId);
  const crossNamespaceDetected = crossNamespaceChunks.length > 0;

  if (crossNamespaceDetected) {
    console.error(
      `[VectorGuard] CROSS-NAMESPACE LEAK: property "${context.propertyId}" received ` +
      `${crossNamespaceChunks.length} chunk(s) from namespace(s): ` +
      crossNamespaceChunks.map(sc => sc.chunk.propertyId).join(', ')
    );
  }

  // Step 3: Similarity attack detection
  const similarityAttackSuspected = detectSimilarityAttack(chunks, context.propertyId);

  if (similarityAttackSuspected) {
    const topScore = chunks[0]?.score ?? 0;
    console.warn(
      `[VectorGuard] SIMILARITY ATTACK SUSPECTED: property "${context.propertyId}", ` +
      `top score=${topScore.toFixed(4)}`
    );
  }

  // Step 4: Log to DB (non-blocking)
  logAccessEvent(context, query, chunks, latencyMs, crossNamespaceDetected, similarityAttackSuspected)
    .catch(err => console.warn('[VectorGuard] Access log write failed:', err.message));

  return {
    allowed: true,
    status: 200,
    crossNamespaceDetected,
    similarityAttackSuspected,
  };
}

// ─── Privacy-Safe Logging ──────────────────────────────────────────────────

/**
 * Hash the query for privacy-safe logging (SHA-256, first 16 hex chars).
 * Raw query text is never stored in the audit log.
 */
function hashQuery(query: string): string {
  return createHash('sha256').update(query).digest('hex').substring(0, 16);
}

/**
 * Write a vector access log entry to the DB.
 * Called asynchronously — failures are logged but never block retrieval.
 */
async function logAccessEvent(
  context: VectorQueryContext,
  query: string,
  chunks: ScoredChunk[],
  latencyMs: number,
  crossNamespaceDetected: boolean,
  similarityAttackSuspected: boolean
): Promise<void> {
  try {
    const { db } = await import('../../lib/db.js');
    const { vectorAccessLogs } = await import('../../../shared/schema-tables.js');

    const retrievedSources = chunks.map(sc => sc.chunk.source);
    const topScore = chunks[0]?.score ?? null;

    await db.insert(vectorAccessLogs).values({
      propertyId: context.propertyId,
      queryHash: hashQuery(query),
      chunksReturned: chunks.length,
      retrievedSources: JSON.stringify(retrievedSources),
      topScore,
      crossNamespaceDetected,
      similarityAttackSuspected,
      latencyMs,
      serviceIdentity: context.serviceIdentity,
    });
  } catch (err: any) {
    // Non-fatal — logging must not block retrieval
    console.warn('[VectorGuard] Failed to write access log:', err.message);
  }
}
