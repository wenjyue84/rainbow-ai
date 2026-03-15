/**
 * webhook-dedup.ts — Webhook event deduplication (US-977)
 *
 * Prevents double-processing of WhatsApp Cloud API webhook events when Meta
 * retries delivery under network failure conditions.
 *
 * Strategy:
 *  - Incoming messages: deduplicate by wamid (messages[].id)
 *  - Status updates:    deduplicate by wamid + status pair
 *
 * Storage: in-memory Map with TTL eviction (300 seconds / 5 minutes).
 * No external dependencies — TTL is enforced lazily on each check.
 */

const DEDUP_TTL_MS = 300_000; // 5 minutes

// ─── Cache ───────────────────────────────────────────────────────────────────

interface CacheEntry {
  expiresAt: number;
}

/** Keyed by wamid (messages) or wamid:status (status updates) */
const dedupCache = new Map<string, CacheEntry>();

/** Running count of cache hits (duplicate events dropped) */
let dedupHitCount = 0;

// ─── Periodic cleanup ────────────────────────────────────────────────────────
// Evict expired entries every 5 minutes to keep memory bounded.
// The interval is unref'd so it does not prevent process exit.

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of dedupCache) {
    if (entry.expiresAt <= now) {
      dedupCache.delete(key);
    }
  }
}, DEDUP_TTL_MS);

// Allow Node to exit even if this interval is still pending
if (cleanupInterval.unref) cleanupInterval.unref();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether a message wamid has already been seen.
 *
 * Returns `true`  if this is a DUPLICATE — caller should drop the event.
 * Returns `false` if this is the first occurrence — caller should process it.
 */
export function isDuplicateMessage(wamid: string): boolean {
  return checkAndRecord(`msg:${wamid}`);
}

/**
 * Check whether a status update (wamid + status) has already been seen.
 *
 * Returns `true`  if DUPLICATE.
 * Returns `false` if first occurrence.
 */
export function isDuplicateStatus(wamid: string, status: string): boolean {
  return checkAndRecord(`status:${wamid}:${status}`);
}

/**
 * Returns current dedup hit count and cache size for monitoring.
 * Suitable for exposing via an admin metrics endpoint.
 */
export function getDedupStats(): { dedupHits: number; cacheSize: number } {
  return { dedupHits: dedupHitCount, cacheSize: dedupCache.size };
}

/**
 * Reset dedup hit counter. Useful for testing and period-based dashboards.
 */
export function resetDedupHitCount(): void {
  dedupHitCount = 0;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function checkAndRecord(key: string): boolean {
  const now = Date.now();
  const existing = dedupCache.get(key);

  if (existing && existing.expiresAt > now) {
    // Cache hit — this is a duplicate
    dedupHitCount++;
    return true;
  }

  // First occurrence — record with TTL and return false
  dedupCache.set(key, { expiresAt: now + DEDUP_TTL_MS });
  return false;
}
