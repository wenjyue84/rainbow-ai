/**
 * Opt-out / STOP command handling (US-403)
 *
 * Manages WhatsApp opt-out compliance: users can send STOP to unsubscribe,
 * START to re-subscribe. Persisted to DB, with in-memory cache for fast lookups.
 */
import { db } from '../lib/db.js';
import { optOuts } from '../../shared/schema.js';
import { eq, sql, desc } from 'drizzle-orm';
import { trackOptOutEvent } from '../lib/quality-metrics.js';

// ─── In-memory cache for fast opt-out lookups ────────────────────────
const optOutCache = new Set<string>();
let cacheLoaded = false;

// ─── Opt-out trigger words (case-insensitive) ────────────────────────
const OPT_OUT_WORDS = ['stop', 'berhenti', '停止', 'unsubscribe', 'opt out'];
const OPT_IN_WORDS = ['start', 'mula', '开始', 'subscribe'];

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
    await db.insert(optOuts)
      .values({ phone })
      .onConflictDoUpdate({
        target: optOuts.phone,
        set: { optedOutAt: new Date(), optedInAt: null },
      });
    optOutCache.add(phone);
    trackOptOutEvent(); // US-431: count opt-out for quality metrics
    console.log(`[OptOut] Phone ${phone} opted out`);
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

/** Get paginated list of opted-out phones (for admin API) */
export async function getOptOutList(page: number = 1, limit: number = 50): Promise<{
  data: Array<{ phone: string; optedOutAt: Date | null }>;
  total: number;
  page: number;
  limit: number;
}> {
  const offset = (page - 1) * limit;

  const [rows, countResult] = await Promise.all([
    db.select({
      phone: optOuts.phone,
      optedOutAt: optOuts.optedOutAt,
    })
      .from(optOuts)
      .orderBy(desc(optOuts.optedOutAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(optOuts),
  ]);

  return {
    data: rows,
    total: countResult[0]?.count ?? 0,
    page,
    limit,
  };
}
