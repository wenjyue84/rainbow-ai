/**
 * Tests for US-373: Low-Confidence Intent Auto-Escalation Router
 *
 * Ensures messages with confidence below configurable threshold are
 * automatically escalated to staff instead of attempting fallback responses.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { shouldAutoEscalate, buildLowConfidenceEscalationContext } from '../pipeline/low-confidence-escalator.js';
import type { IPipelineContext } from '../pipeline/pipeline-context.js';
import type { PipelineState } from '../pipeline/types.js';
import type { ChatMessage } from '../types.js';

// Mock data for testing
const mockContext = (escalationConfig: any = {}): Partial<IPipelineContext> => ({
  getSettings: () => ({
    escalation: {
      low_confidence_threshold: 0.65,
      auto_escalate_below_threshold: true,
      ...escalationConfig,
    },
  }),
});

const mockMessage = {
  key: { id: 'msg123' },
  pushName: 'Test User',
  body: 'help me book a room',
  instanceId: 'inst123',
  timestamp: Math.floor(Date.now() / 1000),
  fromMe: false,
};

const mockConversation: ChatMessage[] = [
  {
    role: 'user',
    content: 'Hi there',
    timestamp: 1000,
    confidence: 0.95,
  },
  {
    role: 'assistant',
    content: 'Hello! How can I help?',
    timestamp: 1001,
  },
  {
    role: 'user',
    content: 'help me book a room',
    timestamp: 1002,
    confidence: 0.55,
  },
];

const mockState = (): PipelineState => ({
  requestId: 'req123',
  phone: '+601234567890',
  text: 'help me book a room',
  processText: 'help me book a room',
  lang: 'en',
  msg: mockMessage as any,
  convo: {
    messages: mockConversation,
  } as any,
  diaryEvent: {} as any,
  devMetadata: {},
  response: '',
  profileId: 'pelangi',
});

describe('US-373: Low-Confidence Intent Auto-Escalation', () => {
  describe('shouldAutoEscalate', () => {
    it('should escalate when confidence is below threshold (0.6 < 0.65)', () => {
      const state = {
        ...mockState(),
        classificationResult: {
          intent: 'booking_request',
          confidence: 0.6,
        },
      } as any;
      const context = mockContext() as IPipelineContext;

      expect(shouldAutoEscalate(state, context)).toBe(true);
    });

    it('should NOT escalate when confidence meets threshold (0.7 >= 0.65)', () => {
      const state = {
        ...mockState(),
        classificationResult: {
          intent: 'booking_request',
          confidence: 0.7,
        },
      } as any;
      const context = mockContext() as IPipelineContext;

      expect(shouldAutoEscalate(state, context)).toBe(false);
    });

    it('should NOT escalate when confidence equals threshold (0.65 >= 0.65)', () => {
      const state = {
        ...mockState(),
        classificationResult: {
          intent: 'booking_request',
          confidence: 0.65,
        },
      } as any;
      const context = mockContext() as IPipelineContext;

      expect(shouldAutoEscalate(state, context)).toBe(false);
    });

    it('should escalate for very low confidence (0.1 < 0.65)', () => {
      const state = {
        ...mockState(),
        classificationResult: {
          intent: 'unknown',
          confidence: 0.1,
        },
      } as any;
      const context = mockContext() as IPipelineContext;

      expect(shouldAutoEscalate(state, context)).toBe(true);
    });

    it('should NOT escalate when feature is disabled', () => {
      const state = {
        ...mockState(),
        classificationResult: {
          intent: 'booking_request',
          confidence: 0.6,
        },
      } as any;
      const context = mockContext({
        auto_escalate_below_threshold: false,
      }) as IPipelineContext;

      expect(shouldAutoEscalate(state, context)).toBe(false);
    });

    it('should NOT escalate when escalation config is missing', () => {
      const state = {
        ...mockState(),
        classificationResult: {
          intent: 'booking_request',
          confidence: 0.6,
        },
      } as any;
      const context = {
        getSettings: () => ({}),
      } as IPipelineContext;

      expect(shouldAutoEscalate(state, context)).toBe(false);
    });

    it('should use custom threshold from settings', () => {
      const state = {
        ...mockState(),
        classificationResult: {
          intent: 'booking_request',
          confidence: 0.7,
        },
      } as any;
      const context = mockContext({
        low_confidence_threshold: 0.8, // higher threshold
      }) as IPipelineContext;

      // 0.7 < 0.8, so should escalate
      expect(shouldAutoEscalate(state, context)).toBe(true);
    });

    it('should default to threshold of 0.65 when not specified', () => {
      const state = {
        ...mockState(),
        classificationResult: {
          intent: 'booking_request',
          confidence: 0.64,
        },
      } as any;
      const context = {
        getSettings: () => ({
          escalation: {
            auto_escalate_below_threshold: true,
            // no low_confidence_threshold specified
          },
        }),
      } as IPipelineContext;

      expect(shouldAutoEscalate(state, context)).toBe(true);
    });

    it('should handle missing classification result gracefully', () => {
      const state = {
        ...mockState(),
        classificationResult: undefined,
      } as any;
      const context = mockContext() as IPipelineContext;

      expect(shouldAutoEscalate(state, context)).toBe(false);
    });
  });

  describe('buildLowConfidenceEscalationContext', () => {
    it('should build valid escalation context with correct reason', () => {
      const state = {
        ...mockState(),
        classificationResult: {
          intent: 'booking_request',
          confidence: 0.55,
        },
      } as any;
      const context = mockContext() as IPipelineContext;

      const escalationCtx = buildLowConfidenceEscalationContext(state, context);

      expect(escalationCtx.reason).toBe('low_confidence');
      expect(escalationCtx.phone).toBe(mockState().phone);
      expect(escalationCtx.originalMessage).toBe('help me book a room');
    });

    it('should include recent messages in escalation context', () => {
      const state = {
        ...mockState(),
        classificationResult: {
          intent: 'booking_request',
          confidence: 0.55,
        },
      } as any;
      const context = mockContext() as IPipelineContext;

      const escalationCtx = buildLowConfidenceEscalationContext(state, context);

      expect(escalationCtx.recentMessages).toBeDefined();
      expect(Array.isArray(escalationCtx.recentMessages)).toBe(true);
      expect(escalationCtx.recentMessages.length).toBeGreaterThan(0);
      expect(escalationCtx.recentMessages[0]).toContain('user:');
    });

    it('should include confidence metadata in escalation context', () => {
      const state = {
        ...mockState(),
        classificationResult: {
          intent: 'booking_request',
          confidence: 0.55,
        },
      } as any;
      const context = mockContext() as IPipelineContext;

      const escalationCtx = buildLowConfidenceEscalationContext(state, context);

      expect(escalationCtx.metadata?.confidence).toBe(0.55);
      expect(escalationCtx.metadata?.intent).toBe('booking_request');
    });

    it('should include trigger detail with formatted confidence', () => {
      const state = {
        ...mockState(),
        classificationResult: {
          intent: 'room_inquiry',
          confidence: 0.5,
        },
      } as any;
      const context = mockContext() as IPipelineContext;

      const escalationCtx = buildLowConfidenceEscalationContext(state, context);

      expect(escalationCtx.triggerDetail).toContain('room_inquiry');
      expect(escalationCtx.triggerDetail).toContain('0.50');
    });

    it('should use default profile when profileId is not specified', () => {
      const state = {
        ...mockState(),
        profileId: undefined,
        classificationResult: {
          intent: 'booking_request',
          confidence: 0.55,
        },
      } as any;
      const context = mockContext() as IPipelineContext;

      const escalationCtx = buildLowConfidenceEscalationContext(state, context);

      expect(escalationCtx.profileId).toBe('pelangi');
    });

    it('should preserve user push name in escalation context', () => {
      const state = {
        ...mockState(),
        msg: { ...mockMessage, pushName: 'Ahmad' },
        classificationResult: {
          intent: 'booking_request',
          confidence: 0.55,
        },
      } as any;
      const context = mockContext() as IPipelineContext;

      const escalationCtx = buildLowConfidenceEscalationContext(state, context);

      expect(escalationCtx.pushName).toBe('Ahmad');
    });
  });

  describe('Integration scenarios', () => {
    it('should escalate low-confidence booking requests', () => {
      const state = {
        ...mockState(),
        classificationResult: {
          intent: 'booking_request',
          confidence: 0.55,
        },
      } as any;
      const context = mockContext() as IPipelineContext;

      const shouldEscalate = shouldAutoEscalate(state, context);
      expect(shouldEscalate).toBe(true);

      const escalationCtx = buildLowConfidenceEscalationContext(state, context);
      expect(escalationCtx.reason).toBe('low_confidence');
    });

    it('should NOT escalate high-confidence booking requests', () => {
      const state = {
        ...mockState(),
        classificationResult: {
          intent: 'booking_request',
          confidence: 0.85,
        },
      } as any;
      const context = mockContext() as IPipelineContext;

      const shouldEscalate = shouldAutoEscalate(state, context);
      expect(shouldEscalate).toBe(false);
    });

    it('should respect boundary threshold of 0.65', () => {
      const thresholdTests = [
        { confidence: 0.64, shouldEscalate: true },
        { confidence: 0.65, shouldEscalate: false },
        { confidence: 0.66, shouldEscalate: false },
      ];

      thresholdTests.forEach(({ confidence, shouldEscalate }) => {
        const state = {
          ...mockState(),
          classificationResult: {
            intent: 'test_intent',
            confidence,
          },
        } as any;
        const context = mockContext() as IPipelineContext;

        expect(shouldAutoEscalate(state, context)).toBe(shouldEscalate);
      });
    });
  });
});
