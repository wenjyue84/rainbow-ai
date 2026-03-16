/**
 * US-002: Confidence threshold gating before fallback escalation
 *
 * Verifies that messages classified with confidence below the configurable
 * threshold (settings.confidence_threshold, default 0.5) are rerouted to
 * the "unknown" / fallback intent, and that the gating is logged.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

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
vi.mock('../manglish-normalizer.js', () => ({
  normalizeManglish: (text: string) => text,
}));

import { classifyAndRoute } from '../pipeline/intent-classifier.js';
import type { IPipelineContext } from '../pipeline/pipeline-context.js';
import type { PipelineState, RouterContext } from '../pipeline/types.js';

// ─── Helpers ────────────────────────────────────────────────────────────

function createMockContext(
  classifyConfidence: number,
  classifyIntent: string,
  settingsOverride: Record<string, any> = {},
  overrides: Partial<IPipelineContext> = {}
): IPipelineContext {
  let unknownCount = 0;
  return {
    getSettings: () => ({
      confidence_threshold: 0.5,
      consecutive_fallback_threshold: 2,
      routing_mode: { splitModel: false, tieredPipeline: true },
      fallback: { suggestions: [] },
      tiered_fallback: { tier1: { en: 'Please rephrase.' } },
      ...settingsOverride,
    }),
    getRouting: () => ({
      [classifyIntent]: { action: 'static_reply' },
    }),
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
    buildSystemPrompt: () => 'system prompt',
    getTimeContext: () => '',
    getStaticReply: () => ({ en: 'Static reply' }),
    getStaticReplyImageUrl: () => null,
    getTemplate: (_key: string, _lang: string) => 'template',
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
    applyConversationSummarization: vi.fn(async (msgs: any) => ({
      messages: msgs,
      wasSummarized: false,
      originalCount: msgs.length,
      reducedCount: msgs.length,
    })),
    isAIAvailable: () => true,
    classifyMessageWithContext: vi.fn(async () => ({
      category: classifyIntent as any,
      confidence: classifyConfidence,
      entities: {},
      source: 'fuzzy' as const,
    })),
    classifyAndRespond: vi.fn(async () => ({
      intent: classifyIntent,
      action: 'llm_reply',
      response: 'AI response',
      confidence: classifyConfidence,
      model: 'test-model',
    })),
    classifyOnly: vi.fn(async () => ({ intent: classifyIntent, confidence: classifyConfidence })),
    generateReplyOnly: vi.fn(async () => ({
      response: 'Generated reply',
      confidence: classifyConfidence,
      model: 'test-model',
    })),
    classifyAndRespondWithSmartFallback: vi.fn(async () => ({
      intent: classifyIntent,
      action: 'llm_reply',
      response: 'Fallback response',
      confidence: classifyConfidence,
      model: 'fallback-model',
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

function createMockState(): PipelineState {
  return {
    requestId: 'test-req-1',
    msg: {
      from: '60123456789',
      text: 'test message',
      pushName: 'TestGuest',
      messageId: 'msg1',
      isGroup: false,
      timestamp: Date.now(),
      messageType: 'text',
    },
    phone: '60123456789',
    text: 'test message',
    processText: 'test message',
    foreignLang: null,
    convo: {
      phone: '60123456789',
      pushName: 'TestGuest',
      messages: [],
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
      lastUserMessageAt: null,
    },
    lang: 'en',
    diaryEvent: {} as any,
    devMetadata: { kbFiles: [] },
    response: null,
    profileId: 'pelangi',
    profileConfig: {} as any,
    profileKB: {} as any,
    traceStart: performance.now(),
  };
}

function createMockRouterContext(): RouterContext {
  return {
    sendMessage: vi.fn(async () => {}),
    callAPI: vi.fn(async () => ({})),
    jayLID: null,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('US-002: Confidence threshold gating', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  test('routes to fallback when confidence below default threshold (0.5)', async () => {
    // Classify returns "pricing" with 0.3 confidence (below 0.5 threshold)
    const context = createMockContext(0.3, 'pricing');
    const state = createMockState();
    const routerCtx = createMockRouterContext();

    // Mock pipeline context creation
    vi.doMock('../pipeline/pipeline-context.js', () => ({
      createPipelineContext: vi.fn(async () => context),
    }));

    await classifyAndRoute(state, routerCtx);

    // Should have logged the confidence gating
    const gateLog = consoleSpy.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('[ConfidenceGate]')
    );
    expect(gateLog).toBeTruthy();
    expect(gateLog![0]).toContain('pricing');
    expect(gateLog![0]).toContain('0.30');
    expect(gateLog![0]).toContain('routing to fallback');
  });

  test('does NOT gate when confidence meets threshold', async () => {
    // Classify returns "pricing" with 0.8 confidence (above 0.5 threshold)
    const context = createMockContext(0.8, 'pricing');
    const state = createMockState();
    const routerCtx = createMockRouterContext();

    vi.doMock('../pipeline/pipeline-context.js', () => ({
      createPipelineContext: vi.fn(async () => context),
    }));

    await classifyAndRoute(state, routerCtx);

    // Should NOT have logged confidence gating
    const gateLog = consoleSpy.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('[ConfidenceGate]')
    );
    expect(gateLog).toBeFalsy();
  });

  test('respects custom confidence_threshold from settings', async () => {
    // Classify returns "pricing" with 0.7 confidence
    // Custom threshold is 0.8 → should gate
    const context = createMockContext(0.7, 'pricing', {
      confidence_threshold: 0.8,
    });
    const state = createMockState();
    const routerCtx = createMockRouterContext();

    vi.doMock('../pipeline/pipeline-context.js', () => ({
      createPipelineContext: vi.fn(async () => context),
    }));

    await classifyAndRoute(state, routerCtx);

    const gateLog = consoleSpy.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('[ConfidenceGate]')
    );
    expect(gateLog).toBeTruthy();
    expect(gateLog![0]).toContain('0.80'); // custom threshold
  });

  test('does not double-gate already unknown intents', async () => {
    // Classify returns "unknown" with 0.2 confidence → should NOT gate again
    const context = createMockContext(0.2, 'unknown');
    const state = createMockState();
    const routerCtx = createMockRouterContext();

    vi.doMock('../pipeline/pipeline-context.js', () => ({
      createPipelineContext: vi.fn(async () => context),
    }));

    await classifyAndRoute(state, routerCtx);

    const gateLog = consoleSpy.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('[ConfidenceGate]')
    );
    expect(gateLog).toBeFalsy();
  });

  test('confidence at exact threshold is NOT gated', async () => {
    // Confidence exactly 0.5 with threshold 0.5 → NOT below threshold → keep
    const context = createMockContext(0.5, 'pricing');
    const state = createMockState();
    const routerCtx = createMockRouterContext();

    vi.doMock('../pipeline/pipeline-context.js', () => ({
      createPipelineContext: vi.fn(async () => context),
    }));

    await classifyAndRoute(state, routerCtx);

    const gateLog = consoleSpy.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('[ConfidenceGate]')
    );
    expect(gateLog).toBeFalsy();
  });

  test('logs actual confidence score when gating', async () => {
    const context = createMockContext(0.42, 'booking');
    const state = createMockState();
    const routerCtx = createMockRouterContext();

    vi.doMock('../pipeline/pipeline-context.js', () => ({
      createPipelineContext: vi.fn(async () => context),
    }));

    await classifyAndRoute(state, routerCtx);

    const gateLog = consoleSpy.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('[ConfidenceGate]')
    );
    expect(gateLog).toBeTruthy();
    // Should contain the actual confidence value
    expect(gateLog![0]).toContain('0.42');
    expect(gateLog![0]).toContain('booking');
  });
});
