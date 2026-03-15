/**
 * US-880: Tiered confidence-based fallback with progressive escalation
 *
 * Three-tier system for consecutive unknown/low-confidence messages:
 *   Tier 1 (unknownCount=1): Ask user to rephrase
 *   Tier 2 (unknownCount=2): Show capability quick-reply list
 *   Tier 3 (unknownCount>=3): Escalate to human agent + notify staff
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Must mock DB-dependent modules before importing action-dispatch
vi.mock('../../lib/db.js', () => ({
  pool: { query: vi.fn(() => Promise.resolve()) },
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 1 }])),
      })),
    })),
  },
}));
vi.mock('../../lib/handoff-summary.js', () => ({
  generateAndStoreHandoffSummary: vi.fn(async () => {}),
}));
import { dispatchAction } from '../pipeline/stages/action-dispatch.js';
import type { IPipelineContext } from '../pipeline/pipeline-context.js';
import type { PipelineState } from '../pipeline/types.js';
import type { ClassificationResult } from '../pipeline/stages/tier-classification.js';
import type { RoutingResult } from '../pipeline/stages/routing.js';

// ─── Test helpers ──────────────────────────────────────────────────────────

function createMockContext(
  settingsOverride: Record<string, any> = {},
  overrides: Partial<IPipelineContext> = {}
): IPipelineContext {
  let unknownCount = 0;
  return {
    getSettings: () => ({
      consecutive_fallback_threshold: 2,
      fallback: {
        suggestions: [
          { intent: 'pricing', label: { en: 'Pricing & Rates', ms: 'Harga & Kadar' } },
          { intent: 'checkin_info', label: { en: 'Check-in Info' } },
          { intent: 'facilities_info', label: { en: 'Facilities & WiFi' } },
        ],
      },
      tiered_fallback: {
        tier1: {
          en: "I'm sorry, I didn't quite catch that. Could you rephrase?",
          ms: 'Maaf, saya kurang faham. Boleh anda ulang?',
        },
      },
      ...settingsOverride,
    }),
    getRouting: () => ({}),
    getWorkflows: () => ({ workflows: [] }),
    getWorkflow: () => ({
      escalation: {
        unknown_threshold: 5,
        primary_phone: '123',
        secondary_phone: '456',
        timeout_ms: 600000,
      },
    }),
    getTimeSensitiveIntentSet: () => new Set(),
    guessTopicFiles: () => [],
    buildSystemPrompt: () => '',
    getTimeContext: () => '',
    getStaticReply: () => null,
    getStaticReplyImageUrl: () => null,
    getTemplate: () => '',
    getOrCreate: () => ({
      phone: '60123456789',
      pushName: 'TestGuest',
      messages: [],
      language: 'en' as const,
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
      lastUserMessageAt: null,
    }),
    addMessage: vi.fn(),
    updateBookingState: vi.fn(),
    updateWorkflowState: vi.fn(),
    incrementUnknown: vi.fn(() => ++unknownCount),
    resetUnknown: vi.fn(() => { unknownCount = 0; }),
    updateLastIntent: vi.fn(),
    checkRepeatIntent: () => ({ isRepeat: false, count: 0 }),
    applyConversationSummarization: vi.fn(async (msgs) => ({
      messages: msgs,
      wasSummarized: false,
      originalCount: msgs.length,
      reducedCount: msgs.length,
    })),
    isAIAvailable: () => true,
    classifyMessageWithContext: vi.fn(async () => ({
      category: 'unknown' as any,
      confidence: 0.2,
      entities: {},
      source: 'llm' as const,
    })),
    classifyAndRespond: vi.fn(async () => ({
      intent: 'unknown',
      action: 'llm_reply',
      response: 'I am not sure',
      confidence: 0.2,
    })),
    classifyOnly: vi.fn(async () => ({ intent: 'unknown', confidence: 0.2 })),
    generateReplyOnly: vi.fn(async () => ({ response: 'I am not sure', confidence: 0.2 })),
    classifyAndRespondWithSmartFallback: vi.fn(async () => ({
      intent: 'unknown',
      action: 'llm_reply',
      response: 'I am not sure',
      confidence: 0.2,
    })),
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
    routerContext: {
      sendMessage: vi.fn(async () => {}),
      callAPI: vi.fn(async () => ({})),
      jayLID: null,
    },
    ...overrides,
  } as IPipelineContext;
}

function createMockState(langOverride: 'en' | 'ms' | 'zh' | 'ta' = 'en'): PipelineState {
  return {
    requestId: 'test-req-1',
    msg: {
      from: '60123456789',
      text: 'gibberish xyz',
      pushName: 'TestGuest',
      messageId: 'msg1',
      isGroup: false,
      timestamp: Date.now(),
      messageType: 'text',
    },
    phone: '60123456789',
    text: 'gibberish xyz',
    processText: 'gibberish xyz',
    foreignLang: null,
    convo: {
      phone: '60123456789',
      pushName: 'TestGuest',
      messages: [],
      language: langOverride,
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
      lastUserMessageAt: null,
    },
    lang: langOverride,
    diaryEvent: {} as any,
    devMetadata: { kbFiles: [], source: 'tiered-llm-fallback' },
    response: null,
    profileId: 'pelangi',
    profileConfig: {} as any,
    profileKB: {} as any,
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

function knownResult(): ClassificationResult {
  return {
    intent: 'pricing',
    action: 'static_reply',
    response: 'Our rates are...',
    confidence: 0.92,
    model: 'test-model',
  };
}

function knownRouting(): RoutingResult {
  return {
    routedAction: 'static_reply',
    responseLang: 'en' as const,
    messageType: 'info',
    repeatCheck: { isRepeat: false, count: 0 },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('US-880: Tiered confidence-based fallback', () => {

  describe('Tier 1 — First failure: ask to rephrase', () => {
    test('sends rephrase message on first unknown intent', async () => {
      const context = createMockContext();
      const state = createMockState();

      await dispatchAction(state, unknownResult(), unknownRouting(), context);

      expect(state.response).toContain("didn't quite catch that");
      expect(context.escalateToStaff).not.toHaveBeenCalled();
    });

    test('uses profile-specific Tier 1 message from settings.tiered_fallback.tier1', async () => {
      const context = createMockContext({
        tiered_fallback: {
          tier1: { en: 'CUSTOM REPHRASE MESSAGE' },
        },
      });
      const state = createMockState();

      await dispatchAction(state, unknownResult(), unknownRouting(), context);

      expect(state.response).toBe('CUSTOM REPHRASE MESSAGE');
    });

    test('uses Malay rephrase when convo language is ms', async () => {
      const context = createMockContext();
      const state = createMockState('ms');

      await dispatchAction(state, unknownResult(), unknownRouting(), context);

      expect(state.response).toContain('Maaf');
    });

    test('logs failure_tier=1 to escalationEvents', async () => {
      const context = createMockContext();
      const state = createMockState();

      await dispatchAction(state, unknownResult(), unknownRouting(), context);

      expect(context.logEscalationEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'tiered_fallback',
          count: 1,
          metadata: expect.objectContaining({ failure_tier: 1 }),
        })
      );
    });
  });

  describe('Tier 2 — Second failure: show capability list', () => {
    test('shows capability list on second consecutive unknown', async () => {
      const context = createMockContext();
      const state1 = createMockState();
      const state2 = createMockState();

      await dispatchAction(state1, unknownResult(), unknownRouting(), context);
      await dispatchAction(state2, unknownResult(), unknownRouting(), context);

      // Tier 2 response should be the suggestions list
      expect(state2.response).toContain('Pricing & Rates');
      expect(context.escalateToStaff).not.toHaveBeenCalled();
    });

    test('uses fallback default capabilities when no suggestions configured', async () => {
      const context = createMockContext({
        tiered_fallback: { tier1: { en: 'rephrase please' } },
        // No fallback.suggestions
      });
      const state1 = createMockState();
      const state2 = createMockState();

      await dispatchAction(state1, unknownResult(), unknownRouting(), context);
      await dispatchAction(state2, unknownResult(), unknownRouting(), context);

      // Should have default capabilities text
      expect(state2.response).toContain('Check-in');
      expect(context.escalateToStaff).not.toHaveBeenCalled();
    });

    test('logs failure_tier=2 to escalationEvents', async () => {
      const context = createMockContext();
      const state1 = createMockState();
      const state2 = createMockState();

      await dispatchAction(state1, unknownResult(), unknownRouting(), context);
      await dispatchAction(state2, unknownResult(), unknownRouting(), context);

      const calls = vi.mocked(context.logEscalationEvent).mock.calls;
      const tier2Call = calls.find(([args]) => args.metadata?.failure_tier === 2);
      expect(tier2Call).toBeDefined();
      expect(tier2Call![0]).toMatchObject({
        trigger: 'tiered_fallback',
        count: 2,
        metadata: { failure_tier: 2 },
      });
    });
  });

  describe('Tier 3 — Third failure: human handoff', () => {
    test('escalates to staff on third consecutive unknown', async () => {
      const context = createMockContext();

      for (let i = 0; i < 3; i++) {
        await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
      }

      expect(context.escalateToStaff).toHaveBeenCalledTimes(1);
      expect(context.escalateToStaff).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '60123456789',
          reason: 'unknown_repeated',
          profileId: 'pelangi',
        })
      );
    });

    test('sends handoff message on third failure', async () => {
      const context = createMockContext();
      const states = [createMockState(), createMockState(), createMockState()];

      for (const state of states) {
        await dispatchAction(state, unknownResult(), unknownRouting(), context);
      }

      const lastState = states[2];
      expect(lastState.response).toContain("couldn't help");
    });

    test('resets unknown counter after Tier 3 escalation', async () => {
      const context = createMockContext();

      for (let i = 0; i < 3; i++) {
        await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
      }

      expect(context.resetUnknown).toHaveBeenCalled();
    });

    test('logs failure_tier=3 with summaryContext to escalationEvents', async () => {
      const context = createMockContext();

      for (let i = 0; i < 3; i++) {
        await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
      }

      const calls = vi.mocked(context.logEscalationEvent).mock.calls;
      const tier3Call = calls.find(([args]) => args.metadata?.failure_tier === 3);
      expect(tier3Call).toBeDefined();
      expect(tier3Call![0]).toMatchObject({
        trigger: 'tiered_fallback',
        count: 3,
        metadata: { failure_tier: 3 },
        summaryContext: expect.objectContaining({
          guestName: 'TestGuest',
          escalationReason: expect.stringContaining('3 consecutive'),
        }),
      });
    });

    test('escalation fires on 4th unknown too (not just 3rd)', async () => {
      const context = createMockContext();

      for (let i = 0; i < 4; i++) {
        await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
      }

      // After 3rd: escalate + resetUnknown. 4th starts fresh → Tier 1 again.
      // escalateToStaff should have been called exactly once.
      expect(context.escalateToStaff).toHaveBeenCalledTimes(1);
    });
  });

  describe('Counter reset on successful classification', () => {
    test('resets failure counter when intent is successfully classified', async () => {
      const context = createMockContext();

      // 2 unknowns → Tier 2
      await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);
      await dispatchAction(createMockState(), unknownResult(), unknownRouting(), context);

      // 1 successful classification → reset
      const goodState = createMockState();
      await dispatchAction(goodState, knownResult(), knownRouting(), context);

      expect(context.resetUnknown).toHaveBeenCalled();

      // Next unknown should again be Tier 1 (rephrase), not Tier 3 escalation
      const afterResetState = createMockState();
      await dispatchAction(afterResetState, unknownResult(), unknownRouting(), context);
      expect(context.escalateToStaff).not.toHaveBeenCalled();
      expect(afterResetState.response).toContain("didn't quite catch that");
    });
  });

  describe('Low-confidence responses trigger the same tiers', () => {
    test('low confidence (< 0.4) on first message triggers Tier 1 rephrase', async () => {
      const context = createMockContext();
      const state = createMockState();
      const lowConfResult: ClassificationResult = {
        intent: 'pricing',
        action: 'static_reply',
        response: 'Possibly pricing...',
        confidence: 0.3, // below 0.4 threshold
        model: 'test-model',
      };

      await dispatchAction(state, lowConfResult, unknownRouting(), context);

      expect(state.response).toContain("didn't quite catch that");
      expect(context.escalateToStaff).not.toHaveBeenCalled();
    });
  });
});
