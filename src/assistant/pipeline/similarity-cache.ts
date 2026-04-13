/**
 * Intent Classification Semantic Similarity Cache (US-575)
 *
 * Caches intent classifications for semantically similar messages using embedding-based
 * similarity (cosine distance). Reuses cached intent for matching messages instead of
 * re-classifying, reducing latency and cost for repeated/similar inquiries.
 *
 * Architecture: L1 in-memory Map (sync, <10ms reads) + L2 Redis (async writes).
 * - Embeddings computed once per unique message
 * - Cached in Redis with TTL 4 hours per profile
 * - Similarity threshold 0.95 triggers cache hit
 * - Stores (embedding, intent, confidence) in cache
 */

import { createHash } from 'crypto';
import type Redis from 'ioredis';
import type { ClassificationResult } from './stages/tier-classification.js';
import { getTextEmbedding, cosineSimilarity } from '../context.js';
import { createModuleLogger } from '../../lib/logger.js';

const logger = createModuleLogger('SimilarityCache');

const REDIS_KEY_PREFIX = 'intent:similarity:';
// Threshold 0.75 for character n-gram embeddings (0.95 would require semantic embeddings like OpenAI)
// Note: Character n-grams capture syntactic similarity, not semantic similarity.
// For true semantic similarity (e.g., "check in" vs "arrive"), use embeddings from an embedding model.
const SIMILARITY_THRESHOLD = 0.75;
const CACHE_TTL_SECONDS = 4 * 60 * 60; // 4 hours
const MAX_CACHED_ENTRIES_PER_PROFILE = 50; // Cap entries per profile to avoid unbounded growth

interface CacheEntry {
  embedding: Record<string, number>;
  intent: string;
  confidence: number;
  storedAt: number;
  messageHash: string;
}

interface CacheHit {
  intent: string;
  confidence: number;
  messageHash: string;
  similarity: number;
}

export class SimilarityCache {
  private entries = new Map<string, CacheEntry[]>(); // profileId → entries
  private _redis: Redis | null = null;

  /**
   * Attach a Redis client for background durability writes.
   */
  attachRedis(client: Redis): void {
    this._redis = client;
  }

  /**
   * Build a Redis key for a specific profile's cached entries.
   */
  private redisKey(profileId: string): string {
    return `${REDIS_KEY_PREFIX}${profileId}`;
  }

  /**
   * Compute a hash of the message for tracking.
   */
  private hashMessage(message: string): string {
    return createHash('sha256').update(message).digest('hex').slice(0, 16);
  }

  /**
   * Lookup similar cached intent for a message.
   * Returns cached intent if similarity > SIMILARITY_THRESHOLD, null otherwise.
   *
   * Algorithm:
   * 1. Compute embedding for incoming message
   * 2. Iterate cached embeddings for this profile
   * 3. Compute cosine similarity to each cached embedding
   * 4. Return cached intent if similarity > threshold
   * 5. Evict expired entries (>4 hours old)
   *
   * @param message User message text
   * @param profileId Profile ID for isolation
   * @returns CacheHit if found, null otherwise
   */
  lookup(message: string, profileId: string): CacheHit | null {
    if (!message || message.trim() === '') {
      return null;
    }

    const profileKey = profileId;
    const cachedEntries = this.entries.get(profileKey) ?? [];
    const incomingEmbedding = getTextEmbedding(message);
    const now = Date.now();

    // Evict expired entries
    const validEntries = cachedEntries.filter(e => {
      const ageSeconds = (now - e.storedAt) / 1000;
      return ageSeconds < CACHE_TTL_SECONDS;
    });

    // Update entries with valid entries
    if (validEntries.length < cachedEntries.length) {
      this.entries.set(profileKey, validEntries);
      // Also clear Redis key if all entries expired
      if (validEntries.length === 0 && this._redis) {
        this._redis.del(this.redisKey(profileId)).catch(() => {});
      }
    }

    // Find best match by similarity
    let bestMatch: CacheHit | null = null;
    let bestSimilarity = 0;

    for (const entry of validEntries) {
      const similarity = cosineSimilarity(incomingEmbedding, entry.embedding);

      if (similarity > SIMILARITY_THRESHOLD && similarity > bestSimilarity) {
        bestMatch = {
          intent: entry.intent,
          confidence: entry.confidence,
          messageHash: entry.messageHash,
          similarity,
        };
        bestSimilarity = similarity;
      }
    }

    if (bestMatch) {
      logger.debug('similarity-cache-hit', {
        profileId: profileId.slice(0, 8),
        messageHash: this.hashMessage(message),
        similarity: bestSimilarity.toFixed(3),
        intent: bestMatch.intent,
        confidence: bestMatch.confidence.toFixed(2),
      });
    }

    return bestMatch;
  }

