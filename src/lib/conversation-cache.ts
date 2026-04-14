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

// ─────────────────────────────────────────────────────────────────────────────
// MessageLRUCache for conversation message storage (US-601)
// ─────────────────────────────────────────────────────────────────────────────

export interface CachedConversationMessage {
  id: string;
  phone: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  [key: string]: any;
}

interface MessageCacheEntry {
  messages: CachedConversationMessage[];
  expiresAt: number;
}

/**
 * LRU (Least Recently Used) cache for conversation messages.
 *
 * Reduces database queries for repeated message retrievals with automatic
 * TTL-based eviction and capacity management.
 *
 * - Max capacity: 1000 conversations
 * - TTL: 5 minutes (300,000 ms)
 * - Entry key: "{phone}|{profileId}" for profile isolation
 */
export class MessageLRUCache {
  private cache: Map<string, MessageCacheEntry> = new Map();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 1000, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Build cache key from phone and profileId.
   * Format: "{phone}|{profileId}" for profile isolation.
   */
  private buildKey(phone: string, profileId: string): string {
    return `${phone}|${profileId}`;
  }

  /**
   * Get cached messages for a conversation.
   * Returns null if not found or expired (TTL exceeded).
   * Moves accessed entry to end (most recently used) for LRU tracking.
   */
  get(phone: string, profileId: string): CachedConversationMessage[] | null {
    const key = this.buildKey(phone, profileId);
    const entry = this.cache.get(key);

    if (!entry) return null;

    const now = Date.now();
    const age = now - entry.expiresAt + this.ttlMs; // Calculate age from expiration time

    // Check if entry has expired
    if (age > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used) for LRU tracking
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.messages;
  }

  /**
   * Set/update cached messages for a conversation.
   * Evicts least recently used entry if cache is at capacity.
   *
   * @param phone - Canonical phone key identifying the conversation
   * @param profileId - Profile ID that owns this conversation
   * @param messages - Message array to cache
   */
  set(phone: string, profileId: string, messages: CachedConversationMessage[]): void {
    const key = this.buildKey(phone, profileId);

    // Remove old entry if exists (to move it to end)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // If at capacity, evict LRU (first entry = oldest)
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    // Add new entry at end (most recently used)
    this.cache.set(key, {
      messages,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Invalidate cache entry for a specific conversation.
   * Called when a new message is added to invalidate stale cached state.
   *
   * @param phone - Canonical phone key
   * @param profileId - Profile ID
   */
  invalidate(phone: string, profileId: string): void {
    const key = this.buildKey(phone, profileId);
    this.cache.delete(key);
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size (number of entries).
   * Useful for testing and monitoring.
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Evict expired entries from cache.
   * Should be called periodically to maintain memory efficiency.
   */
  evictExpired(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }
}

/** Singleton instance for message caching. */
export const messageLRUCache = new MessageLRUCache();
