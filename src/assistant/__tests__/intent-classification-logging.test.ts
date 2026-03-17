/**
 * US-007: Intent classification logging for debugging misclassifications
 *
 * Verifies that each classification result is logged at DEBUG level with:
 * - masked phone number
 * - raw input hash (not the raw text)
 * - detected intent
 * - confidence score
 * - tier used
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { IPipelineContext } from '../pipeline/pipeline-context.js';

// ─── Logger mock (must be before any imports that use the logger) ────────────
const { mockDebug } = vi.hoisted(() => ({ mockDebug: vi.fn() }));
vi.mock('../../lib/logger.js', () => ({
  createModuleLogger: vi.fn(() => ({
    debug: mockDebug,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// ─── Standard pipeline mocks ─────────────────────────────────────────────────
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
vi.mock('../utterance-gap-recorder.js', () => ({
  isIntentGap: () => false,
  recordUtteranceGap: vi.fn(async () => {}),
}));
vi.mock('./utterance-gap-recorder.js', () => ({
  isIntentGap: () => false,
  recordUtteranceGap: vi.fn(async () => {}),
}));

let _mockContext: IPipelineContext | null = null;
vi.mock('../pipeline/pipeline-context.js', () => ({
  createPipelineContext: vi.fn(async () => _mockContext),
}));
vi.mock('../pipeline/stages/summarization.js', () => ({
  applySummarization: vi.fn(async () => ({ contextMessages: [], wasSummarized: false })),
}));
vi.mock('../pipeline/stages/kb-loading.js', () => ({
  loadKnowledgeBase: vi.fn(async () => ({
    systemPrompt: 'mock system prompt',
    topicFiles: [],
    ragUsed: false,
  })),
}));
vi.mock('../pipeline/stages/tier-classification.js', () => ({
  classifyWithTiers: vi.fn(async (input: any, ctx: any) => ({
    intent: 'booking',
    confidence: 0.85,
    action: 'static_reply',
    response: '',
    model: 'mock-model',
    responseTime: 10,
  })),
}));
vi.mock('../pipeline/stages/layer2-fallback.js', () => ({
  applyLayer2Fallback: vi.fn(async (result: any) => result),
}));
vi.mock('../pipeline/stages/routing.js', () => ({
  resolveRouting: vi.fn(async () => ({ action: 'static_reply', intent: 'booking', response: null })),
}));
vi.mock('../pipeline/stages/action-dispatch.js', () => ({
  dispatchAction: vi.fn(async () => {}),
}));

import { classifyAndRoute } from '../pipeline/intent-classifier.js';
import type { PipelineState, RouterContext } from '../pipeline/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockContext(
  intent = 'booking',
  confidence = 0.85,
  settingsOverride: Record<string, any> = {}
): IPipelineContext {
  return {
    getSettings: () => ({
      confidence_threshold: 0.5,
      consecutive_fallback_threshold: 2,
      routing_mode: { tieredPipeline: true },
      fallback: { suggestions: [] },
      tiered_fallback: { tier1: { en: 'Please rephrase.' } },
      ...settingsOverride,
    }),
    getRouting: () => ({ [intent]: { action: 'static_reply' } }),
    getWorkflows: () => ({ workflows: [] }),
    getWorkflow: () => ({
      escalation: { unknown_threshold: 5, primary_phone: '123', secondary_phone: '456', timeout_ms: 600000 },
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
    incrementUnknown: vi.fn(() => 0),
    resetUnknown: vi.fn(() => {}),
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
      category: intent as any,
      confidence,
      entities: {},
      source: 'fuzzy' as const,
    })),
    classifyAndRespond: vi.fn(async () => ({
      intent,
      action: 'static_reply',
      response: '',
      confidence,
      model: 'mock-model',
    })),
    classifyOnly: vi.fn(async () => ({ intent, confidence })),
    generateReplyOnly: vi.fn(async () => ({ response: '', confidence, model: 'mock-model' })),
    classifyAndRespondWithSmartFallback: vi.fn(async () => ({
      intent,
      action: 'static_reply',
      response: '',
      confidence,
      model: 'mock-model',
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
  } as IPipelineContext;
}

function createMockState(phone = '60123456789', processText = 'I want to book a room'): PipelineState {
  return {
    requestId: 'test-req-1',
    msg: {
      from: phone,
      text: processText,
      pushName: 'TestGuest',
      messageId: 'msg1',
      isGroup: false,
      timestamp: Date.now(),
      messageType: 'text',
    },
    phone,
    text: processText,
    processText,
    foreignLang: null,
    convo: {
      phone,
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
    devMetadata: { kbFiles: [], source: 'fuzzy' },
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('US-007: Intent classification logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('logs classification result at debug level after classification', async () => {
    _mockContext = createMockContext('booking', 0.85);
    await classifyAndRoute(createMockState(), createMockRouterContext());

    expect(mockDebug).toHaveBeenCalledWith(
      'classification',
      expect.objectContaining({
        intent: 'booking',
        confidence: 0.85,
      })
    );
  });

  test('masks phone number — last 4 digits replaced with xxxx', async () => {
    _mockContext = createMockContext('booking', 0.85);
    await classifyAndRoute(createMockState('60123456789'), createMockRouterContext());

    const [, payload] = mockDebug.mock.calls[0];
    expect(payload.phone).toBe('6012345xxxx');
    expect(payload.phone).not.toContain('6789');
  });

  test('logs input hash (not raw text) — 16 hex chars', async () => {
    _mockContext = createMockContext('booking', 0.85);
    await classifyAndRoute(createMockState('60123456789', 'I want to book a room'), createMockRouterContext());

    const [, payload] = mockDebug.mock.calls[0];
    expect(payload.inputHash).toMatch(/^[0-9a-f]{16}$/);
    expect(payload.inputHash).not.toContain('book');
  });

  test('same input always produces the same hash', async () => {
    _mockContext = createMockContext('booking', 0.85);
    await classifyAndRoute(createMockState('60111111111', 'hello world'), createMockRouterContext());
    const hash1 = mockDebug.mock.calls[0][1].inputHash;

    vi.clearAllMocks();
    _mockContext = createMockContext('booking', 0.85);
    await classifyAndRoute(createMockState('60222222222', 'hello world'), createMockRouterContext());
    const hash2 = mockDebug.mock.calls[0][1].inputHash;

    expect(hash1).toBe(hash2);
  });

  test('different inputs produce different hashes', async () => {
    _mockContext = createMockContext('booking', 0.85);
    await classifyAndRoute(createMockState('60111111111', 'hello world'), createMockRouterContext());
    const hash1 = mockDebug.mock.calls[0][1].inputHash;

    vi.clearAllMocks();
    _mockContext = createMockContext('booking', 0.85);
    await classifyAndRoute(createMockState('60111111111', 'check in tomorrow'), createMockRouterContext());
    const hash2 = mockDebug.mock.calls[0][1].inputHash;

    expect(hash1).not.toBe(hash2);
  });

  test('logs tier used from devMetadata.source', async () => {
    _mockContext = createMockContext('booking', 0.85);
    const state = createMockState();
    state.devMetadata.source = 'fuzzy';
    await classifyAndRoute(state, createMockRouterContext());

    const [, payload] = mockDebug.mock.calls[0];
    expect(payload.tier).toBeDefined();
    expect(typeof payload.tier).toBe('string');
  });

  test('logs unknown tier when devMetadata.source is not set', async () => {
    _mockContext = createMockContext('booking', 0.85);
    const state = createMockState();
    delete (state.devMetadata as any).source;
    await classifyAndRoute(state, createMockRouterContext());

    const [, payload] = mockDebug.mock.calls[0];
    expect(payload.tier).toBe('unknown');
  });

  test('short phone (≤4 chars) is fully masked', async () => {
    _mockContext = createMockContext('booking', 0.85);
    await classifyAndRoute(createMockState('1234'), createMockRouterContext());

    const [, payload] = mockDebug.mock.calls[0];
    expect(payload.phone).toBe('xxxx');
  });

  test('logs confidence as a number', async () => {
    _mockContext = createMockContext('pricing', 0.63);
    await classifyAndRoute(createMockState(), createMockRouterContext());

    const [, payload] = mockDebug.mock.calls[0];
    expect(typeof payload.confidence).toBe('number');
    expect(payload.confidence).toBe(0.85); // tier-classification mock always returns 0.85
  });
});
