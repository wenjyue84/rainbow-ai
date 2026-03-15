/**
 * US-966: OWASP LLM06 — Vector store access control and embedding partitioning.
 *
 * Tests:
 *   AC1: Namespace isolation — cross-tenant chunks are detected
 *   AC2: Service identity validation — unauthenticated callers are denied
 *   AC4: Quarterly audit — cross-namespace vectors are flagged
 *   AC5: Similarity attack detection — high-score out-of-namespace matches trigger alert
 */

import { describe, it, expect } from 'vitest';
import {
  validateServiceIdentity,
  detectCrossNamespaceChunks,
  detectSimilarityAttack,
  runAccessGuard,
} from '../rag/vector-access-guard.js';
import type { VectorQueryContext } from '../rag/vector-access-guard.js';
import type { ScoredChunk } from '../rag/hybrid-retriever.js';
import { auditRetriever } from '../rag/ns-audit.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeChunk(
  id: string,
  propertyId: string | undefined,
  score = 0.8
): ScoredChunk {
  return {
    chunk: {
      id,
      source: `${id}.md`,
      text: `Content for ${id}`,
      tokenCount: 10,
      propertyId,
    },
    score,
    scoreSource: 'rrf',
  };
}

// ─── AC2: Service Identity Validation ───────────────────────────────────────

describe('US-966 AC2: Service identity validation', () => {
  it('accepts valid service identities', () => {
    const validIdentities = [
      'rainbow-ai',
      'rainbow-ai-southern',
      'rainbow-ai-makan',
      'admin-panel',
      'test-harness',
    ];
    for (const id of validIdentities) {
      expect(
        validateServiceIdentity({ propertyId: 'pelangi', serviceIdentity: id })
      ).toBe(true);
    }
  });

  it('rejects unknown service identities', () => {
    expect(
      validateServiceIdentity({ propertyId: 'pelangi', serviceIdentity: 'unknown' })
    ).toBe(false);
    expect(
      validateServiceIdentity({ propertyId: 'pelangi', serviceIdentity: '' })
    ).toBe(false);
  });

  it('runAccessGuard returns 403 for invalid service identity', async () => {
    const context: VectorQueryContext = {
      propertyId: 'pelangi',
      serviceIdentity: 'hacker-bot',
    };
    const chunks = [makeChunk('faq', 'pelangi')];
    const result = await runAccessGuard(context, 'test query', chunks, 10);

    expect(result.allowed).toBe(false);
    expect(result.status).toBe(403);
    expect(result.reason).toContain('hacker-bot');
  });

  it('runAccessGuard returns 200 for valid service identity', async () => {
    const context: VectorQueryContext = {
      propertyId: 'pelangi',
      serviceIdentity: 'rainbow-ai',
    };
    const chunks = [makeChunk('faq', 'pelangi')];
    const result = await runAccessGuard(context, 'test query', chunks, 10);

    expect(result.allowed).toBe(true);
    expect(result.status).toBe(200);
  });
});

// ─── AC1: Namespace Isolation ───────────────────────────────────────────────

describe('US-966 AC1: Namespace isolation', () => {
  it('returns empty when all chunks match expected namespace', () => {
    const chunks = [
      makeChunk('pricing', 'pelangi'),
      makeChunk('faq', 'pelangi'),
    ];
    expect(detectCrossNamespaceChunks(chunks, 'pelangi')).toHaveLength(0);
  });

  it('detects cross-namespace chunks', () => {
    const chunks = [
      makeChunk('pricing', 'pelangi'),
      makeChunk('southern-rules', 'southern'),
    ];
    const leaked = detectCrossNamespaceChunks(chunks, 'pelangi');
    expect(leaked).toHaveLength(1);
    expect(leaked[0].chunk.propertyId).toBe('southern');
  });

  it('ignores chunks without propertyId (legacy/untagged)', () => {
    const chunks = [
      makeChunk('pricing', 'pelangi'),
      makeChunk('old-doc', undefined),
    ];
    expect(detectCrossNamespaceChunks(chunks, 'pelangi')).toHaveLength(0);
  });

  it('flags all foreign chunks across multiple namespaces', () => {
    const chunks = [
      makeChunk('a', 'southern'),
      makeChunk('b', 'makan'),
      makeChunk('c', 'pelangi'),
    ];
    const leaked = detectCrossNamespaceChunks(chunks, 'pelangi');
    expect(leaked).toHaveLength(2);
  });
});

// ─── AC5: Similarity Attack Detection ───────────────────────────────────────

