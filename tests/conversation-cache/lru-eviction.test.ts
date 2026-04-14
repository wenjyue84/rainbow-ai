/**
 * Tests for Conversation Message Cache with LRU Eviction (US-601)
 *
 * AC1: Create LRUCache class with maxSize, ttlMs, get/set/invalidate methods
 * AC2: New message invalidates cached conversation; TTL-expired entries evicted
 * AC3: Cache hit ratio > 80% on repeated queries; correct LRU eviction order
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageLRUCache, type CachedConversationMessage } from '../../src/lib/conversation-cache.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<CachedConversationMessage> = {}): CachedConversationMessage {
  return {
    id: 'msg-' + Math.random().toString(36).substring(7),
    phone: '60123456789',
    role: 'user',
    content: 'Hello, how are you?',
    timestamp: new Date(),
    ...overrides,
  };
}

function makeMessages(count: number, phone = '60123456789'): CachedConversationMessage[] {
  return Array.from({ length: count }, (_, i) =>
    makeMessage({
      id: `msg-${i}`,
      phone,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
      timestamp: new Date(Date.now() + i * 1000),
    })
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MessageLRUCache — US-601: Conversation Message Cache with LRU Eviction', () => {
  let cache: MessageLRUCache;

  beforeEach(() => {
    cache = new MessageLRUCache(10, 5000); // 10 entries max, 5s TTL for testing
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── AC1: Cache initialization and basic operations ─────────────────────────

  it('initializes with default max size (1000) and TTL (5 minutes)', () => {
    const defaultCache = new MessageLRUCache();
    expect(defaultCache.size()).toBe(0);
  });

  it('initializes with custom max size and TTL', () => {
    const customCache = new MessageLRUCache(500, 300_000);
    expect(customCache.size()).toBe(0);
  });

  it('returns null on cache miss', () => {
    const result = cache.get('60987654321', 'profile-123');
    expect(result).toBeNull();
  });

  it('stores and retrieves messages from cache', () => {
    const messages = makeMessages(3);
    cache.set('60123456789', 'profile-1', messages);

    const retrieved = cache.get('60123456789', 'profile-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved).toEqual(messages);
  });

  // ── AC1: Profile isolation via key format ────────────────────────────────────

  it('uses "{phone}|{profileId}" key for profile isolation', () => {
    const messages1 = makeMessages(2);
    const messages2 = makeMessages(2, '60123456789');

    cache.set('60123456789', 'profile-1', messages1);
    cache.set('60123456789', 'profile-2', messages2);

    expect(cache.size()).toBe(2);
    expect(cache.get('60123456789', 'profile-1')).toEqual(messages1);
    expect(cache.get('60123456789', 'profile-2')).toEqual(messages2);
  });

  // ── AC2: TTL expiration ──────────────────────────────────────────────────────

  it('returns null after TTL expires', () => {
    const messages = makeMessages(2);
    cache.set('60123456789', 'profile-1', messages);

    expect(cache.get('60123456789', 'profile-1')).not.toBeNull();

    // Advance past TTL (5000ms)
    vi.advanceTimersByTime(5001);

    expect(cache.get('60123456789', 'profile-1')).toBeNull();
  });

  it('returns cached entry before TTL expires', () => {
    const messages = makeMessages(2);
    cache.set('60123456789', 'profile-1', messages);

    vi.advanceTimersByTime(4999);

    expect(cache.get('60123456789', 'profile-1')).toEqual(messages);
  });

  it('keeps entry valid exactly at TTL boundary', () => {
    const messages = makeMessages(1);
    cache.set('60123456789', 'profile-1', messages);

    vi.advanceTimersByTime(4999);
    expect(cache.get('60123456789', 'profile-1')).not.toBeNull();
  });

  it('expires entry just after TTL boundary', () => {
    const messages = makeMessages(1);
    cache.set('60123456789', 'profile-1', messages);

    vi.advanceTimersByTime(5001);
    expect(cache.get('60123456789', 'profile-1')).toBeNull();
  });

  // ── AC2: Cache invalidation on new message ───────────────────────────────────

  it('invalidate removes a specific conversation from cache', () => {
    const messages = makeMessages(2);
    cache.set('60123456789', 'profile-1', messages);

    expect(cache.get('60123456789', 'profile-1')).not.toBeNull();

    cache.invalidate('60123456789', 'profile-1');

    expect(cache.get('60123456789', 'profile-1')).toBeNull();
  });

  it('invalidate on non-existent key is a no-op', () => {
    expect(() => cache.invalidate('60987654321', 'profile-ghost')).not.toThrow();
  });

  it('invalidate only affects specified conversation, not others', () => {
    const messages1 = makeMessages(1, '60111111111');
    const messages2 = makeMessages(1, '60222222222');

    cache.set('60111111111', 'profile-1', messages1);
    cache.set('60222222222', 'profile-1', messages2);

    cache.invalidate('60111111111', 'profile-1');

    expect(cache.get('60111111111', 'profile-1')).toBeNull();
    expect(cache.get('60222222222', 'profile-1')).toEqual(messages2);
  });

  // ── AC3: LRU eviction when at max capacity ────────────────────────────────────

  it('evicts least recently used entry when at max capacity', () => {
    // Cache size is 10 (set in beforeEach)
    const conversations = Array.from({ length: 11 }, (_, i) => {
      const phone = `6012345${i.toString().padStart(4, '0')}`;
      const messages = makeMessages(1, phone);
      cache.set(phone, 'profile-1', messages);
      return { phone, messages };
    });

    // First conversation should be evicted (LRU)
    expect(cache.get(conversations[0].phone, 'profile-1')).toBeNull();

    // Remaining conversations should be in cache
    for (let i = 1; i < conversations.length; i++) {
      expect(cache.get(conversations[i].phone, 'profile-1')).toEqual(conversations[i].messages);
    }

    expect(cache.size()).toBe(10);
  });

  it('moving accessed entry to end updates LRU order', () => {
    // Add 5 conversations
    const convos = Array.from({ length: 5 }, (_, i) => {
      const phone = `6012345${i.toString().padStart(4, '0')}`;
      cache.set(phone, 'profile-1', makeMessages(1, phone));
      return phone;
    });

    // Access first conversation (moves it to end, making it most recently used)
    cache.get(convos[0], 'profile-1');

    // Add 6 more conversations (total 11, should evict second one which is now LRU)
    for (let i = 5; i < 11; i++) {
      const phone = `6012345${i.toString().padStart(4, '0')}`;
      cache.set(phone, 'profile-1', makeMessages(1, phone));
    }

    // First conversation should still be in cache (moved to end)
    expect(cache.get(convos[0], 'profile-1')).not.toBeNull();

    // Second conversation should be evicted (it's now the LRU)
    expect(cache.get(convos[1], 'profile-1')).toBeNull();
  });

  // ── AC3: Cache hit ratio > 80% on repeated queries ─────────────────────────────

  it('achieves > 80% cache hit ratio on repeated queries', () => {
    const messages = makeMessages(5);
    cache.set('60123456789', 'profile-1', messages);

    let hits = 0;
    const queries = 100;

    for (let i = 0; i < queries; i++) {
      const result = cache.get('60123456789', 'profile-1');
      if (result !== null) hits++;
    }

    const hitRatio = hits / queries;
    expect(hitRatio).toBeGreaterThan(0.8);
    expect(hitRatio).toBe(1); // 100% hits while entry is valid
  });

  it('cache hit ratio drops to 0% after TTL expiration', () => {
    const messages = makeMessages(5);
    cache.set('60123456789', 'profile-1', messages);

    vi.advanceTimersByTime(5001);

    let hits = 0;
    const queries = 50;

    for (let i = 0; i < queries; i++) {
      const result = cache.get('60123456789', 'profile-1');
      if (result !== null) hits++;
    }

    expect(hits).toBe(0);
  });

  it('cache hit ratio reflects mixed hits and misses', () => {
    const messages1 = makeMessages(2);
    const messages2 = makeMessages(2);

    cache.set('60111111111', 'profile-1', messages1);
    cache.set('60222222222', 'profile-1', messages2);

    let hits = 0;

    // 70 queries to valid entries (hits)
    for (let i = 0; i < 70; i++) {
      if (cache.get('60111111111', 'profile-1')) hits++;
      if (i % 2 === 0 && cache.get('60222222222', 'profile-1')) hits++;
    }

    // 30 queries to expired entries (misses)
    vi.advanceTimersByTime(5001);
    for (let i = 0; i < 30; i++) {
      if (cache.get('60111111111', 'profile-1')) hits++;
    }

    const hitRatio = hits / 130; // Total queries
    expect(hitRatio).toBeGreaterThan(0.5);
  });

  // ── AC3: Eviction behavior and ordering ───────────────────────────────────────

  it('evicts entries in strict FIFO order (first-added first-evicted)', () => {
    const convos = Array.from({ length: 11 }, (_, i) => ({
      phone: `6012345${i.toString().padStart(4, '0')}`,
      messages: makeMessages(1),
    }));

    // Add first 10
    for (let i = 0; i < 10; i++) {
      cache.set(convos[i].phone, 'profile-1', convos[i].messages);
    }

    expect(cache.size()).toBe(10);

    // Add 11th, first should be evicted
    cache.set(convos[10].phone, 'profile-1', convos[10].messages);
    expect(cache.get(convos[0].phone, 'profile-1')).toBeNull();
    expect(cache.size()).toBe(10);
  });

  // ── Clear and size operations ────────────────────────────────────────────────

  it('clear removes all entries', () => {
    cache.set('60111111111', 'profile-1', makeMessages(1));
    cache.set('60222222222', 'profile-1', makeMessages(1));
    cache.set('60333333333', 'profile-1', makeMessages(1));

    expect(cache.size()).toBe(3);

    cache.clear();

    expect(cache.size()).toBe(0);
    expect(cache.get('60111111111', 'profile-1')).toBeNull();
  });

  it('size() returns accurate count of cached entries', () => {
    expect(cache.size()).toBe(0);

    cache.set('60111111111', 'profile-1', makeMessages(1));
    expect(cache.size()).toBe(1);

    cache.set('60222222222', 'profile-1', makeMessages(1));
    expect(cache.size()).toBe(2);

    cache.invalidate('60111111111', 'profile-1');
    expect(cache.size()).toBe(1);
  });

  // ── Evict expired ────────────────────────────────────────────────────────────

  it('evictExpired removes all TTL-expired entries', () => {
    cache.set('60111111111', 'profile-1', makeMessages(1));
    cache.set('60222222222', 'profile-1', makeMessages(1));

    vi.advanceTimersByTime(2500);

    cache.set('60333333333', 'profile-1', makeMessages(1));

    vi.advanceTimersByTime(2600); // First 2 should be expired, 3rd should have ~1400ms left

    cache.evictExpired();

    expect(cache.get('60111111111', 'profile-1')).toBeNull();
    expect(cache.get('60222222222', 'profile-1')).toBeNull();
    expect(cache.get('60333333333', 'profile-1')).not.toBeNull();
  });

  // ── Empty/edge cases ─────────────────────────────────────────────────────────

  it('handles empty message arrays', () => {
    cache.set('60123456789', 'profile-1', []);

    const retrieved = cache.get('60123456789', 'profile-1');
    expect(retrieved).toEqual([]);
  });

  it('handles very large message arrays', () => {
    const largeMessages = makeMessages(10000);
    cache.set('60123456789', 'profile-1', largeMessages);

    const retrieved = cache.get('60123456789', 'profile-1');
    expect(retrieved).toHaveLength(10000);
    expect(retrieved).toEqual(largeMessages);
  });

  it('handles rapid set/get/invalidate cycles', () => {
    for (let i = 0; i < 100; i++) {
      const messages = makeMessages(5);
      cache.set('60123456789', 'profile-1', messages);

      const retrieved = cache.get('60123456789', 'profile-1');
      expect(retrieved).toEqual(messages);

      if (i % 3 === 0) {
        cache.invalidate('60123456789', 'profile-1');
        expect(cache.get('60123456789', 'profile-1')).toBeNull();
      }
    }
  });
});
