/**
 * US-880: 3-tier confidence-based fallback with progressive escalation
 *
 * Tier 1: First unrecognized message → friendly rephrase request
 * Tier 2: Second consecutive unrecognized → suggestion list of core capabilities
 * Tier 3: Third consecutive unrecognized → human handoff + staff notification
 * Counter resets when a recognized intent is classified.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { dispatchAction } from '../pipeline/stages/action-dispatch.js';
import type { IPipelineContext } from '../pipeline/pipeline-context.js';
import type { PipelineState } from '../pipeline/types.js';
import type { ClassificationResult } from '../pipeline/stages/tier-classification.js';
import type { RoutingResult } from '../pipeline/stages/routing.js';

const fallbackSuggestions = [
  { intent: 'pricing', label: { en: 'Pricing & Rates', ms: 'Harga & Kadar', zh: '价格与房价' } },
  { intent: 'checkin_info', label: { en: 'Check-in Info', ms: 'Info Check-in', zh: '入住信息' } },
  { intent: 'facilities_info', label: { en: 'Facilities & WiFi', ms: 'Kemudahan & WiFi', zh: '设施与WiFi' } },
  { intent: 'booking', label: { en: 'Make a Booking', ms: 'Buat Tempahan', zh: '预订房间' } },
  { intent: 'location', label: { en: 'Location & Directions', ms: 'Lokasi & Arah', zh: '位置与路线' } },
];

function createMockContext(overrides: Partial<IPipelineContext> = {}): IPipelineContext {
  let unknownCount = 0;
  return {
    getSettings: () => ({
      consecutive_fallback_threshold: 2,
      fallback: { suggestions: fallbackSuggestions },
    }),
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
    traceStart: 0,
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

describe('US-880: 3-tier confidence-based fallback with progressive escalation', () => {
  test('Tier 1: first unrecognized message returns rephrase request', async () => {
    const context = createMockContext();
    const state = createMockState();

    await dispatchAction(state, unknownResult(), unknownRouting(), context);

    // Should ask user to rephrase, NOT show suggestions yet
    expect(state.response).toContain('rephrase');
    expect(state.response).not.toContain('Pricing & Rates');
    expect(context.escalateToStaff).not.toHaveBeenCalled();
  });

  test('Tier 2: second consecutive unrecognized shows suggestion list', async () => {
    const context = createMockContext();

    // 1st unknown — rephrase
    const state1 = createMockState();
    await dispatchAction(state1, unknownResult(), unknownRouting(), context);
    expect(state1.response).toContain('rephrase');

    // 2nd unknown — suggestions
    const state2 = createMockState();
    await dispatchAction(state2, unknownResult(), unknownRouting(), context);
    expect(state2.response).toContain('Pricing & Rates');
    expect(state2.response).toContain('Check-in Info');
    expect(state2.response).toContain('Facilities & WiFi');
    expect(state2.response).toContain('Make a Booking');
    expect(state2.response).toContain('Location & Directions');
    expect(state2.response).toContain('1.');
    expect(state2.response).toContain('5.');

    // Should NOT escalate yet
    expect(context.escalateToStaff).not.toHaveBeenCalled();
  });

  test('Tier 3: third consecutive unrecognized triggers escalation', async () => {
    const context = createMockContext();

    // 1st unknown — rephrase
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    // 2nd unknown — suggestions
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);

    // 3rd unknown — escalation
    const state3 = createMockState();
    await dispatchAction(state3, unknownResult(), unknownRouting(), context);

    expect(context.escalateToStaff).toHaveBeenCalledTimes(1);
    expect(context.logEscalationEvent).toHaveBeenCalledTimes(1);
    expect(state3.response).toContain('connecting you with our team');
  });

  test('three consecutive unknowns: rephrase → suggestions → handoff', async () => {
    const context = createMockContext();

    // Tier 1: rephrase
    const state1 = createMockState();
    await dispatchAction(state1, unknownResult(), unknownRouting(), context);
    expect(state1.response).toContain('rephrase');
    expect(context.escalateToStaff).not.toHaveBeenCalled();

    // Tier 2: suggestions
    const state2 = createMockState();
    await dispatchAction(state2, unknownResult(), unknownRouting(), context);
    expect(state2.response).toContain('Pricing & Rates');
    expect(context.escalateToStaff).not.toHaveBeenCalled();

    // Tier 3: escalation
    const state3 = createMockState();
    await dispatchAction(state3, unknownResult(), unknownRouting(), context);
    expect(context.escalateToStaff).toHaveBeenCalledTimes(1);
    expect(context.logEscalationEvent).toHaveBeenCalledTimes(1);
    expect(state3.response).toContain('connecting you with our team');
  });

  test('counter resets when recognized intent is classified', async () => {
    const context = createMockContext();

    // 1st unknown — rephrase
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    // 2nd unknown — suggestions
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    expect(context.escalateToStaff).not.toHaveBeenCalled();

    // Known intent resets counter
    const knownResult: ClassificationResult = {
      intent: 'wifi', action: 'static_reply', response: 'WiFi password is 12345', confidence: 0.95,
    };
    const knownRouting: RoutingResult = {
      routedAction: 'static_reply', responseLang: 'en', messageType: 'text', repeatCheck: { isRepeat: false, count: 0 },
    };
    await dispatchAction(createMockState(), knownResult, knownRouting, context);
    expect(context.resetUnknown).toHaveBeenCalled();

    // Next unknown after reset → Tier 1 rephrase again (not escalation)
    const state4 = createMockState();
    await dispatchAction(state4, unknownResult(), unknownRouting(), context);
    expect(state4.response).toContain('rephrase');
    expect(context.escalateToStaff).not.toHaveBeenCalled();
  });

  test('suggestions use conversation language (Malay)', async () => {
    const context = createMockContext();

    // 1st unknown (Malay) — Tier 1 rephrase in Malay
    const state1 = createMockState({
      convo: {
        phone: '60123456789', pushName: 'Test', messages: [], language: 'ms' as const,
        bookingState: null, workflowState: null, activeFlow: null, unknownCount: 0,
        createdAt: Date.now(), lastActiveAt: Date.now(), lastIntent: null,
        lastIntentConfidence: null, lastIntentTimestamp: null, slots: {}, repeatCount: 0,
        lastUserMessageAt: null,
      },
    });
    await dispatchAction(state1, unknownResult(), unknownRouting(), context);
    expect(state1.response).toContain('ulangi');

    // 2nd unknown (Malay) — Tier 2 suggestions in Malay
    const state2 = createMockState({
      convo: {
        phone: '60123456789', pushName: 'Test', messages: [], language: 'ms' as const,
        bookingState: null, workflowState: null, activeFlow: null, unknownCount: 0,
        createdAt: Date.now(), lastActiveAt: Date.now(), lastIntent: null,
        lastIntentConfidence: null, lastIntentTimestamp: null, slots: {}, repeatCount: 0,
        lastUserMessageAt: null,
      },
    });
    await dispatchAction(state2, unknownResult(), unknownRouting(), context);
    expect(state2.response).toContain('Harga & Kadar');
    expect(state2.response).toContain('Info Check-in');
    expect(state2.response).toContain('Kemudahan & WiFi');
  });

  test('suggestions configurable via settings.json fallback.suggestions', async () => {
    const customSuggestions = [
      { intent: 'wifi', label: { en: 'WiFi Password', ms: 'Kata Laluan WiFi', zh: 'WiFi密码' } },
      { intent: 'directions', label: { en: 'Directions', ms: 'Arah', zh: '方向' } },
    ];
    const context = createMockContext({
      getSettings: () => ({
        consecutive_fallback_threshold: 2,
        fallback: { suggestions: customSuggestions },
      }),
    });

    // 1st unknown — Tier 1 rephrase
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);

    // 2nd unknown — Tier 2 shows custom suggestions
    const state2 = createMockState();
    await dispatchAction(state2, unknownResult(), unknownRouting(), context);

    expect(state2.response).toContain('WiFi Password');
    expect(state2.response).toContain('Directions');
    expect(state2.response).not.toContain('Pricing & Rates');
  });

  test('no suggestions when fallback.suggestions is empty — Tier 2 keeps LLM response', async () => {
    const context = createMockContext({
      getSettings: () => ({
        consecutive_fallback_threshold: 2,
        fallback: { suggestions: [] },
      }),
    });

    // 1st unknown — Tier 1 rephrase
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);

    // 2nd unknown — Tier 2, but no suggestions → keep original LLM response
    const state2 = createMockState();
    await dispatchAction(state2, unknownResult(), unknownRouting(), context);

    expect(state2.response).toBe('I am not sure how to help with that.');
  });

  test('failure_tier logged in intent_analytics for each tier', async () => {
    const context = createMockContext();

    // Tier 1
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    expect(context.trackIntentPrediction).toHaveBeenCalledWith(
      expect.any(String), '60123456789', 'asdfghjkl', 'unknown', 0.2,
      'failure_tier_1', 'test-model'
    );

    // Tier 2
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    expect(context.trackIntentPrediction).toHaveBeenCalledWith(
      expect.any(String), '60123456789', 'asdfghjkl', 'unknown', 0.2,
      'failure_tier_2', 'test-model'
    );

    // Tier 3
    await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    expect(context.trackIntentPrediction).toHaveBeenCalledWith(
      expect.any(String), '60123456789', 'asdfghjkl', 'unknown', 0.2,
      'failure_tier_3', 'test-model'
    );
  });

  test('escalation event contains failure_tier 3 metadata', async () => {
    const context = createMockContext();

    // Send 3 consecutive unknowns
    for (let i = 0; i < 3; i++) {
      await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
    }

    const logCall = (context.logEscalationEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logCall.trigger).toBe('consecutive_fallback');
    expect(logCall.metadata).toEqual({ failure_tier: 3 });
  });
});
