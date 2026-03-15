/**
 * US-880: Consecutive fallback escalation test (3-tier progressive)
 *
 * Verifies that after N consecutive unknown-intent messages (configurable
 * via consecutive_fallback_threshold), the pipeline triggers human handoff
 * and logs an escalation event with failure_tier metadata.
 *
 * Tier 1: rephrase request
 * Tier 2: suggestion list
 * Tier 3: human handoff (threshold exceeded)
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { dispatchAction } from '../pipeline/stages/action-dispatch.js';
import type { IPipelineContext } from '../pipeline/pipeline-context.js';
import type { PipelineState } from '../pipeline/types.js';
import type { ClassificationResult } from '../pipeline/stages/tier-classification.js';
import type { RoutingResult } from '../pipeline/stages/routing.js';

function createMockContext(overrides: Partial<IPipelineContext> = {}): IPipelineContext {
  let unknownCount = 0;
  return {
    getSettings: () => ({ consecutive_fallback_threshold: 2 }),
    getRouting: () => ({}),
    getWorkflows: () => ({ workflows: [] }),
    getWorkflow: () => ({ escalation: { unknown_threshold: 5, primary_phone: '123', secondary_phone: '456', timeout_ms: 600000 } }),
    getTimeSensitiveIntentSet: () => new Set(),
    guessTopicFiles: () => [],
    buildSystemPrompt: () => '',
    getTimeContext: () => '',
    getStaticReply: () => null,
    getStaticReplyImageUrl: () => null,
    getTemplate: () => '',
    getOrCreate: () => ({
      phone: '60123456789', pushName: 'Test', messages: [], language: 'en' as const,
      bookingState: null, workflowState: null, activeFlow: null, unknownCount: 0,
      createdAt: Date.now(), lastActiveAt: Date.now(), lastIntent: null,
      lastIntentConfidence: null, lastIntentTimestamp: null, slots: {}, repeatCount: 0,
      lastUserMessageAt: null,
    }),
    addMessage: vi.fn(),
    updateBookingState: vi.fn(),
    updateWorkflowState: vi.fn(),
    incrementUnknown: vi.fn(() => ++unknownCount),
    resetUnknown: vi.fn(() => { unknownCount = 0; }),
    updateLastIntent: vi.fn(),
    checkRepeatIntent: () => ({ isRepeat: false, count: 0 }),
    applyConversationSummarization: vi.fn(async (msgs) => ({ messages: msgs, wasSummarized: false, originalCount: msgs.length, reducedCount: msgs.length })),
    isAIAvailable: () => true,
    classifyMessageWithContext: vi.fn(async () => ({ category: 'unknown' as any, confidence: 0.2, entities: {}, source: 'llm' as const })),
    classifyAndRespond: vi.fn(async () => ({ intent: 'unknown', action: 'llm_reply', response: 'I am not sure', confidence: 0.2 })),
    classifyOnly: vi.fn(async () => ({ intent: 'unknown', confidence: 0.2 })),
    generateReplyOnly: vi.fn(async () => ({ response: 'I am not sure', confidence: 0.2 })),
    classifyAndRespondWithSmartFallback: vi.fn(async () => ({ intent: 'unknown', action: 'llm_reply', response: 'I am not sure', confidence: 0.2 })),
    detectMessageType: () => 'text',
    detectLanguage: () => 'en' as const,
    handleBookingStep: vi.fn(async () => ({ response: '', newState: null })),
    createBookingState: () => ({ stage: 'inquiry' as const }),
    executeWorkflowStep: vi.fn(async () => ({ response: '', newState: null })),
    createWorkflowState: () => ({ workflowId: '', currentStep: 0, steps: [], data: {} } as any),
    forwardWorkflowSummary: vi.fn(async () => {}),
    escalateToStaff: vi.fn(async () => 'escalated'),
    shouldEscalate: vi.fn(() => null),
    logEscalationEvent: vi.fn(),
    trackIntentPrediction: vi.fn(async () => {}),
    trackIntentClassified: vi.fn(),
    trackEscalation: vi.fn(),
    trackWorkflowStarted: vi.fn(),
    trackBookingStarted: vi.fn(),
    sendWhatsAppTypingIndicator: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
    notifyAdminConfigError: vi.fn(async () => {}),
    logMessage: vi.fn(async () => {}),
    routerContext: { sendMessage: vi.fn(async () => {}), callAPI: vi.fn(async () => ({})), jayLID: null },
    ...overrides,
  } as IPipelineContext;
}

function createMockState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    requestId: 'test-req-1',
    msg: { from: '60123456789', text: 'asdfghjkl', pushName: 'Test', messageId: 'msg1', isGroup: false, timestamp: Date.now(), messageType: 'text' },
    phone: '60123456789',
    text: 'asdfghjkl',
    processText: 'asdfghjkl',
    foreignLang: null,
    convo: {
      phone: '60123456789', pushName: 'Test', messages: [], language: 'en' as const,
      bookingState: null, workflowState: null, activeFlow: null, unknownCount: 0,
      createdAt: Date.now(), lastActiveAt: Date.now(), lastIntent: null,
      lastIntentConfidence: null, lastIntentTimestamp: null, slots: {}, repeatCount: 0,
      lastUserMessageAt: null,
    },
    lang: 'en' as const,
    diaryEvent: {} as any,
    devMetadata: { kbFiles: [], source: 'tiered-llm-fallback' },
    response: null,
    profileId: 'pelangi',
    profileConfig: {} as any,
    profileKB: {} as any,
    ...overrides,
  };
}

function unknownResult(): ClassificationResult {
  return {
    intent: 'unknown',
    action: 'llm_reply',
    response: 'I am not sure how to help with that.',
    confidence: 0.2,
    model: 'test-model',
  };
}

function unknownRouting(): RoutingResult {
  return {
    routedAction: 'llm_reply',
    responseLang: 'en' as const,
    messageType: 'text',
    repeatCheck: { isRepeat: false, count: 0 },
  };
}

describe('US-880: Consecutive fallback escalation (3-tier)', () => {
  test('Tier 1 and 2 do NOT trigger escalation', async () => {
    const context = createMockContext();

    // 1st unknown — Tier 1 rephrase, no escalation
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    expect(context.escalateToStaff).not.toHaveBeenCalled();
    expect(context.logEscalationEvent).not.toHaveBeenCalled();

    // 2nd unknown — Tier 2 suggestions, still no escalation
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    expect(context.escalateToStaff).not.toHaveBeenCalled();
    expect(context.logEscalationEvent).not.toHaveBeenCalled();
  });

  test('Tier 3 IS triggered on 3rd consecutive unknown (threshold=2)', async () => {
    const context = createMockContext();

    // Send 3 consecutive unknowns
    for (let i = 0; i < 3; i++) {
      const state = createMockState();
      await dispatchAction(state, unknownResult(), unknownRouting(), context);
    }

    // Escalation should have fired on the 3rd
    expect(context.escalateToStaff).toHaveBeenCalledTimes(1);
    expect(context.logEscalationEvent).toHaveBeenCalledTimes(1);
    expect(context.logEscalationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        jid: '60123456789',
        profileId: 'pelangi',
        trigger: 'consecutive_fallback',
        count: 3,
        metadata: { failure_tier: 3 },
        summaryContext: expect.objectContaining({
          guestName: 'Test',
          escalationReason: expect.stringContaining('consecutive fallback'),
        }),
      })
    );
  });

  test('counter resets when a known intent succeeds', async () => {
    const context = createMockContext();

    // 2 unknowns (Tier 1 + Tier 2)
    for (let i = 0; i < 2; i++) {
      await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    }
    expect(context.escalateToStaff).not.toHaveBeenCalled();

    // Known intent resets counter
    const knownResult: ClassificationResult = {
      intent: 'wifi', action: 'static_reply', response: 'WiFi password is 12345', confidence: 0.95,
    };
    const knownRouting: RoutingResult = {
      routedAction: 'static_reply', responseLang: 'en', messageType: 'text', repeatCheck: { isRepeat: false, count: 0 },
    };
    await dispatchAction(createMockState(), knownResult, knownRouting, context);

    // Reset should have been called
    expect(context.resetUnknown).toHaveBeenCalled();

    // 2 more unknowns after reset — should NOT escalate (counter was reset)
    for (let i = 0; i < 2; i++) {
      await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    }
    expect(context.escalateToStaff).not.toHaveBeenCalled();
  });

  test('escalation event contains correct trigger type and failure_tier', async () => {
    const context = createMockContext();

    for (let i = 0; i < 3; i++) {
      await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    }

    const logCall = (context.logEscalationEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logCall.trigger).toBe('consecutive_fallback');
    expect(logCall.metadata).toEqual({ failure_tier: 3 });
  });

  test('response is handoff message when Tier 3 triggers', async () => {
    const context = createMockContext();
    let lastState: PipelineState | null = null;

    for (let i = 0; i < 3; i++) {
      lastState = createMockState();
      await dispatchAction(lastState, unknownResult(), unknownRouting(), context);
    }

    // The response on the 3rd message should be the handoff message
    expect(lastState!.response).toContain('connecting you with our team');
  });

  test('custom threshold from settings is respected', async () => {
    // Set threshold to 4
    const context = createMockContext({
      getSettings: () => ({ consecutive_fallback_threshold: 4 }),
    });

    // 4 unknowns — no escalation yet (need > 4)
    for (let i = 0; i < 4; i++) {
      await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    }
    expect(context.escalateToStaff).not.toHaveBeenCalled();

    // 5th unknown triggers Tier 3 escalation
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    expect(context.escalateToStaff).toHaveBeenCalledTimes(1);
  });

  test('failure_tier tracked via trackIntentPrediction for all tiers', async () => {
    const context = createMockContext();

    // Tier 1
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    expect(context.trackIntentPrediction).toHaveBeenLastCalledWith(
      expect.any(String), '60123456789', 'asdfghjkl', 'unknown', 0.2,
      'failure_tier_1', 'test-model'
    );

    // Tier 2
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    expect(context.trackIntentPrediction).toHaveBeenLastCalledWith(
      expect.any(String), '60123456789', 'asdfghjkl', 'unknown', 0.2,
      'failure_tier_2', 'test-model'
    );

    // Tier 3
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    expect(context.trackIntentPrediction).toHaveBeenLastCalledWith(
      expect.any(String), '60123456789', 'asdfghjkl', 'unknown', 0.2,
      'failure_tier_3', 'test-model'
    );
  });
});
