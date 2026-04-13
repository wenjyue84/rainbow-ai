/**
 * Message Deduplication Cache Tests (US-559)
 *
 * Tests for LRU cache with per-profile message deduplication.
 * Verifies:
 * - Identical message + intent returns cached response without re-classification
 * - LRU eviction when cache reaches max capacity (500 entries)
 * - TTL expiry after 300 seconds
 * - Cache hit/miss rate tracking
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageDeduplicationCache } from './message-dedup-cache.js';

describe('MessageDeduplicationCache', () => {
  let cache: MessageDeduplicationCache;

  beforeEach(() => {
    cache = new MessageDeduplicationCache(500, 5 * 60 * 1000); // 500 entries, 5 min TTL
    cache.resetStats();
  });

  // ─── Test 1: Identical message returns cached response twice in a row ─────────

  it('should return cached response on second identical request', () => {
    const messageText = 'I want to book a room';
    const intentName = 'booking';
    const profileName = 'pelangi';
    const response = 'What dates would you like to check in?';

    // First request: miss, cache the response
    const entry1 = cache.get(messageText, intentName, profileName);
    expect(entry1).toBeNull();
    expect(cache.getStats().misses).toBe(1);

    cache.set(messageText, intentName, profileName, {
      response,
      intent: intentName,
      timestamp: Date.now(),
    });

    // Second request: hit, return cached response
    const entry2 = cache.get(messageText, intentName, profileName);
    expect(entry2).not.toBeNull();
    expect(entry2?.response).toBe(response);
    expect(entry2?.intent).toBe(intentName);
    expect(cache.getStats().hits).toBe(1);
  });

  // ─── Test 2: Different profiles have separate cache entries ──────────────────

  it('should maintain separate caches for different profiles', () => {
    const messageText = 'hello';
    const intentName = 'greeting';

    cache.set(messageText, intentName, 'pelangi', {
      response: 'Welcome to Pelangi!',
      intent: intentName,
      timestamp: Date.now(),
    });

    cache.set(messageText, intentName, 'southern', {
      response: 'Welcome to Southern!',
      intent: intentName,
      timestamp: Date.now(),
    });

    const pelangiEntry = cache.get(messageText, intentName, 'pelangi');
    const southernEntry = cache.get(messageText, intentName, 'southern');

    expect(pelangiEntry?.response).toBe('Welcome to Pelangi!');
    expect(southernEntry?.response).toBe('Welcome to Southern!');
  });

  // ─── Test 3: Cache evicts LRU entry when at max capacity ────────────────────

  it('should evict LRU entry when cache reaches max capacity', () => {
    const smallCache = new MessageDeduplicationCache(3, 5 * 60 * 1000); // Small cache for testing

    // Add 3 entries (at capacity)
    smallCache.set('message1', 'intent1', 'profile', { response: 'response1', intent: 'intent1', timestamp: Date.now() });
    smallCache.set('message2', 'intent2', 'profile', { response: 'response2', intent: 'intent2', timestamp: Date.now() });
    smallCache.set('message3', 'intent3', 'profile', { response: 'response3', intent: 'intent3', timestamp: Date.now() });

    expect(smallCache.size()).toBe(3);

    // Add 4th entry, should evict LRU (message1)
    smallCache.set('message4', 'intent4', 'profile', { response: 'response4', intent: 'intent4', timestamp: Date.now() });

    expect(smallCache.size()).toBe(3); // Still at capacity
    expect(smallCache.get('message1', 'intent1', 'profile')).toBeNull(); // LRU evicted
    expect(smallCache.get('message4', 'intent4', 'profile')).not.toBeNull(); // New entry present
  });

  // ─── Test 4: Accessing entry moves it to MRU position ──────────────────────────

  it('should move accessed entry to MRU position for LRU tracking', () => {
    const smallCache = new MessageDeduplicationCache(3, 5 * 60 * 1000);

    smallCache.set('msg1', 'intent1', 'profile', { response: 'r1', intent: 'intent1', timestamp: Date.now() });
    smallCache.set('msg2', 'intent2', 'profile', { response: 'r2', intent: 'intent2', timestamp: Date.now() });
    smallCache.set('msg3', 'intent3', 'profile', { response: 'r3', intent: 'intent3', timestamp: Date.now() });

    // Access msg1, moving it to MRU
    smallCache.get('msg1', 'intent1', 'profile');

    // Add new entry, should evict msg2 (now LRU), not msg1
    smallCache.set('msg4', 'intent4', 'profile', { response: 'r4', intent: 'intent4', timestamp: Date.now() });

    expect(smallCache.get('msg1', 'intent1', 'profile')).not.toBeNull(); // msg1 still in cache
    expect(smallCache.get('msg2', 'intent2', 'profile')).toBeNull(); // msg2 evicted
    expect(smallCache.get('msg4', 'intent4', 'profile')).not.toBeNull();
  });

  // ─── Test 5: Cache tracks hit rate correctly ────────────────────────────────

  it('should track cache hit rate correctly', () => {
    const messageText = 'test message';
    const intentName = 'test_intent';
    const profileName = 'profile';

    // Generate some hits and misses
    cache.get(messageText, intentName, profileName); // miss
    cache.get('different', intentName, profileName); // miss

    cache.set(messageText, intentName, profileName, {
      response: 'cached',
      intent: intentName,
      timestamp: Date.now(),
    });

    cache.get(messageText, intentName, profileName); // hit
    cache.get(messageText, intentName, profileName); // hit
    cache.get(messageText, intentName, 'different-profile'); // miss

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(3);
    expect(stats.hitRate).toBeCloseTo(40, 1); // 2 hits out of 5 = 40%
  });

  // ─── Test 6: Cache respects TTL and expires entries ────────────────────────

  it('should expire entries after TTL', async () => {
    const shortTtlCache = new MessageDeduplicationCache(100, 100); // 100ms TTL

    const messageText = 'test';
    const intentName = 'test_intent';
    const profileName = 'profile';

    shortTtlCache.set(messageText, intentName, profileName, {
      response: 'response',
      intent: intentName,
      timestamp: Date.now(),
    });

    // Should be in cache immediately
    expect(shortTtlCache.get(messageText, intentName, profileName)).not.toBeNull();

    // Wait for TTL to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should be expired now
    expect(shortTtlCache.get(messageText, intentName, profileName)).toBeNull();
  });

  // ─── Test 7: Get stats returns accurate cache information ──────────────────────

  it('should return accurate cache statistics', () => {
    cache.set('msg1', 'intent1', 'profile', { response: 'r1', intent: 'intent1', timestamp: Date.now() });
    cache.set('msg2', 'intent2', 'profile', { response: 'r2', intent: 'intent2', timestamp: Date.now() });

    cache.get('msg1', 'intent1', 'profile'); // hit
    cache.get('msg1', 'intent1', 'profile'); // hit
    cache.get('msg3', 'intent3', 'profile'); // miss

    const stats = cache.getStats();
    expect(stats.entries).toBe(2);
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.maxEntries).toBe(500);
    expect(stats.hitRate).toBeCloseTo(66.67, 1); // 2/3
  });

  // ─── Test 8: Cache key normalization handles different text variations ────────

  it('should have consistent cache keys for normalized text', () => {
    const intentName = 'booking';
    const profileName = 'pelangi';

    // Same meaning, different whitespace and case
    const msg1 = 'I   WANT   to  book  A  room';
    const msg2 = 'i want to book a room';

    cache.set(msg1, intentName, profileName, {
      response: 'Welcome!',
      intent: intentName,
      timestamp: Date.now(),
    });

    // Should retrieve the same cached entry (normalized keys match)
    const cached = cache.get(msg2, intentName, profileName);
    expect(cached?.response).toBe('Welcome!');
  });

  // ─── Test 9: Can invalidate all cache entries ──────────────────────────────────

  it('should invalidate all cache entries on invalidateAll()', () => {
    cache.set('msg1', 'intent1', 'profile', { response: 'r1', intent: 'intent1', timestamp: Date.now() });
    cache.set('msg2', 'intent2', 'profile', { response: 'r2', intent: 'intent2', timestamp: Date.now() });

    expect(cache.size()).toBe(2);

    cache.invalidateAll();

    expect(cache.size()).toBe(0);
    expect(cache.get('msg1', 'intent1', 'profile')).toBeNull();
    expect(cache.get('msg2', 'intent2', 'profile')).toBeNull();
  });

  // ─── Test 10: Handles unknown intent without caching (optional) ───────────────

  it('should handle all intent types', () => {
    const messageText = 'unclear';
    const profileName = 'profile';

    // Test with 'unknown' intent
    cache.set(messageText, 'unknown', profileName, {
      response: 'I did not understand',
      intent: 'unknown',
      timestamp: Date.now(),
    });

    const result = cache.get(messageText, 'unknown', profileName);
    expect(result?.response).toBe('I did not understand');
  });

  // ─── Test 11: Cache hit rate is 0 when no operations ────────────────────────────

  it('should return 0% hit rate when no operations performed', () => {
    const stats = cache.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.hitRate).toBe(0);
  });

  // ─── Test 12: Singleton instance exists and is reusable ──────────────────────────

  it('should have a singleton instance', async () => {
    const { messageDeduplicationCache: singleton } = await import('./message-dedup-cache.js');
    expect(singleton).toBeDefined();
    expect(singleton instanceof MessageDeduplicationCache).toBe(true);
  });
});
