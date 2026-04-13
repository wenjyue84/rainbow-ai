/**
 * Keyword Match Cache (US-533)
 *
 * LRU cache for T2 fuzzy keyword intent classification results.
 * Caches phrase → {intent, confidence} mappings to avoid redundant
 * string similarity computations for repeated or similar inputs.
 *
 * Policy: LRU eviction at capacity (max 100 entries), 5-minute TTL per entry.
 * Cache is invalidated globally when keyword configs change (profile reload).
 */

export interface KeywordMatchCacheEntry {
  intent: string;
  confidence: number;
  matchedKeyword?: string;
}

const DEFAULT_MAX_SIZE = 100;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface StoredEntry {
  value: KeywordMatchCacheEntry;
  expiresAt: number;
}

export class KeywordMatchCache {
  private store = new Map<string, StoredEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number = DEFAULT_MAX_SIZE, ttlMs: number = DEFAULT_TTL_MS) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Normalize a phrase for use as a cache key.
   * Lowercases, trims, and collapses whitespace.
   */
  normalizeKey(phrase: string): string {
    return phrase.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Look up a cached match result for a phrase.
   * Returns null on miss or TTL expiry. Moves hit entry to MRU position.
   */
  get(phrase: string): KeywordMatchCacheEntry | null {
    const key = this.normalizeKey(phrase);
    const entry = this.store.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // Move to MRU position (delete + re-insert, Map preserves insertion order)
    this.store.delete(key);
    this.store.set(key, entry);

    return entry.value;
  }

  /**
   * Store a match result for a phrase.
   * Evicts LRU entry when at capacity, then inserts at MRU position.
   */
  set(phrase: string, value: KeywordMatchCacheEntry): void {
    const key = this.normalizeKey(phrase);

    // Remove existing entry to allow re-insertion at MRU position
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      // Evict LRU entry (first key in insertion-ordered Map)
      const lruKey = this.store.keys().next().value;
      if (lruKey !== undefined) {
        this.store.delete(lruKey);
      }
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Invalidate all cached entries. Call when keyword configs change.
   */
  invalidateAll(): void {
    this.store.clear();
  }

  /**
   * Purge TTL-expired entries without evicting live ones.
   */
  evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  /** Number of live (non-expired) entries. For metrics/testing. */
  size(): number {
    this.evictExpired();
    return this.store.size;
  }
}

/** Singleton shared across all T2 fuzzy match calls. */
export const keywordMatchCache = new KeywordMatchCache();
