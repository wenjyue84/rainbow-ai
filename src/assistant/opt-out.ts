/**
 * Opt-out / STOP command handling (US-403, US-812)
 *
 * Manages WhatsApp opt-out compliance: users can send STOP to unsubscribe,
 * START to re-subscribe. Persisted to DB, with in-memory cache for fast lookups.
 * US-812: Tracks processedAt timestamp for 24-hour compliance verification.
 */
import { db } from '../lib/db.js';
import { pool } from '../lib/db.js';
import { optOuts } from '../../shared/schema.js';
import { eq, sql, desc, isNull } from 'drizzle-orm';
import { trackOptOutEvent } from '../lib/quality-metrics.js';

// US-812: Add processed_at column if it doesn't exist (deferred until pool is available)
let _optOutMigrationDone = false;
function ensureProcessedAtColumn(): void {
  if (_optOutMigrationDone || !pool) return;
  _optOutMigrationDone = true;
  pool.query(`
    ALTER TABLE opt_outs
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ
  `).catch((err: Error) => {
    console.warn('[OptOut] Migration warn (processed_at):', err.message);
  });
}

// ─── In-memory cache for fast opt-out lookups ────────────────────────
const optOutCache = new Set<string>();
let cacheLoaded = false;

// ─── Opt-out trigger words (case-insensitive) ────────────────────────
const OPT_OUT_WORDS = ['stop', 'berhenti', '停止', 'unsubscribe', 'opt out'];
const OPT_IN_WORDS = ['start', 'mula', '开始', 'subscribe'];

// 24-hour compliance window in milliseconds
const COMPLIANCE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isOptOutCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return OPT_OUT_WORDS.includes(normalized);
}

export function isOptInCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return OPT_IN_WORDS.includes(normalized);
}

/** Load all opted-out phones into cache on startup */
export async function loadOptOutCache(): Promise<void> {
  ensureProcessedAtColumn();
  try {
    const rows = await db.select({ phone: optOuts.phone }).from(optOuts);
    optOutCache.clear();
    for (const row of rows) {
      optOutCache.add(row.phone);
    }
    cacheLoaded = true;
    console.log(`[OptOut] Loaded ${optOutCache.size} opted-out numbers`);
  } catch (error) {
    console.error('[OptOut] Failed to load opt-out cache:', error);
    cacheLoaded = true; // Mark loaded even on error to avoid blocking pipeline
  }
}

/** Check if a phone number is opted out (fast, in-memory) */
export function isOptedOut(phone: string): boolean {
  return optOutCache.has(phone);
}

/** Record an opt-out for a phone number */
export async function recordOptOut(phone: string): Promise<void> {
  try {
    const now = new Date();
    await db.insert(optOuts)
      .values({
        phone,
        optedOutAt: now,
        // US-812: processedAt = same timestamp — opt-out is enforced immediately in same cycle
        processedAt: now,
      })
      .onConflictDoUpdate({
        target: optOuts.phone,
        set: { optedOutAt: now, optedInAt: null, processedAt: now },
      });
    optOutCache.add(phone);
    trackOptOutEvent(); // US-431: count opt-out for quality metrics
    console.log(`[OptOut] Phone ${phone} opted out (processedAt: ${now.toISOString()})`);
  } catch (error) {
    console.error('[OptOut] Failed to record opt-out:', error);
    throw error;
  }
}

/** Remove opt-out for a phone number (re-subscribe) */
export async function recordOptIn(phone: string): Promise<void> {
  try {
    await db.delete(optOuts).where(eq(optOuts.phone, phone));
    optOutCache.delete(phone);
    console.log(`[OptOut] Phone ${phone} opted back in`);
  } catch (error) {
    console.error('[OptOut] Failed to record opt-in:', error);
    throw error;
  }
}

/** US-812: Check if an opt-out was processed within the 24-hour compliance window */
export function isCompliantProcessing(optedOutAt: Date | null, processedAt: Date | null): boolean {
  if (!optedOutAt) return true;
  if (!processedAt) return false; // Not yet processed — non-compliant
  return (processedAt.getTime() - optedOutAt.getTime()) <= COMPLIANCE_WINDOW_MS;
}

/** Get paginated list of opted-out phones with compliance status (for admin API) */
export async function getOptOutList(page: number = 1, limit: number = 50): Promise<{
  data: Array<{
    phone: string;
    optedOutAt: Date | null;
    processedAt: Date | null;
    isCompliant: boolean;
    processingDelayMs: number | null;
  }>;
  total: number;
  page: number;
  limit: number;
}> {
  const offset = (page - 1) * limit;

  const [rows, countResult] = await Promise.all([
    db.select({
      phone: optOuts.phone,
      optedOutAt: optOuts.optedOutAt,
      processedAt: optOuts.processedAt,
    })
      .from(optOuts)
      .orderBy(desc(optOuts.optedOutAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(optOuts),
  ]);

  const data = rows.map(row => {
    const compliant = isCompliantProcessing(row.optedOutAt, row.processedAt);
    const delayMs = row.optedOutAt && row.processedAt
      ? row.processedAt.getTime() - row.optedOutAt.getTime()
      : null;
    return {
      phone: row.phone,
      optedOutAt: row.optedOutAt,
      processedAt: row.processedAt,
      isCompliant: compliant,
      processingDelayMs: delayMs,
    };
  });

  return {
    data,
    total: countResult[0]?.count ?? 0,
    page,
    limit,
  };
}

/** US-812: Get compliance summary for the admin warning banner */
export async function getOptOutComplianceSummary(): Promise<{
  totalOptOuts: number;
  nonCompliantCount: number;
  unprocessedCount: number;
  hasComplianceWarning: boolean;
}> {
  const [totalResult, nonCompliantResult, unprocessedResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(optOuts),
    // Non-compliant: processedAt - optedOutAt > 24 hours
    db.select({ count: sql<number>`count(*)::int` })
      .from(optOuts)
      .where(sql`processed_at IS NOT NULL AND (extract(epoch from (processed_at - opted_out_at)) * 1000) > ${COMPLIANCE_WINDOW_MS}`),
    // Unprocessed: processedAt is null
    db.select({ count: sql<number>`count(*)::int` })
      .from(optOuts)
      .where(isNull(optOuts.processedAt)),
  ]);

  const total = totalResult[0]?.count ?? 0;
  const nonCompliant = nonCompliantResult[0]?.count ?? 0;
  const unprocessed = unprocessedResult[0]?.count ?? 0;

  return {
    totalOptOuts: total,
    nonCompliantCount: nonCompliant,
    unprocessedCount: unprocessed,
    hasComplianceWarning: nonCompliant > 0 || unprocessed > 0,
  };
}
