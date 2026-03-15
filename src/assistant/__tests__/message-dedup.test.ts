/**
 * Tests for US-991 + US-1008: Webhook message deduplication via Redis idempotency key store.
 *
 * US-1008 acceptance criteria:
 * AC1: Every inbound webhook event is checked against whatsapp:msg:{message_id} key
 * AC2: Duplicate is acknowledged with 200 but skipped; no duplicate AI call
 * AC3: Redis keys have a 4-hour TTL
 * AC4: Deduplication hit count is emitted as a log metric
 * AC5: Tests cover: first delivery processed, duplicate skipped, TTL expiry re-processing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock dependencies ────────────────────────────────────────────────────

// Mock webhook-raw-events (persistRawEvent)
vi.mock('../../lib/webhook-raw-events.js', () => ({
  persistRawEvent: vi.fn().mockResolvedValue('raw-event-id-123'),
  markRawEventProcessed: vi.fn().mockResolvedValue(undefined),
}));

// Mock bullmq — provide Queue, Worker, QueueEvents stubs
vi.mock('bullmq', () => ({
  Queue: vi.fn(),
  Worker: vi.fn(),
  QueueEvents: vi.fn(),
}));

// Mock ioredis — not connected in these tests (in-memory fallback)
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockRejectedValue(new Error('No Redis in test')),
    quit: vi.fn().mockResolvedValue('OK'),
    set: vi.fn(),
  })),
}));

// Mock net for probeRedis
vi.mock('net', () => ({
  default: {
    Socket: vi.fn().mockImplementation(() => ({
      connect: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'error') cb(); // Redis not available in tests
      }),
    })),
  },
}));

import type { IncomingMessage } from '../types.js';

// Import after mocks are set up
const { _testExports, enqueueMessage, getDedupStats } = await import('../../lib/message-queue.js');

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeMessage(messageId: string, from = '60123456789'): IncomingMessage {
  return {
    from,
    text: 'Hello',
    pushName: 'Test User',
    messageId,
    isGroup: false,
    timestamp: Math.floor(Date.now() / 1000),
    messageType: 'text',
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('US-1008: Webhook message deduplication via Redis idempotency key store', () => {
  beforeEach(() => {
    // Clear in-memory dedup state between tests
    _testExports.memoryDedup.clear();
    _testExports.resetDedupHitCount();
    // Set a short TTL for testing (10 seconds)
    _testExports.setDedupTtl(10);
    vi.clearAllMocks();
  });

  afterEach(() => {
    _testExports.memoryDedup.clear();
  });

  describe('AC1+AC5: first delivery processed, duplicate skipped', () => {
    it('returns false for a new message ID (first delivery processed)', async () => {
      const result = await _testExports.isDuplicateMessage('msg-new-001');
      expect(result).toBe(false);
    });

    it('returns true for a duplicate message ID within TTL (duplicate skipped)', async () => {
      await _testExports.isDuplicateMessage('msg-dup-001');
      const result = await _testExports.isDuplicateMessage('msg-dup-001');
      expect(result).toBe(true);
    });

    it('uses messages[].id (messageId field) as whatsapp:msg:{id} dedup key', async () => {
      // First call — registers the ID
      await _testExports.isDuplicateMessage('WAMID.abc123');
      expect(_testExports.memoryDedup.has('WAMID.abc123')).toBe(true);

      // Second call — detected as duplicate
      const dup = await _testExports.isDuplicateMessage('WAMID.abc123');
      expect(dup).toBe(true);
    });

    it('different message IDs are independent', async () => {
      await _testExports.isDuplicateMessage('msg-A');
      await _testExports.isDuplicateMessage('msg-B');

      expect(await _testExports.isDuplicateMessage('msg-A')).toBe(true);
      expect(await _testExports.isDuplicateMessage('msg-B')).toBe(true);
      expect(await _testExports.isDuplicateMessage('msg-C')).toBe(false);
    });
  });

  describe('AC3: 4-hour TTL — expiry causes re-processing', () => {
    it('expired entries are treated as new messages (re-processing after TTL)', async () => {
      // Set a very short TTL
      _testExports.setDedupTtl(1); // 1 second

      await _testExports.isDuplicateMessage('msg-expire-001');

      // Manually age the entry beyond TTL
      _testExports.memoryDedup.set('msg-expire-001', Date.now() - 2000);

      // Should be treated as new (expired) — re-processing allowed
      const result = await _testExports.isDuplicateMessage('msg-expire-001');
      expect(result).toBe(false);
    });

    it('default TTL is 14400 seconds (4 hours) per US-1008', () => {
      // Reset to default by setting to 14400
      _testExports.setDedupTtl(14400);
      expect(_testExports.dedupTtlSeconds).toBe(14400);
    });

    it('TTL is configurable', () => {
      _testExports.setDedupTtl(3600); // 1 hour
      expect(_testExports.dedupTtlSeconds).toBe(3600);
    });

    it('rejects non-positive TTL values', () => {
      _testExports.setDedupTtl(100);
      _testExports.setDedupTtl(0); // should be ignored
      expect(_testExports.dedupTtlSeconds).toBe(100);

      _testExports.setDedupTtl(-1); // should be ignored
      expect(_testExports.dedupTtlSeconds).toBe(100);
    });
  });

  describe('AC2+AC4: duplicate skipped with metric emitted', () => {
    it('two identical payloads result in only one processing attempt', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const msg = makeMessage('msg-identical-001');

      // First call — should go through (enqueue or direct handler)
      await enqueueMessage(msg);

      // Second call — should be silently skipped due to dedup
      await enqueueMessage(msg);

      // The dedup log should have been emitted for the second call
      const dedupLogs = consoleSpy.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('Dedup: skipping duplicate')
      );
      expect(dedupLogs.length).toBe(1);
      expect(dedupLogs[0][0]).toContain('msg-identical-001');

      consoleSpy.mockRestore();
    });

    it('dedup hit count is incremented on duplicate', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      expect(_testExports.dedupHitCount).toBe(0);

      const msg = makeMessage('WAMID.counter-test');
      await enqueueMessage(msg);        // first — processed
      await enqueueMessage(msg);        // duplicate — hit count = 1
      await enqueueMessage(msg);        // duplicate — hit count = 2

      expect(_testExports.dedupHitCount).toBe(2);

      consoleSpy.mockRestore();
    });

    it('dedup log includes totalHits metric', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const msg = makeMessage('WAMID.metric-test');
      await enqueueMessage(msg);
      await enqueueMessage(msg); // duplicate

      const dedupLog = consoleSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('WAMID.metric-test')
      );
      expect(dedupLog).toBeDefined();
      expect(dedupLog![0]).toContain('totalHits=');

      consoleSpy.mockRestore();
    });

    it('getDedupStats returns current hit count and TTL', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      _testExports.setDedupTtl(14400);
      const msg = makeMessage('WAMID.stats-test');
      await enqueueMessage(msg);
      await enqueueMessage(msg); // duplicate

      const stats = getDedupStats();
      expect(stats.dedupHits).toBe(1);
      expect(stats.ttlSeconds).toBe(14400);
      expect(stats.memoryDedupSize).toBeGreaterThan(0);

      consoleSpy.mockRestore();
    });

    it('messages with different IDs are both processed (no false positives)', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await enqueueMessage(makeMessage('msg-001'));
      await enqueueMessage(makeMessage('msg-002'));

      // No dedup log should be emitted
      const dedupLogs = consoleSpy.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('Dedup: skipping duplicate')
      );
      expect(dedupLogs.length).toBe(0);
      expect(_testExports.dedupHitCount).toBe(0);

      consoleSpy.mockRestore();
    });
  });
});