describe('US-966 AC5: Similarity attack detection', () => {
  it('does not flag normal-score same-namespace results', () => {
    const chunks = [makeChunk('pricing', 'pelangi', 0.85)];
    expect(detectSimilarityAttack(chunks, 'pelangi')).toBe(false);
  });

  it('does not flag high-score same-namespace results below 0.999', () => {
    const chunks = [makeChunk('pricing', 'pelangi', 0.98)];
    expect(detectSimilarityAttack(chunks, 'pelangi')).toBe(false);
  });

  it('flags high-score cross-namespace match (adversarial)', () => {
    const chunks = [makeChunk('evil', 'southern', 0.98)];
    expect(detectSimilarityAttack(chunks, 'pelangi')).toBe(true);
  });

  it('flags near-perfect score (1.0) even for same namespace', () => {
    const chunks = [makeChunk('clone', 'pelangi', 0.999)];
    expect(detectSimilarityAttack(chunks, 'pelangi')).toBe(true);
  });

  it('does not flag below-threshold scores', () => {
    const chunks = [makeChunk('normal', 'southern', 0.90)];
    expect(detectSimilarityAttack(chunks, 'pelangi')).toBe(false);
  });
});

// ─── AC4: Namespace Audit ───────────────────────────────────────────────────

describe('US-966 AC4: Namespace audit (retriever inspection)', () => {
  it('passes when all chunks have correct propertyId', () => {
    // Create a mock retriever
    const mockRetriever = {
      getAllChunks: () => [
        { id: 'a#0', source: 'a.md', text: 'a', tokenCount: 1, propertyId: 'pelangi' },
        { id: 'b#0', source: 'b.md', text: 'b', tokenCount: 1, propertyId: 'pelangi' },
      ],
      isReady: true,
    };
    const result = auditRetriever('pelangi', mockRetriever as any);
    expect(result.passed).toBe(true);
    expect(result.wrongNamespaceChunks).toBe(0);
    expect(result.correctNamespaceChunks).toBe(2);
  });

  it('fails when cross-namespace chunks exist', () => {
    const mockRetriever = {
      getAllChunks: () => [
        { id: 'a#0', source: 'a.md', text: 'a', tokenCount: 1, propertyId: 'pelangi' },
        { id: 'b#0', source: 'b.md', text: 'b', tokenCount: 1, propertyId: 'southern' },
      ],
      isReady: true,
    };
    const result = auditRetriever('pelangi', mockRetriever as any);
    expect(result.passed).toBe(false);
    expect(result.wrongNamespaceChunks).toBe(1);
    expect(result.issues).toHaveLength(1);
  });

  it('treats untagged chunks as legacy (not a failure)', () => {
    const mockRetriever = {
      getAllChunks: () => [
        { id: 'a#0', source: 'a.md', text: 'a', tokenCount: 1, propertyId: undefined },
      ],
      isReady: true,
    };
    const result = auditRetriever('pelangi', mockRetriever as any);
    expect(result.passed).toBe(true);
    expect(result.untaggedChunks).toBe(1);
  });
});

// ─── Integration: Guard Pipeline ────────────────────────────────────────────

describe('US-966: Full guard pipeline', () => {
  it('allows clean retrieval with no anomalies', async () => {
    const context: VectorQueryContext = {
      propertyId: 'pelangi',
      serviceIdentity: 'rainbow-ai',
    };
    const chunks = [
      makeChunk('pricing', 'pelangi', 0.85),
      makeChunk('faq', 'pelangi', 0.75),
    ];

    const result = await runAccessGuard(context, 'how much for a room?', chunks, 50);
    expect(result.allowed).toBe(true);
    expect(result.crossNamespaceDetected).toBe(false);
    expect(result.similarityAttackSuspected).toBe(false);
  });

  it('detects cross-namespace leak in results', async () => {
    const context: VectorQueryContext = {
      propertyId: 'pelangi',
      serviceIdentity: 'rainbow-ai',
    };
    const chunks = [
      makeChunk('pricing', 'pelangi', 0.85),
      makeChunk('southern-menu', 'southern', 0.70),
    ];

    const result = await runAccessGuard(context, 'room prices', chunks, 30);
    expect(result.allowed).toBe(true); // Still allowed, but flagged
    expect(result.crossNamespaceDetected).toBe(true);
  });

  it('detects similarity attack signal', async () => {
    const context: VectorQueryContext = {
      propertyId: 'pelangi',
      serviceIdentity: 'rainbow-ai',
    };
    const chunks = [makeChunk('adversarial', 'southern', 0.99)];

    const result = await runAccessGuard(context, 'injected query', chunks, 5);
    expect(result.allowed).toBe(true);
    expect(result.similarityAttackSuspected).toBe(true);
  });
});
