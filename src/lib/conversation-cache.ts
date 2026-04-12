/**
 * Conversation Query Cache (US-526)
 *
 * Redis-backed cache for LLM classification results, keyed by
 * SHA256(conversation_id + normalized_query) with 300s TTL.
 *
 * Architecture: L1 in-memory Map (sync, <10ms reads) + L2 Redis (async writes).
 * The in-memory layer is always checked first; Redis receives background writes
 * for cross-restart durability and optional multi-instance sharing.
 * All public methods remain synchronous — Redis is fire-and-forget.
 */

import { createHash } from 'crypto';
import type Redis from 'ioredis';
import type { ClassificationResult } from '../assistant/pipeline/stages/tier-classification.js';

export const CONVERSATION_CACHE_TTL_SECONDS = 300;

const REDIS_KEY_PREFIX = 'conv:query:';

interface CacheEntry {
  value: ClassificationResult;
  expiresAt: number; // epoch ms
}

export class ConversationCache {
  private store = new Map<string, CacheEntry>();
  private _redis: Redis | null = null;

  /**
   * Attach a Redis client for background durability writes.
   * In-memory cache remains the primary read path (sync, <10ms).
   */
  attachRedis(client: Redis): void {
    this._redis = client;
  }

  /**
   * Build a SHA256 cache key from conversation ID and normalized query.
   * Query is lowercased + whitespace-collapsed before hashing.
   */
  cacheKey(conversationId: string, query: string): string {
    const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, ' ');
    return createHash('sha256')
      .update(`${conversationId}:${normalizedQuery}`)
      .digest('hex');
  }

  /**
   * Retrieve a cached result. Returns null on miss or if TTL has expired.
   * Always reads from the in-memory L1 cache (sync, no Redis I/O).
   */
  get(key: string): ClassificationResult | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  /**
   * Store a result with the given TTL in seconds.
   * Writes synchronously to memory and asynchronously to Redis (fire-and-forget).
   */
  set(key: string, value: ClassificationResult, ttlSeconds: number = CONVERSATION_CACHE_TTL_SECONDS): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    // Background Redis write — errors are silently swallowed to avoid breaking callers
    if (this._redis) {
      this._redis
        .set(`${REDIS_KEY_PREFIX}${key}`, JSON.stringify(value), 'EX', ttlSeconds)
        .catch(() => {});
    }
  }

  /**
   * Remove a specific cache entry (e.g. on conversation reset).
   * Removes from memory synchronously and fires async Redis delete.
   */
  invalidate(key: string): void {
    this.store.delete(key);
    if (this._redis) {
      this._redis.del(`${REDIS_KEY_PREFIX}${key}`).catch(() => {});
    }
  }

  /**
   * Purge all entries whose TTL has elapsed.
   * Called periodically to prevent unbounded memory growth.
   */
  evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  /** Current number of live (non-expired) entries. For metrics/testing only. */
  size(): number {
    this.evictExpired();
    return this.store.size;
  }
}

/** Singleton instance shared across the process. */
export const conversationCache = new ConversationCache();

/**
 * Initialize the singleton with a Redis client for background durability.
 * Call this during server startup after Redis connection is confirmed.
 */
export function initConversationCache(redis: Redis): void {
  conversationCache.attachRedis(redis);
}
