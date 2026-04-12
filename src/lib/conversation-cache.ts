/**
 * Conversation Query Cache (US-526)
 *
 * Caches LLM classification results by SHA256(conversation_id + normalized_query)
 * with a configurable TTL (default: 300s). Reduces redundant LLM API calls
 * for repeated identical queries within the same conversation.
 *
 * Implementation: In-memory Map with timestamp-based TTL eviction.
 * (Redis upgrade path: swap Map operations for ioredis get/setex calls)
 */

import { createHash } from 'crypto';
import type { ClassificationResult } from '../assistant/pipeline/stages/tier-classification.js';

export const CONVERSATION_CACHE_TTL_SECONDS = 300;

interface CacheEntry {
  value: ClassificationResult;
  expiresAt: number; // epoch ms
}

export class ConversationCache {
  private store = new Map<string, CacheEntry>();

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
   */
  set(key: string, value: ClassificationResult, ttlSeconds: number = CONVERSATION_CACHE_TTL_SECONDS): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  /**
   * Remove a specific cache entry (e.g. on conversation reset).
   */
  invalidate(key: string): void {
    this.store.delete(key);
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
