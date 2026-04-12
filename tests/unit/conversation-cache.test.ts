/**
 * Tests for Conversation Query Cache (US-526)
 *
 * AC1: Cache key = SHA256(conversation_id + normalized_query); cache hit returns
 *      cached response with metadata 'source: cache'; TTL=300 seconds
 * AC2: Repeated identical queries within 5min return cached response;
 *      after TTL expires, query hits LLM again; different queries = different keys
 * AC3: Unit tests verify cache hit/miss behavior, TTL expiry invalidates stale
 *      cache, concurrent requests for same query return same cached result
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConversationCache, CONVERSATION_CACHE_TTL_SECONDS } from '../../src/lib/conversation-cache.js';
import type { ClassificationResult } from '../../src/assistant/pipeline/stages/tier-classification.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    intent: 'pricing',
    action: 'llm_reply',
    response: 'Our prices start from RM80/night.',
    confidence: 0.92,
    model: 'llm',
    responseTime: 820,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ConversationCache — US-526', () => {
  let cache: ConversationCache;

  beforeEach(() => {
    cache = new ConversationCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── AC1: Cache key generation ────────────────────────────────────────────

  it('generates deterministic SHA256 key for same conversation_id + query', () => {
    const k1 = cache.cacheKey('60123456789', 'how much is a room?');
    const k2 = cache.cacheKey('60123456789', 'how much is a room?');
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(64); // 256-bit hex
  });

  it('normalizes query before hashing (case-insensitive, whitespace-collapsed)', () => {
    const k1 = cache.cacheKey('60123456789', 'HOW MUCH is a room?');
    const k2 = cache.cacheKey('60123456789', 'how much  is  a  room?');
    const k3 = cache.cacheKey('60123456789', '  how much is a room?  ');
    expect(k1).toBe(k2);
    expect(k2).toBe(k3);
  });

  it('generates different keys for different queries', () => {
    const k1 = cache.cacheKey('60123456789', 'how much is a room?');
    const k2 = cache.cacheKey('60123456789', 'what amenities do you have?');
    expect(k1).not.toBe(k2);
  });

  it('generates different keys for different conversation_ids with same query', () => {
    const k1 = cache.cacheKey('60123456789', 'what is the price?');
    const k2 = cache.cacheKey('60198765432', 'what is the price?');
    expect(k1).not.toBe(k2);
  });

  // ── AC2: Cache hit / miss behavior ───────────────────────────────────────

  it('returns null on cache miss', () => {
    const result = cache.get('nonexistent-key');
    expect(result).toBeNull();
  });

  it('returns cached result on cache hit', () => {
    const key = cache.cacheKey('60123456789', 'room price');
    const stored = makeResult();
    cache.set(key, stored, 300);

    const hit = cache.get(key);
    expect(hit).not.toBeNull();
    expect(hit?.intent).toBe('pricing');
    expect(hit?.response).toBe('Our prices start from RM80/night.');
  });

  it('cache hit is returned in <10ms (no async I/O)', () => {
    const key = cache.cacheKey('60123456789', 'room price');
    cache.set(key, makeResult(), 300);

    const start = performance.now();
    const hit = cache.get(key);
    const elapsed = performance.now() - start;

    expect(hit).not.toBeNull();
    expect(elapsed).toBeLessThan(10);
  });

  // ── AC2: TTL expiry ──────────────────────────────────────────────────────

  it('returns null after TTL expires', () => {
    const key = cache.cacheKey('60123456789', 'expired query');
    cache.set(key, makeResult(), 300);

    // Advance time past TTL
    vi.advanceTimersByTime(301 * 1000);

    const result = cache.get(key);
    expect(result).toBeNull();
  });

  it('returns cached result before TTL expires', () => {
    const key = cache.cacheKey('60123456789', 'valid query');
    cache.set(key, makeResult(), 300);

    // Advance time within TTL window
    vi.advanceTimersByTime(299 * 1000);

    const result = cache.get(key);
    expect(result).not.toBeNull();
  });

  it('default TTL is 300 seconds', () => {
    expect(CONVERSATION_CACHE_TTL_SECONDS).toBe(300);
  });

  it('set with default TTL expires after 300s', () => {
    const key = cache.cacheKey('60123456789', 'default ttl check');
    cache.set(key, makeResult()); // no explicit TTL → uses default 300s

    vi.advanceTimersByTime(300 * 1000 - 1);
    expect(cache.get(key)).not.toBeNull();

    vi.advanceTimersByTime(2);
    expect(cache.get(key)).toBeNull();
  });

  // ── AC3: Invalidation ─────────────────────────────────────────────────────

  it('invalidate removes a specific key', () => {
    const key = cache.cacheKey('60123456789', 'some query');
    cache.set(key, makeResult(), 300);
    expect(cache.get(key)).not.toBeNull();

    cache.invalidate(key);
    expect(cache.get(key)).toBeNull();
  });

  it('invalidate on non-existent key is a no-op', () => {
    expect(() => cache.invalidate('ghost-key')).not.toThrow();
  });

  // ── AC3: Concurrent / multi-entry isolation ──────────────────────────────

  it('concurrent requests for same query return same cached result', () => {
    const key = cache.cacheKey('60123456789', 'concurrent query');
    const stored = makeResult({ response: 'Shared cached response' });
    cache.set(key, stored, 300);

    // Simulate 10 "concurrent" gets
    const results = Array.from({ length: 10 }, () => cache.get(key));
    expect(results.every(r => r?.response === 'Shared cached response')).toBe(true);
  });

  it('different queries for same conversation are cached independently', () => {
    const phone = '60123456789';
    const k1 = cache.cacheKey(phone, 'price query');
    const k2 = cache.cacheKey(phone, 'booking query');

    cache.set(k1, makeResult({ intent: 'pricing', response: 'RM80/night' }), 300);
    cache.set(k2, makeResult({ intent: 'booking', response: 'Please provide check-in date' }), 300);

    expect(cache.get(k1)?.intent).toBe('pricing');
    expect(cache.get(k2)?.intent).toBe('booking');
  });

  // ── Size / eviction ──────────────────────────────────────────────────────

  it('size() reflects live (non-expired) entries only', () => {
    const k1 = cache.cacheKey('phone1', 'q1');
    const k2 = cache.cacheKey('phone2', 'q2');

    cache.set(k1, makeResult(), 100);
    cache.set(k2, makeResult(), 300);
    expect(cache.size()).toBe(2);

    vi.advanceTimersByTime(101 * 1000); // k1 expired, k2 still live
    expect(cache.size()).toBe(1);
  });

  // ── Redis background durability ───────────────────────────────────────────

  it('attachRedis does not break sync get/set behavior', () => {
    const mockRedis = {
      set: vi.fn(() => Promise.resolve('OK')),
      del: vi.fn(() => Promise.resolve(1)),
    } as any;
    cache.attachRedis(mockRedis);

    const key = cache.cacheKey('60123456789', 'redis compat test');
    cache.set(key, makeResult({ response: 'still works' }), 300);

    const hit = cache.get(key);
    expect(hit?.response).toBe('still works');
  });

  it('set fires background Redis write with correct key prefix and TTL', async () => {
    const writtenKeys: string[] = [];
    const mockRedis = {
      set: vi.fn((k: string, _v: string, _ex: string, _ttl: number) => {
        writtenKeys.push(k);
        return Promise.resolve('OK');
      }),
      del: vi.fn(() => Promise.resolve(1)),
    } as any;
    cache.attachRedis(mockRedis);

    const key = cache.cacheKey('60123456789', 'background write test');
    cache.set(key, makeResult(), 300);

    // Flush promise microtask queue so fire-and-forget completes
    await Promise.resolve();

    expect(mockRedis.set).toHaveBeenCalledOnce();
    const [calledKey, , exCmd, ttl] = mockRedis.set.mock.calls[0] as [string, string, string, number];
    expect(calledKey).toMatch(/^conv:query:/);
    expect(exCmd).toBe('EX');
    expect(ttl).toBe(300);
  });

  it('invalidate fires background Redis delete', async () => {
    const mockRedis = {
      set: vi.fn(() => Promise.resolve('OK')),
      del: vi.fn(() => Promise.resolve(1)),
    } as any;
    cache.attachRedis(mockRedis);

    const key = cache.cacheKey('60123456789', 'delete test');
    cache.invalidate(key);

    await Promise.resolve();

    expect(mockRedis.del).toHaveBeenCalledOnce();
    const calledKey = mockRedis.del.mock.calls[0][0] as string;
    expect(calledKey).toMatch(/^conv:query:/);
  });

  it('Redis errors do not break sync cache behavior', async () => {
    const mockRedis = {
      set: vi.fn(() => Promise.reject(new Error('Redis down'))),
      del: vi.fn(() => Promise.reject(new Error('Redis down'))),
    } as any;
    cache.attachRedis(mockRedis);

    const key = cache.cacheKey('60123456789', 'error resilience test');
    // set should not throw even if Redis fails
    expect(() => cache.set(key, makeResult({ response: 'fallback ok' }), 300)).not.toThrow();

    // In-memory still works
    expect(cache.get(key)?.response).toBe('fallback ok');

    // Allow rejection to surface (should be swallowed)
    await Promise.resolve();
  });
});
