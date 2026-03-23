/**
 * config-audit.ts — Admin Configuration Audit Trail (US-257)
 *
 * Provides:
 *   - SHA-256 hash computation for config content
 *   - Unified diff generation between config versions
 *   - Audit log persistence (admin_audit_log table)
 *   - Query interface for retrieving audit history
 *
 * Works alongside the existing rainbow_config_audit table (config-db.ts)
 * but focuses on file-level change tracking with content hashes and diffs.
 */

import { createHash } from 'crypto';
import { db } from './db.js';
import { adminAuditLog } from '../../shared/schema-tables.js';
import { eq, desc } from 'drizzle-orm';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('ConfigAudit');

// ─── Hash Computation ────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a config object (deterministic JSON serialization).
 */
export function computeConfigHash(data: unknown): string {
  const json = JSON.stringify(data, null, 0);
  return createHash('sha256').update(json).digest('hex');
}

// ─── Unified Diff Generation ─────────────────────────────────────────

/**
 * Generate a unified diff summary between two config objects.
 * Produces a human-readable diff showing added, removed, and changed keys.
 */
export function generateUnifiedDiff(
  before: unknown | null,
  after: unknown,
  configFile: string
): string {
  if (before === null || before === undefined) {
    return `--- /dev/null\n+++ b/${configFile}\n@@ -0,0 +1 @@\n+ [initial creation]`;
  }

  const beforeLines = JSON.stringify(before, null, 2).split('\n');
  const afterLines = JSON.stringify(after, null, 2).split('\n');

  const diffLines: string[] = [
    `--- a/${configFile}`,
    `+++ b/${configFile}`,
  ];

  // Build a simple unified diff
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  let changeCount = 0;
  const hunks: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < beforeLines.length ? beforeLines[i] : undefined;
    const newLine = i < afterLines.length ? afterLines[i] : undefined;

    if (oldLine === newLine) {
      continue;
    }

    changeCount++;
    if (oldLine !== undefined && newLine !== undefined) {
      hunks.push(`- ${oldLine}`);
      hunks.push(`+ ${newLine}`);
    } else if (oldLine === undefined) {
      hunks.push(`+ ${newLine}`);
    } else {
      hunks.push(`- ${oldLine}`);
    }
  }

  if (changeCount === 0) {
    return `--- a/${configFile}\n+++ b/${configFile}\n@@ no changes @@`;
  }

  // Add hunk header
  diffLines.push(`@@ -1,${beforeLines.length} +1,${afterLines.length} @@ (${changeCount} lines changed)`);
  diffLines.push(...hunks);

  return diffLines.join('\n');
}

// ─── Audit Log Persistence ──────────────────────────────────────────

/**
 * Record a config file change in the admin_audit_log table.
 * Called by middleware after any config mutation.
 */
export async function logConfigChange(
  configFile: string,
  changedBy: string | null,
  before: unknown | null,
  after: unknown
): Promise<void> {
  try {
    const previousHash = before !== null && before !== undefined
      ? computeConfigHash(before)
      : null;
    const newHash = computeConfigHash(after);
    const diffSummary = generateUnifiedDiff(before, after, configFile);

    await db.insert(adminAuditLog).values({
      configFile,
      changedBy,
      previousHash,
      newHash,
      diffSummary,
    });

    logger.info('Config change logged', {
      configFile,
      changedBy,
      previousHash: previousHash?.substring(0, 8) ?? 'null',
      newHash: newHash.substring(0, 8),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to log config change', { configFile, error: message });
  }
}

// ─── Audit Log Queries ──────────────────────────────────────────────

export interface AuditLogQueryResult {
  id: number;
  configFile: string;
  changedBy: string | null;
  previousHash: string | null;
  newHash: string;
  diffSummary: string;
  timestamp: Date;
}

/**
 * Retrieve recent audit log entries, optionally filtered by config file.
 * Returns at least 20 entries per the US-257 acceptance criteria.
 */
export async function getAuditLog(
  configFile?: string,
  limit: number = 50
): Promise<AuditLogQueryResult[]> {
  try {
    const effectiveLimit = Math.max(limit, 20); // Ensure minimum 20 per AC
    if (configFile) {
      return await db
        .select()
        .from(adminAuditLog)
        .where(eq(adminAuditLog.configFile, configFile))
        .orderBy(desc(adminAuditLog.timestamp))
        .limit(effectiveLimit);
    }
    return await db
      .select()
      .from(adminAuditLog)
      .orderBy(desc(adminAuditLog.timestamp))
      .limit(effectiveLimit);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to query audit log', { error: message });
    return [];
  }
}