  /**
   * Store a new classification result in cache.
   * Computes embedding for message and stores (embedding, intent, confidence).
   *
   * @param message Original user message
   * @param result Classification result (intent, confidence)
   * @param profileId Profile ID for isolation
   */
  store(message: string, result: ClassificationResult, profileId: string): void {
    if (!message || message.trim() === '') {
      return;
    }

    const embedding = getTextEmbedding(message);
    const profileKey = profileId;
    const messageHash = this.hashMessage(message);

    const entry: CacheEntry = {
      embedding,
      intent: result.intent,
      confidence: result.confidence,
      storedAt: Date.now(),
      messageHash,
    };

    // Add to in-memory entries
    let cachedEntries = this.entries.get(profileKey) ?? [];

    // Avoid duplicate hashes
    cachedEntries = cachedEntries.filter(e => e.messageHash !== messageHash);

    // Cap entries per profile
    if (cachedEntries.length >= MAX_CACHED_ENTRIES_PER_PROFILE) {
      cachedEntries = cachedEntries.slice(-MAX_CACHED_ENTRIES_PER_PROFILE + 1);
    }

    cachedEntries.push(entry);
    this.entries.set(profileKey, cachedEntries);

    // Async Redis write (fire-and-forget)
    if (this._redis) {
      this._redis
        .set(
          this.redisKey(profileId),
          JSON.stringify(cachedEntries),
          'EX',
          CACHE_TTL_SECONDS,
        )
        .catch((err) => {
          logger.debug('similarity-cache-redis-write-error', {
            error: String(err),
            profileId: profileId.slice(0, 8),
          });
        });
    }

    logger.debug('similarity-cache-store', {
      profileId: profileId.slice(0, 8),
      messageHash,
      intent: result.intent,
      confidence: result.confidence.toFixed(2),
      cacheSize: cachedEntries.length,
    });
  }

  /**
   * Invalidate all cached entries for a profile (e.g., on profile reset).
   */
  invalidate(profileId: string): void {
    this.entries.delete(profileId);
    if (this._redis) {
      this._redis.del(this.redisKey(profileId)).catch(() => {});
    }
  }

  /**
   * Purge all entries whose TTL has elapsed.
   * Called periodically to prevent unbounded memory growth.
   */
  evictExpired(): void {
    const now = Date.now();
    for (const [profileId, cacheEntries] of this.entries) {
      const validEntries = cacheEntries.filter(e => {
        const ageSeconds = (now - e.storedAt) / 1000;
        return ageSeconds < CACHE_TTL_SECONDS;
      });

      if (validEntries.length === 0) {
        this.entries.delete(profileId);
      } else if (validEntries.length < cacheEntries.length) {
        this.entries.set(profileId, validEntries);
      }
    }
  }
}

// Singleton instance
export const similarityCache = new SimilarityCache();

/**
 * Initialize the similarity cache with a Redis client.
 * Call during server startup after Redis connection is confirmed.
 */
export function initSimilarityCache(redis: Redis): void {
  similarityCache.attachRedis(redis);
}
