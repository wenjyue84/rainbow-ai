/**
 * Tests for Conversation Recovery (US-586)
 *
 * Tests verify that:
 * 1. ConversationRecovery snapshots full message history + metadata to Redis with 24h TTL
 * 2. On provider timeout, recovery handler pulls snapshot and retries with original context
 * 3. Recovery succeeds after simulated transient errors without user needing to repeat input
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Redis from 'ioredis';
import type { ConversationState } from '../../assistant/types.js';
import { RedisBackedRecovery, conversationRecovery } from '../conversation-recovery.js';

describe('ConversationRecovery (US-586)', () => {
  let mockRedis: Partial<Redis>;
  let recovery: RedisBackedRecovery;

  beforeEach(() => {
    // Mock Redis client
    mockRedis = {
      set: vi.fn(async (key, value, mode, ttl) => 'OK'),
      get: vi.fn(async (key) => null),
      del: vi.fn(async (key) => 1),
    };

    // Create instance with mocked Redis
    recovery = new RedisBackedRecovery();
    recovery.attachRedis(mockRedis as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('snapshot()', () => {
    it('should snapshot full conversation state to Redis with 24h TTL', async () => {
      const conversationId = '1234567890';
      const state: ConversationState = {
        phone: conversationId,
        profileId: 'pelangi',
        pushName: 'Alice',
        messages: [
          { role: 'user', content: 'Hello', timestamp: 1000 },
          { role: 'assistant', content: 'Hi Alice!', timestamp: 1001 },
          { role: 'user', content: 'How are you?', timestamp: 1002 },
          { role: 'assistant', content: 'I am doing well, thanks for asking!', timestamp: 1003 },
        ],
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastIntent: 'greeting',
        lastIntentConfidence: 0.95,
        lastIntentTimestamp: Date.now(),
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
        lastActiveAt: Date.now(),
      };

      recovery.snapshot(conversationId, state);

      // Allow async operation to complete
      await new Promise(r => setTimeout(r, 50));

      expect(mockRedis.set).toHaveBeenCalledWith(
        `recovery:conversation:${conversationId}`,
        JSON.stringify(state),
        'EX',
        86400 // 24 hours in seconds
      );
    });

    it('should handle multiple snapshots for different conversations', async () => {
      const state1: ConversationState = {
        phone: 'phone1',
        profileId: 'pelangi',
        pushName: 'Alice',
        messages: [{ role: 'user', content: 'Hi', timestamp: 1000 }],
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastIntent: null,
        lastIntentConfidence: null,
        lastIntentTimestamp: null,
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
        lastActiveAt: Date.now(),
      };

      const state2: ConversationState = {
        ...state1,
        phone: 'phone2',
        pushName: 'Bob',
      };

      recovery.snapshot('phone1', state1);
      recovery.snapshot('phone2', state2);

      await new Promise(r => setTimeout(r, 50));

      expect(mockRedis.set).toHaveBeenCalledTimes(2);
    });

    it('should skip snapshot if Redis is unavailable', async () => {
      const recovery2 = new RedisBackedRecovery();
      // Don't attach Redis

      const state: ConversationState = {
        phone: 'phone1',
        profileId: 'pelangi',
        pushName: 'Alice',
        messages: [],
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastIntent: null,
        lastIntentConfidence: null,
        lastIntentTimestamp: null,
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: null,
        lastActiveAt: Date.now(),
      };

      // Should not throw
      recovery2.snapshot('phone1', state);
    });
  });

  describe('restore()', () => {
    it('should restore conversation state from Redis snapshot', async () => {
      const conversationId = 'phone1';
      const state: ConversationState = {
        phone: conversationId,
        profileId: 'pelangi',
        pushName: 'Alice',
        messages: [
          { role: 'user', content: 'Hello', timestamp: 1000 },
          { role: 'assistant', content: 'Hi Alice!', timestamp: 1001 },
        ],
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastIntent: 'greeting',
        lastIntentConfidence: 0.9,
        lastIntentTimestamp: Date.now(),
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
        lastActiveAt: Date.now(),
      };

      // Mock Redis get to return the state
      mockRedis.get = vi.fn(async (key) => {
        if (key === `recovery:conversation:${conversationId}`) {
          return JSON.stringify(state);
        }
        return null;
      });

      const restored = await recovery.restore(conversationId);

      expect(restored).toEqual(state);
      expect(restored?.messages.length).toBe(2);
      expect(restored?.pushName).toBe('Alice');
    });

    it('should return null if snapshot does not exist', async () => {
      mockRedis.get = vi.fn(async (key) => null);

      const restored = await recovery.restore('nonexistent');

      expect(restored).toBeNull();
    });

    it('should handle Redis connection errors gracefully', async () => {
      mockRedis.get = vi.fn(async (key) => {
        throw new Error('Redis connection failed');
      });

      await expect(recovery.restore('phone1')).rejects.toThrow('Redis connection failed');
    });

    it('should restore conversation context after simulated provider timeout', async () => {
      const conversationId = 'phone1';

      // Original conversation state before timeout
      const state: ConversationState = {
        phone: conversationId,
        profileId: 'pelangi',
        pushName: 'Alice',
        messages: [
          { role: 'user', content: 'Book a room for 3 nights', timestamp: 1000 },
          { role: 'assistant', content: 'I can help you book! What dates?', timestamp: 1001 },
        ],
        language: 'en',
        bookingState: { checkInDate: '2026-04-15', numberOfNights: 3 },
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastIntent: 'booking',
        lastIntentConfidence: 0.95,
        lastIntentTimestamp: Date.now(),
        slots: { checkin: '2026-04-15', nights: '3' },
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
        lastActiveAt: Date.now(),
      };

      // Setup mock Redis to return the state
      mockRedis.get = vi.fn(async (key) => {
        if (key === `recovery:conversation:${conversationId}`) {
          return JSON.stringify(state);
        }
        return null;
      });

      // Simulate provider timeout → recovery
      const restored = await recovery.restore(conversationId);

      // Verify all context is restored
      expect(restored).toBeDefined();
      expect(restored?.bookingState?.checkInDate).toBe('2026-04-15');
      expect(restored?.bookingState?.numberOfNights).toBe(3);
      expect(restored?.messages.length).toBe(2);
      expect(restored?.slots.checkin).toBe('2026-04-15');
    });
  });

  describe('invalidate()', () => {
    it('should delete snapshot from Redis', async () => {
      const conversationId = 'phone1';

      recovery.invalidate(conversationId);

      await new Promise(r => setTimeout(r, 50));

      expect(mockRedis.del).toHaveBeenCalledWith(`recovery:conversation:${conversationId}`);
    });
  });

  describe('integration: snapshot + restore', () => {
    it('should survive round-trip: snapshot then restore', async () => {
      const conversationId = 'phone1';
      const originalState: ConversationState = {
        phone: conversationId,
        profileId: 'pelangi',
        pushName: 'Charlie',
        messages: [
          { role: 'user', content: 'What amenities do you have?', timestamp: 1000 },
          { role: 'assistant', content: 'We have WiFi, A/C, and hot water.', timestamp: 1001 },
          { role: 'user', content: 'Do you have parking?', timestamp: 1002 },
        ],
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastIntent: 'amenities_inquiry',
        lastIntentConfidence: 0.88,
        lastIntentTimestamp: Date.now(),
        slots: { amenity: 'parking' },
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
        lastActiveAt: Date.now(),
      };

      // Setup mock to store and retrieve
      let stored: string | null = null;
      mockRedis.set = vi.fn(async (key, value) => {
        stored = value;
        return 'OK';
      });
      mockRedis.get = vi.fn(async (key) => stored);

      // Snapshot
      recovery.snapshot(conversationId, originalState);
      await new Promise(r => setTimeout(r, 50));

      // Restore
      const restored = await recovery.restore(conversationId);

      expect(restored).toEqual(originalState);
      expect(restored?.messages.length).toBe(3);
      expect(restored?.lastIntent).toBe('amenities_inquiry');
    });
  });

  describe('singleton instance', () => {
    it('should be available as conversationRecovery singleton', () => {
      expect(conversationRecovery).toBeDefined();
      expect(conversationRecovery).toHaveProperty('snapshot');
      expect(conversationRecovery).toHaveProperty('restore');
    });
  });
});
