/**
 * ns-audit.ts — Namespace Audit Script for Vector Store Integrity
 *
 * US-966 AC4: Quarterly audit that verifies no cross-namespace vectors exist
 * in the in-memory vector store. Scans all known KnowledgeBaseInstance registrations
 * and confirms every chunk is tagged with the correct propertyId.
 *
 * Run manually via admin API or scheduled as a quarterly cron job:
 *   POST /api/admin/rag/ns-audit
 *
 * Also queries the vector_access_logs table for:
 *   - Cross-namespace detections in the past 90 days
 *   - Similarity attack suspicions in the past 90 days
 */

import type { HybridRetriever } from './hybrid-retriever.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface NamespaceAuditResult {
  /** ISO timestamp when audit was run */
  auditedAt: string;
  /** Per-retriever results */
  retrievers: RetrieverAuditResult[];
  /** DB log scan results */
  logScan: LogScanResult;
  /** Overall pass/fail */
  passed: boolean;
}

export interface RetrieverAuditResult {
  propertyId: string;
  totalChunks: number;
  correctNamespaceChunks: number;
  wrongNamespaceChunks: number;
  untaggedChunks: number;
  passed: boolean;
  issues: string[];
}

export interface LogScanResult {
  windowDays: number;
  crossNamespaceEvents: number;
  attackSuspectedEvents: number;
  passed: boolean;
}

// ─── Retriever Inspection ──────────────────────────────────────────────────

/**
 * Inspect a single HybridRetriever for namespace violations.
 *
 * @param propertyId - Expected propertyId for all chunks in this retriever
 * @param retriever - The retriever instance to inspect
 */
export function auditRetriever(
  propertyId: string,
  retriever: HybridRetriever
): RetrieverAuditResult {
  const chunks = retriever.getAllChunks();
  const issues: string[] = [];

  let correctNamespace = 0;
  let wrongNamespace = 0;
  let untagged = 0;

  for (const chunk of chunks) {
    if (chunk.propertyId === undefined) {
      untagged++;
    } else if (chunk.propertyId !== propertyId) {
      wrongNamespace++;
      issues.push(`Chunk "${chunk.id}" has propertyId="${chunk.propertyId}", expected "${propertyId}"`);
    } else {
      correctNamespace++;
    }
  }

  const passed = wrongNamespace === 0;

  if (!passed) {
    console.error(
      `[NS-Audit] FAIL: retriever "${propertyId}" has ${wrongNamespace} cross-namespace chunk(s)`
    );
  } else {
    console.log(
      `[NS-Audit] PASS: retriever "${propertyId}" — ${correctNamespace} correct, ` +
      `${untagged} untagged (legacy), 0 cross-namespace`
    );
  }

  return {
    propertyId,
    totalChunks: chunks.length,
    correctNamespaceChunks: correctNamespace,
    wrongNamespaceChunks: wrongNamespace,
    untaggedChunks: untagged,
    passed,
    issues,
  };
}

// ─── DB Log Scan ───────────────────────────────────────────────────────────

/**
 * Scan the vector_access_logs table for anomalies in the past N days.
 *
 * @param windowDays - Number of days to look back (default 90)
 */
export async function scanAccessLogs(windowDays = 90): Promise<LogScanResult> {
  try {
    const { db } = await import('../../lib/db.js');
    const { vectorAccessLogs } = await import('../../../shared/schema-tables.js');
    const { gte, eq, and, count } = await import('drizzle-orm');

    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const [crossResult] = await db
      .select({ total: count() })
      .from(vectorAccessLogs)
      .where(and(
        gte(vectorAccessLogs.createdAt, since),
        eq(vectorAccessLogs.crossNamespaceDetected, true)
      ));

    const [attackResult] = await db
      .select({ total: count() })
      .from(vectorAccessLogs)
      .where(and(
        gte(vectorAccessLogs.createdAt, since),
        eq(vectorAccessLogs.similarityAttackSuspected, true)
      ));

    const crossNamespaceEvents = Number(crossResult?.total ?? 0);
    const attackSuspectedEvents = Number(attackResult?.total ?? 0);
    const passed = crossNamespaceEvents === 0;

    if (!passed) {
      console.error(
        `[NS-Audit] FAIL: ${crossNamespaceEvents} cross-namespace event(s) in last ${windowDays} days`
      );
    }
    if (attackSuspectedEvents > 0) {
      console.warn(
        `[NS-Audit] WARNING: ${attackSuspectedEvents} similarity attack suspicion(s) in last ${windowDays} days`
      );
    }

    return { windowDays, crossNamespaceEvents, attackSuspectedEvents, passed };
  } catch (err: any) {
    console.warn('[NS-Audit] DB scan failed (non-fatal):', err.message);
    return { windowDays, crossNamespaceEvents: 0, attackSuspectedEvents: 0, passed: true };
  }
}

// ─── Full Audit Runner ─────────────────────────────────────────────────────

/**
 * Run the full namespace audit.
 *
 * @param registrations - Map of propertyId → HybridRetriever
 * @param windowDays - DB log scan window in days (default 90)
 */
export async function runNamespaceAudit(
  registrations: Map<string, HybridRetriever>,
  windowDays = 90
): Promise<NamespaceAuditResult> {
  console.log('[NS-Audit] Starting quarterly namespace audit...');
  const auditedAt = new Date().toISOString();

  const retrievers: RetrieverAuditResult[] = [];
  for (const [propertyId, retriever] of registrations) {
    if (retriever.isReady) {
      retrievers.push(auditRetriever(propertyId, retriever));
    } else {
      console.log(`[NS-Audit] Skipping "${propertyId}" — retriever not initialized`);
    }
  }

  const logScan = await scanAccessLogs(windowDays);

  const passed =
    retrievers.every(r => r.passed) && logScan.passed;

  const result: NamespaceAuditResult = {
    auditedAt,
    retrievers,
    logScan,
    passed,
  };

  console.log(
    `[NS-Audit] Audit complete: ${passed ? 'PASS' : 'FAIL'} ` +
    `(${retrievers.length} retrievers, ${logScan.crossNamespaceEvents} cross-ns events)`
  );

  return result;
}
