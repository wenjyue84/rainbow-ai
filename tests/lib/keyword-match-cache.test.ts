/**
 * Tests for KeywordMatchCache (US-533)
 *
 * Verifies:
 * - Repeated phrases return cached results (no recomputation)
 * - LRU eviction removes oldest entry when capacity is exceeded
 * - TTL expiration removes stale entries
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { KeywordMatchCache } from '../../src/lib/keyword-match-cache.js';

describe('KeywordMatchCache', () => {
  let cache: KeywordMatchCache;

  beforeEach(() => {
    cache = new KeywordMatchCache(3, 5 * 60 * 1000); // max 3 entries, 5-min TTL
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic get/set', () => {
    it('returns null on cache miss', () => {
      expect(cache.get('book a room')).toBeNull();
    });

    it('returns cached result on hit', () => {
      cache.set('book a room', { intent: 'booking', confidence: 0.92, matchedKeyword: 'book' });
      const result = cache.get('book a room');
      expect(result).toEqual({ intent: 'booking', confidence: 0.92, matchedKeyword: 'book' });
    });

    it('normalizes phrase key (case-insensitive, whitespace-collapsed)', () => {
      cache.set('  Book  A  Room  ', { intent: 'booking', confidence: 0.92 });
      expect(cache.get('book a room')).not.toBeNull();
      expect(cache.get('BOOK A ROOM')).not.toBeNull();
    });

    it('repeated phrases return the same cached result', () => {
      const entry = { intent: 'inquiry', confidence: 0.88, matchedKeyword: 'check' };
      cache.set('check in time', entry);

      const first = cache.get('check in time');
      const second = cache.get('check in time');
      const third = cache.get('check in time');

      expect(first).toEqual(entry);
      expect(second).toEqual(entry);
      expect(third).toEqual(entry);
    });

    it('returns null for different phrases', () => {
      cache.set('book a room', { intent: 'booking', confidence: 0.92 });
      expect(cache.get('check out time')).toBeNull();
    });
  });

  describe('TTL expiration', () => {
    it('returns null after TTL expires', () => {
      const shortCache = new KeywordMatchCache(10, 1000); // 1-second TTL
      shortCache.set('price', { intent: 'inquiry', confidence: 0.85 });

      expect(shortCache.get('price')).not.toBeNull();

      vi.advanceTimersByTime(1001); // Advance past TTL

      expect(shortCache.get('price')).toBeNull();
    });

    it('returns cached result before TTL expires', () => {
      const shortCache = new KeywordMatchCache(10, 5000); // 5-second TTL
      shortCache.set('price', { intent: 'inquiry', confidence: 0.85 });

      vi.advanceTimersByTime(4999); // Just before TTL

      expect(shortCache.get('price')).not.toBeNull();
    });

    it('removes stale entries via evictExpired', () => {
      const shortCache = new KeywordMatchCache(10, 500); // 500ms TTL
      shortCache.set('entry1', { intent: 'booking', confidence: 0.9 });
      shortCache.set('entry2', { intent: 'inquiry', confidence: 0.8 });

      vi.advanceTimersByTime(501);

      shortCache.evictExpired();
      expect(shortCache.size()).toBe(0);
    });

    it('size() excludes expired entries', () => {
      const shortCache = new KeywordMatchCache(10, 500);
      shortCache.set('a', { intent: 'booking', confidence: 0.9 });
      shortCache.set('b', { intent: 'inquiry', confidence: 0.8 });

      expect(shortCache.size()).toBe(2);

      vi.advanceTimersByTime(501);

      expect(shortCache.size()).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entry when capacity is exceeded', () => {
      // Fill cache to capacity (max 3)
      cache.set('phrase1', { intent: 'booking', confidence: 0.9 });
      cache.set('phrase2', { intent: 'inquiry', confidence: 0.8 });
      cache.set('phrase3', { intent: 'checkout', confidence: 0.7 });

      expect(cache.size()).toBe(3);

      // Insert 4th entry — should evict phrase1 (LRU)
      cache.set('phrase4', { intent: 'complaint', confidence: 0.6 });

      expect(cache.size()).toBe(3);
      expect(cache.get('phrase1')).toBeNull(); // Evicted
      expect(cache.get('phrase2')).not.toBeNull();
      expect(cache.get('phrase3')).not.toBeNull();
      expect(cache.get('phrase4')).not.toBeNull();
    });

    it('accessing an entry moves it to MRU position', () => {
      // Fill cache to capacity
      cache.set('phrase1', { intent: 'booking', confidence: 0.9 });
      cache.set('phrase2', { intent: 'inquiry', confidence: 0.8 });
      cache.set('phrase3', { intent: 'checkout', confidence: 0.7 });

      // Access phrase1 — makes it MRU; phrase2 becomes LRU
      cache.get('phrase1');

      // Insert phrase4 — should evict phrase2 (now LRU)
      cache.set('phrase4', { intent: 'complaint', confidence: 0.6 });

      expect(cache.get('phrase2')).toBeNull(); // Evicted (was LRU after phrase1 accessed)
      expect(cache.get('phrase1')).not.toBeNull(); // Still present (was MRU)
      expect(cache.get('phrase3')).not.toBeNull();
      expect(cache.get('phrase4')).not.toBeNull();
    });

    it('updating an existing entry moves it to MRU', () => {
      cache.set('phrase1', { intent: 'booking', confidence: 0.9 });
      cache.set('phrase2', { intent: 'inquiry', confidence: 0.8 });
      cache.set('phrase3', { intent: 'checkout', confidence: 0.7 });

      // Re-set phrase1 — moves it to MRU; phrase2 becomes LRU
      cache.set('phrase1', { intent: 'booking', confidence: 0.95 });

      // Insert phrase4 — should evict phrase2
      cache.set('phrase4', { intent: 'complaint', confidence: 0.6 });

      expect(cache.get('phrase2')).toBeNull(); // Evicted
      expect(cache.get('phrase1')).toEqual({ intent: 'booking', confidence: 0.95 });
    });
  });

  describe('invalidateAll', () => {
    it('clears all cached entries', () => {
      cache.set('phrase1', { intent: 'booking', confidence: 0.9 });
      cache.set('phrase2', { intent: 'inquiry', confidence: 0.8 });

      cache.invalidateAll();

      expect(cache.size()).toBe(0);
      expect(cache.get('phrase1')).toBeNull();
      expect(cache.get('phrase2')).toBeNull();
    });
  });

  describe('default constructor', () => {
    it('accepts max 100 entries with default TTL', () => {
      const defaultCache = new KeywordMatchCache(); // defaults: 100 entries, 5-min TTL
      for (let i = 0; i < 100; i++) {
        defaultCache.set(`phrase${i}`, { intent: 'booking', confidence: 0.9 });
      }
      expect(defaultCache.size()).toBe(100);

      // 101st entry evicts LRU
      defaultCache.set('overflow', { intent: 'inquiry', confidence: 0.8 });
      expect(defaultCache.size()).toBe(100);
      expect(defaultCache.get('phrase0')).toBeNull(); // LRU evicted
    });
  });
});
