/**
 * kb-integrity.ts — OWASP LLM04 Knowledge Base Integrity Pipeline
 *
 * US-965: Validates KB documents on ingest via:
 *   1. SHA-256 content hashing (detects tampering / unexpected changes)
 *   2. Source authentication (allowlisted paths only)
 *   3. Audit logging of all ingest events
 *
 * All functions are designed to fail-open — integrity checks enhance
 * security but must not break the ingestion pipeline if DB is unavailable.
 */

import { createHash } from 'crypto';
import { resolve, normalize } from 'path';
import {
  saveKBFileWithHash,
  approveKBFile,
  auditKBEvent,
  getUnapprovedKBFiles,
} from '../lib/config-db.js';

// ─── Configuration ─────────────────────────────────────────────────────

/** Allowed local filesystem paths for KB ingestion (resolved at init) */
const ALLOWED_LOCAL_PATHS: string[] = [];

/** Allowed S3 prefixes for KB ingestion */
const ALLOWED_S3_PREFIXES: string[] = [];

/**
 * Initialize allowed source paths.
 * Called once at startup with the KB directories used by the system.
 */
export function initAllowedSources(
  localPaths: string[],
  s3Prefixes: string[] = []
): void {
  ALLOWED_LOCAL_PATHS.length = 0;
  ALLOWED_S3_PREFIXES.length = 0;
  for (const p of localPaths) {
    ALLOWED_LOCAL_PATHS.push(normalize(resolve(p)));
  }
  for (const prefix of s3Prefixes) {
    ALLOWED_S3_PREFIXES.push(prefix);
  }
  console.log(
    `[KB:Integrity] Allowed sources: ${ALLOWED_LOCAL_PATHS.length} local paths, ${ALLOWED_S3_PREFIXES.length} S3 prefixes`
  );
}

// ─── SHA-256 Hashing ───────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of file content.
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

// ─── Source Verification ───────────────────────────────────────────────

/**
 * Validate that a file source is from an allowed location.
 *
 * @param source - Either a local filesystem path or an S3 URI
 * @returns { valid, reason } — reason is populated on rejection
 */
export function validateSource(source: string): { valid: boolean; reason?: string } {
  // S3 source
  if (source.startsWith('s3://')) {
    if (ALLOWED_S3_PREFIXES.length === 0) {
      return { valid: false, reason: 'No S3 prefixes configured in allowlist' };
    }
    const allowed = ALLOWED_S3_PREFIXES.some(prefix => source.startsWith(prefix));
    return allowed
      ? { valid: true }
      : { valid: false, reason: `S3 source ${source} not in allowlist: ${ALLOWED_S3_PREFIXES.join(', ')}` };
  }

  // Local filesystem source
  if (ALLOWED_LOCAL_PATHS.length === 0) {
    return { valid: false, reason: 'No local paths configured in allowlist' };
  }
  const normalizedSource = normalize(resolve(source));
  const allowed = ALLOWED_LOCAL_PATHS.some(allowedPath =>
    normalizedSource.startsWith(allowedPath)
  );
  return allowed
    ? { valid: true }
    : { valid: false, reason: `Local path ${normalizedSource} not in allowlist` };
}

// ─── Integrity-Checked Ingestion ───────────────────────────────────────

export interface IngestResult {
  filename: string;
  accepted: boolean;
  hash: string;
  reason?: string;
}

/**
 * Ingest a KB file with full integrity validation:
 *   1. Verify source is allowlisted
 *   2. Compute SHA-256 hash
 *   3. Store with hash; reject if hash changed without approval
 *   4. Audit the event
 *
 * @param filename - KB filename (e.g., 'faq.md')
 * @param content - File content
 * @param sourcePath - Where the file came from (local path or S3 URI)
 * @param lastModifiedAt - File's last-modified timestamp
 * @param operator - Who initiated the ingest (default: 'system')
 */
export async function ingestKBFile(
  filename: string,
  content: string,
  sourcePath: string,
  lastModifiedAt?: Date,
  operator: string = 'system'
): Promise<IngestResult> {
  const hash = computeContentHash(content);

  // Step 1: Verify source
  const sourceCheck = validateSource(sourcePath);
  if (!sourceCheck.valid) {
    console.warn(`[KB:Integrity] Rejected ${filename}: ${sourceCheck.reason}`);
    await auditKBEvent('source_rejected', filename, hash, operator, sourceCheck.reason);
    return { filename, accepted: false, hash, reason: sourceCheck.reason };
  }

  // Step 2: Save with hash verification
  const result = await saveKBFileWithHash(
    filename,
    content,
    hash,
    'local',
    lastModifiedAt,
    operator
  );

  if (!result.accepted) {
    console.warn(`[KB:Integrity] ${filename} requires approval: ${result.reason}`);
  }

  return { filename, accepted: result.accepted, hash, reason: result.reason };
}

/**
 * Approve a KB file that was rejected due to hash change.
 */
export async function approveKBFileChange(
  filename: string,
  content: string,
  operator: string
): Promise<boolean> {
  const hash = computeContentHash(content);
  return approveKBFile(filename, content, hash, operator);
}

/**
 * Get all KB files pending operator approval.
 */
export { getUnapprovedKBFiles };
