/**
 * Message Deduplication Cache (US-559)
 *
 * Per-profile LRU cache for identical message + intent pairs with 300s TTL.
 * Avoids redundant AI calls for repeated user queries within the same profile.
 *
 * Key: SHA256(message_text + intent_name + profile_name)
 * Max: 500 entries per profile
 * TTL: 300s (5 minutes)
 * Eviction: LRU when at capacity
 *
 * Metrics: Tracks cache hit/miss ratio for telemetry.
 */

import { createHash } from 'crypto';

export interface MessageDeduplicationCacheEntry {
  response: string;
  intent: string;
  timestamp: number;
}

interface StoredEntry {
  value: MessageDeduplicationCacheEntry;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES_PER_PROFILE = 500;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes = 300s

export class MessageDeduplicationCache {
  private store = new Map<string, StoredEntry>();
  private readonly maxEntriesPerProfile: number;
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(maxEntriesPerProfile: number = DEFAULT_MAX_ENTRIES_PER_PROFILE, ttlMs: number = DEFAULT_TTL_MS) {
    this.maxEntriesPerProfile = maxEntriesPerProfile;
    this.ttlMs = ttlMs;
  }

  /**
   * Build a SHA256 cache key from message text, intent name, and profile name.
   * Normalizes: trim, lowercase, and collapse whitespace.
   */
  private cacheKey(messageText: string, intentName: string, profileName: string): string {
    const normalized = `${messageText.trim().toLowerCase().replace(/\s+/g, ' ')}:${intentName.toLowerCase()}:${profileName.toLowerCase()}`;
    return createHash('sha256')
      .update(normalized)
      .digest('hex');
  }

  /**
   * Retrieve a cached response for an identical message + intent pair.
   * Returns null on miss or if TTL has expired.
   * Moves hit entry to MRU position for LRU tracking.
   */
  get(messageText: string, intentName: string, profileName: string): MessageDeduplicationCacheEntry | null {
    const key = this.cacheKey(messageText, intentName, profileName);
    const entry = this.store.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }

    // Move to MRU position (delete + re-insert, Map preserves insertion order)
    this.store.delete(key);
    this.store.set(key, entry);

    this.hits++;
    return entry.value;
  }

  /**
   * Store a response for a message + intent pair.
   * Evicts LRU entry when at capacity, then inserts at MRU position.
   */
  set(
    messageText: string,
    intentName: string,
    profileName: string,
    value: MessageDeduplicationCacheEntry,
  ): void {
    const key = this.cacheKey(messageText, intentName, profileName);

    // Remove existing entry to allow re-insertion at MRU position
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntriesPerProfile) {
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
   * Get cache hit rate as a percentage (0-100).
   */
  getHitRate(): number {
    const total = this.hits + this.misses;
    if (total === 0) return 0;
    return (this.hits / total) * 100;
  }

  /**
   * Get cache statistics for metrics/logging.
   */
  getStats() {
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: this.getHitRate(),
      entries: this.size(),
      maxEntries: this.maxEntriesPerProfile,
    };
  }

  /**
   * Clear all counters (for testing).
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Invalidate all cached entries (e.g. on profile reload).
   */
  invalidateAll(): void {
    this.store.clear();
    this.resetStats();
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

  /**
   * Number of live (non-expired) entries. For metrics/testing.
   */
  size(): number {
    this.evictExpired();
    return this.store.size;
  }
}

/** Singleton instance shared across the process. */
export const messageDeduplicationCache = new MessageDeduplicationCache();
