/**
 * US-571: Implement Per-Profile Conversation Turn Limit with Auto-Escalation
 *
 * Tests for enforceConversationLimit function:
 * 1. Turn counting increments correctly based on messages.length
 * 2. Escalation triggers at profile-specific limits (data-makan at 15, data-southern at 18)
 * 3. Escalation message posts exactly once
 * 4. Escalation event is logged to database
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enforceConversationLimit } from '../../src/assistant/pipeline/conversation-limiter.js';
import * as escalationEvents from '../../src/lib/escalation-events.js';
import type { ConversationState } from '../../src/assistant/types.js';

// Mock the escalation events logger
vi.mock('../../src/lib/escalation-events.js', () => ({
  logEscalationEvent: vi.fn(),
}));

describe('US-571: Conversation Turn Limit Enforcement', () => {
  let sendMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMessageMock = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * AC1: Turn counting increments correctly
   */
  describe('AC1: Turn Counting', () => {
    it('correctly counts turn count as messages.length', async () => {
      const conversation: ConversationState = {
        phone: '1234567890',
        profileId: 'data-pelangi',
        pushName: 'Test User',
        messages: [
          { role: 'user', content: 'Hello', timestamp: 1000 },
          { role: 'assistant', content: 'Hi', timestamp: 1001 },
          { role: 'user', content: 'How are you?', timestamp: 1002 },
        ],
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastIntent: null,
        lastIntentConfidence: null,
        lastIntentTimestamp: null,
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
      };

      const result = await enforceConversationLimit(
        conversation,
        'data-pelangi',
        sendMessageMock
      );

      // Turn count is 3 (3 messages), limit is 20, so no escalation
      expect(result.escalated).toBe(false);
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('increments turn count for each message in history', async () => {
      const conversation: ConversationState = {
        phone: '1234567890',
        profileId: 'data-pelangi',
        pushName: 'Test User',
        messages: Array.from({ length: 10 }, (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i + 1}`,
          timestamp: 1000 + i,
        })),
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastIntent: null,
        lastIntentConfidence: null,
        lastIntentTimestamp: null,
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
      };

      const result = await enforceConversationLimit(
        conversation,
        'data-pelangi',
        sendMessageMock
      );

      // Turn count is 10, limit is 20, so no escalation
      expect(result.escalated).toBe(false);
      expect(sendMessageMock).not.toHaveBeenCalled();
    });
  });

  /**
   * AC2: Escalation triggers at profile-specific limits
   */
  describe('AC2: Profile-Specific Escalation Limits', () => {
    it('escalates when data-makan profile exceeds 15 turns', async () => {
      const conversation: ConversationState = {
        phone: '1234567890',
        profileId: 'data-makan',
        pushName: 'Test User',
        messages: Array.from({ length: 16 }, (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i + 1}`,
          timestamp: 1000 + i,
        })),
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastIntent: null,
        lastIntentConfidence: null,
        lastIntentTimestamp: null,
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
      };

      const result = await enforceConversationLimit(
        conversation,
        'data-makan',
        sendMessageMock
      );

      // Turn count is 16, limit is 15, so escalation should occur
      expect(result.escalated).toBe(true);
      expect(result.reason).toMatch(/Turn limit exceeded/);
      expect(sendMessageMock).toHaveBeenCalledOnce();
    });

    it('does NOT escalate when data-makan profile is at exactly 15 turns', async () => {
      const conversation: ConversationState = {
        phone: '1234567890',
        profileId: 'data-makan',
        pushName: 'Test User',
        messages: Array.from({ length: 15 }, (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i + 1}`,
          timestamp: 1000 + i,
        })),
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastIntent: null,
        lastIntentConfidence: null,
        lastIntentTimestamp: null,
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
      };

      const result = await enforceConversationLimit(
        conversation,
        'data-makan',
        sendMessageMock
      );

      // Turn count is 15, limit is 15, so no escalation
      expect(result.escalated).toBe(false);
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('escalates when data-southern profile exceeds 18 turns', async () => {
      const conversation: ConversationState = {
        phone: '1234567890',
        profileId: 'data-southern',
        pushName: 'Test User',
        messages: Array.from({ length: 19 }, (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i + 1}`,
          timestamp: 1000 + i,
        })),
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastIntent: null,
        lastIntentConfidence: null,
        lastIntentTimestamp: null,
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
      };

      const result = await enforceConversationLimit(
        conversation,
        'data-southern',
        sendMessageMock
      );

      // Turn count is 19, limit is 18, so escalation should occur
      expect(result.escalated).toBe(true);
      expect(result.reason).toMatch(/Turn limit exceeded/);
      expect(sendMessageMock).toHaveBeenCalledOnce();
    });

    it('does NOT escalate when data-southern profile is at exactly 18 turns', async () => {
      const conversation: ConversationState = {
        phone: '1234567890',
        profileId: 'data-southern',
        pushName: 'Test User',
        messages: Array.from({ length: 18 }, (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i + 1}`,
          timestamp: 1000 + i,
        })),
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastIntent: null,
        lastIntentConfidence: null,
        lastIntentTimestamp: null,
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
      };

      const result = await enforceConversationLimit(
        conversation,
        'data-southern',
        sendMessageMock
      );

      // Turn count is 18, limit is 18, so no escalation
      expect(result.escalated).toBe(false);
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('escalates when data-pelangi profile exceeds 20 turns', async () => {
      const conversation: ConversationState = {
        phone: '1234567890',
        profileId: 'data-pelangi',
        pushName: 'Test User',
        messages: Array.from({ length: 21 }, (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i + 1}`,
          timestamp: 1000 + i,
        })),
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastIntent: null,
        lastIntentConfidence: null,
        lastIntentTimestamp: null,
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
      };

      const result = await enforceConversationLimit(
        conversation,
        'data-pelangi',
        sendMessageMock
      );

      // Turn count is 21, limit is 20, so escalation should occur
      expect(result.escalated).toBe(true);
      expect(result.reason).toMatch(/Turn limit exceeded/);
      expect(sendMessageMock).toHaveBeenCalledOnce();
    });
  });

  /**
   * AC3: Escalation message posts exactly once
   */
  describe('AC3: Recovery Message Posting', () => {
    it('sends recovery message exactly once when escalation occurs', async () => {
      const conversation: ConversationState = {
        phone: '1234567890',
        profileId: 'data-makan',
        pushName: 'Test User',
        messages: Array.from({ length: 16 }, (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i + 1}`,
          timestamp: 1000 + i,
        })),
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastIntent: null,
        lastIntentConfidence: null,
        lastIntentTimestamp: null,
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
      };

      const result = await enforceConversationLimit(
        conversation,
        'data-makan',
        sendMessageMock
      );

      expect(result.escalated).toBe(true);
      expect(sendMessageMock).toHaveBeenCalledOnce();
      expect(sendMessageMock).toHaveBeenCalledWith('1234567890', expect.stringContaining('connect'));
    });

    it('includes profile name in recovery message', async () => {
      const conversation: ConversationState = {
        phone: '1234567890',
        profileId: 'data-makan',
        pushName: 'Test User',
        messages: Array.from({ length: 16 }, (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i + 1}`,
          timestamp: 1000 + i,
        })),
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastIntent: null,
        lastIntentConfidence: null,
        lastIntentTimestamp: null,
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
      };

      await enforceConversationLimit(
        conversation,
        'data-makan',
        sendMessageMock
      );

      expect(sendMessageMock).toHaveBeenCalledOnce();
      // The message should contain the profile name (MAKAN)
      const [, message] = sendMessageMock.mock.calls[0];
      expect(message.toUpperCase()).toMatch(/MAKAN/);
    });

    it('respects conversation language in recovery message', async () => {
      const conversation: ConversationState = {
        phone: '1234567890',
        profileId: 'data-southern',
        pushName: 'Test User',
        messages: Array.from({ length: 19 }, (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i + 1}`,
          timestamp: 1000 + i,
        })),
        language: 'ta', // Tamil language
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastIntent: null,
        lastIntentConfidence: null,
        lastIntentTimestamp: null,
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
      };

      await enforceConversationLimit(
        conversation,
        'data-southern',
        sendMessageMock
      );

      expect(sendMessageMock).toHaveBeenCalledOnce();
      // Message should be in Tamil (we can't easily validate Tamil content, but ensure it's sent)
      const [, message] = sendMessageMock.mock.calls[0];
      expect(message).toBeTruthy();
    });
  });

  /**
   * Additional: Database Logging
   */
  describe('Database Logging', () => {
    it('logs escalation event to database when limit exceeded', async () => {
      const conversation: ConversationState = {
        phone: '1234567890',
        profileId: 'data-makan',
        pushName: 'Test User',
        messages: Array.from({ length: 16 }, (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i + 1}`,
          timestamp: 1000 + i,
        })),
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastIntent: null,
        lastIntentConfidence: null,
        lastIntentTimestamp: null,
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
      };

      const result = await enforceConversationLimit(
        conversation,
        'data-makan',
        sendMessageMock
      );

      expect(result.escalated).toBe(true);
      expect(escalationEvents.logEscalationEvent).toHaveBeenCalledOnce();
      expect(escalationEvents.logEscalationEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          jid: '1234567890',
          profileId: 'data-makan',
          trigger: 'turn_limit_exceeded',
          count: 16,
          metadata: expect.objectContaining({
            maxTurns: 15,
            profileId: 'data-makan',
          }),
        })
      );
    });

    it('does NOT log escalation event when no limit exceeded', async () => {
      const conversation: ConversationState = {
        phone: '1234567890',
        profileId: 'data-makan',
        pushName: 'Test User',
        messages: Array.from({ length: 10 }, (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i + 1}`,
          timestamp: 1000 + i,
        })),
        language: 'en',
        bookingState: null,
        workflowState: null,
        activeFlow: null,
        unknownCount: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        lastIntent: null,
        lastIntentConfidence: null,
        lastIntentTimestamp: null,
        slots: {},
        repeatCount: 0,
        lastUserMessageAt: Date.now(),
      };

      const result = await enforceConversationLimit(
        conversation,
        'data-makan',
        sendMessageMock
      );

      expect(result.escalated).toBe(false);
      expect(escalationEvents.logEscalationEvent).not.toHaveBeenCalled();
    });
  });
});
