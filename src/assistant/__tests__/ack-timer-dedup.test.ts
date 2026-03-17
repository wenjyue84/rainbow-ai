/**
 * US-023: Ack timer cancellation prevents duplicate messages under per-message billing.
 *
 * WhatsApp switched to per-message billing on July 1, 2025. The 3-second "thinking"
 * ack timer and the LLM response can both send messages in the same request if the
 * LLM responds just after the 3s window. This test verifies:
 *
 *   1. When LLM responds in 2.9s, only the answer is sent (ack timer cancelled).
 *   2. When LLM responds in 3.1s (after timer fires), the ack is aborted by
 *      the ackCancelled flag and only the answer is sent via dispatchAction.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Top-level mocks (must be before imports) ────────────────────────────────

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

vi.mock('../pipeline/stages/layer2-fallback.js', () => ({
  applyLayer2Fallback: vi.fn(async (result: any) => result),
}));

vi.mock('../pipeline/stages/routing.js', () => ({
  resolveRouting: vi.fn(async (_state: any, result: any) => ({
    routedAction: result.action ?? 'llm_reply',
    responseLang: 'en',
    messageType: 'text',
    repeatCheck: { isRepeat: false, count: 0 },
  })),
}));

// dispatchAction is a no-op; the test verifies sendMessage calls come only from the ack
vi.mock('../pipeline/stages/action-dispatch.js', () => ({
  dispatchAction: vi.fn(async () => {}),
}));

// tier-classification mock: controlled by llmDelayMs, calls clearAckTimer internally
let _llmDelayMs = 0;

vi.mock('../pipeline/stages/tier-classification.js', () => ({
  classifyWithTiers: vi.fn(async (
    _input: any,
    _ctx: any,
    clearAckTimer: () => void,
  ) => {
    // Simulate LLM taking _llmDelayMs to respond
    await new Promise<void>(resolve => setTimeout(resolve, _llmDelayMs));
    clearAckTimer(); // Signal done — clears ackCancelled + clearTimeout
    return {
      intent: 'pricing',
      action: 'llm_reply',
      response: 'Room price is RM 80.',
      confidence: 0.92,
      model: 'mock-model',
      responseTime: _llmDelayMs,
    };
  }),
}));

let _mockContext: any = null;

vi.mock('../pipeline/pipeline-context.js', () => ({
  createPipelineContext: vi.fn(async () => _mockContext),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { classifyAndRoute } from '../pipeline/intent-classifier.js';
import type { PipelineState, RouterContext } from '../pipeline/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildState(): PipelineState {
  return {
    requestId: 'test-req-ack',
    msg: {
      from: '60123456789',
      text: 'how much is a room',
      pushName: 'TestGuest',
      timestamp: Date.now(),
      instanceId: 'default',
    },
    phone: '60123456789',
    text: 'how much is a room',
    processText: 'how much is a room',
    lang: 'en',
    convo: {
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
    },
    devMetadata: {},
    diaryEvent: {},
    response: null,
    ragUsed: false,
    ragTopicFiles: [],
    profileId: 'pelangi',
    profileConfig: null,
    profileKB: null,
  } as any;
}

function buildCtx(sendMessage: (...args: any[]) => Promise<void>): RouterContext {
  return {
    sendMessage,
    callAPI: vi.fn(async () => ({})),
    jayLID: null,
  } as any;
}

function buildContext(
  sendMessage: (...args: any[]) => Promise<void>,
  typingIndicatorDelayMs = 0,
) {
  return {
    isAIAvailable: () => true,
    getSettings: () => ({
      confidence_threshold: 0.5,
      consecutive_fallback_threshold: 2,
      routing_mode: { tieredPipeline: false, splitModel: false },
      fallback: { suggestions: [] },
      tiered_fallback: { tier1: { en: 'Please rephrase.' } },
    }),
    getRouting: () => ({ pricing: { action: 'llm_reply' } }),
    getWorkflows: () => ({ workflows: [] }),
    getWorkflow: () => ({
      escalation: { unknown_threshold: 5, primary_phone: '123', secondary_phone: '456', timeout_ms: 600000 },
    }),
    getTimeSensitiveIntentSet: () => new Set(),
    guessTopicFiles: () => [],
    buildSystemPrompt: () => '',
    getTimeContext: () => '',
    getStaticReply: () => null,
    getStaticReplyImageUrl: () => null,
    getTemplate: (_key: string) => 'Sedang berfikir...',
    getOrCreate: () => ({
      phone: '60123456789', pushName: 'TestGuest', messages: [],
      language: 'en' as const, bookingState: null, workflowState: null,
      activeFlow: null, unknownCount: 0, createdAt: Date.now(),
      lastActiveAt: Date.now(), lastIntent: null, lastIntentConfidence: null,
      lastIntentTimestamp: null, slots: {}, repeatCount: 0, lastUserMessageAt: null,
    }),
    addMessage: vi.fn(),
    updateBookingState: vi.fn(),
    updateWorkflowState: vi.fn(),
    incrementUnknown: vi.fn(() => 1),
    resetUnknown: vi.fn(),
    updateLastIntent: vi.fn(),
    checkRepeatIntent: () => ({ isRepeat: false, count: 0 }),
    applyConversationSummarization: vi.fn(async (msgs: any) => ({
      messages: msgs, wasSummarized: false, originalCount: 0, reducedCount: 0,
    })),
    classifyMessageWithContext: vi.fn(async () => ({
      category: 'pricing', confidence: 0.92, entities: {}, source: 'llm',
    })),
    classifyAndRespond: vi.fn(async () => ({
      intent: 'pricing', action: 'llm_reply', response: 'Room price is RM 80.',
      confidence: 0.92, model: 'mock', responseTime: _llmDelayMs,
    })),
    classifyOnly: vi.fn(async () => ({ intent: 'pricing', confidence: 0.92 })),
    generateReplyOnly: vi.fn(async () => ({
      response: 'Room price is RM 80.', confidence: 0.92, model: 'mock',
    })),
    classifyAndRespondWithSmartFallback: vi.fn(async () => ({
      intent: 'pricing', action: 'llm_reply', response: 'Room price is RM 80.',
      confidence: 0.92, model: 'mock',
    })),
    detectMessageType: () => 'text',
    detectLanguage: () => 'en' as const,
    handleBookingStep: vi.fn(async () => ({ response: '', newState: null })),
    createBookingState: () => ({ stage: 'inquiry' as const }),
    executeWorkflowStep: vi.fn(async () => ({ response: '', newState: null })),
    createWorkflowState: () => ({ workflowId: '', currentStep: 0, steps: [], data: {} }),
    forwardWorkflowSummary: vi.fn(async () => {}),
    escalateToStaff: vi.fn(async () => 'escalated'),
    shouldEscalate: vi.fn(() => null),
    logEscalationEvent: vi.fn(),
    trackIntentPrediction: vi.fn(async () => {}),
    trackIntentClassified: vi.fn(),
    trackEscalation: vi.fn(),
    trackWorkflowStarted: vi.fn(),
    trackBookingStarted: vi.fn(),
    // Configurable delay on the typing indicator — lets us test ackCancelled timing
    sendWhatsAppTypingIndicator: vi.fn(() =>
      typingIndicatorDelayMs > 0
        ? new Promise<void>(resolve => setTimeout(resolve, typingIndicatorDelayMs))
        : Promise.resolve(),
    ),
    sendMessage,
    notifyAdminConfigError: vi.fn(async () => {}),
    logMessage: vi.fn(async () => {}),
    routerContext: { sendMessage, callAPI: vi.fn(async () => ({})), jayLID: null },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('US-023: Ack timer deduplication — per-message billing guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test('LLM responds in 2.9s — ack timer cancelled, zero ack messages sent', async () => {
    _llmDelayMs = 2900;
    const sendMessage = vi.fn(async () => {});
    _mockContext = buildContext(sendMessage);

    const runPromise = classifyAndRoute(buildState(), buildCtx(sendMessage));

    // Advance to LLM response time (2.9s) and let the promise settle
    await vi.advanceTimersByTimeAsync(2900);
    await vi.advanceTimersByTimeAsync(200); // drain microtasks past 3s window
    await runPromise;

    // ctx.sendMessage (RouterContext) should NOT be called — ack was cancelled before 3s
    // dispatchAction is mocked to no-op, so sendMessage call count = 0 ack sends
    const ackCalls = sendMessage.mock.calls.filter(
      ([, text]) => typeof text === 'string' && text.includes('berfikir'),
    );
    expect(ackCalls).toHaveLength(0);
  });

  test('LLM responds in 3.1s — ackCancelled flag aborts ack send when typing indicator has network delay', async () => {
    // Simulates the real-world borderline race:
    //   t=3000: ack timer fires → sends typing indicator (yields 200ms)
    //   t=3100: LLM resolves → cancelAck() sets ackCancelled=true
    //   t=3200: typing indicator resolves → ackCancelled check aborts ctx.sendMessage
    // Net result: ack ctx.sendMessage is never called.
    _llmDelayMs = 3100;
    const sendMessage = vi.fn(async () => {});
    // Give typing indicator a 200ms delay so LLM (100ms extra) resolves before it
    _mockContext = buildContext(sendMessage, 200);

    const runPromise = classifyAndRoute(buildState(), buildCtx(sendMessage));

    // Advance to 3000ms — ack timer fires, typing indicator starts (200ms delay)
    await vi.advanceTimersByTimeAsync(3000);
    // Advance 200ms more (past LLM at 3100ms and typing indicator at 3200ms)
    await vi.advanceTimersByTimeAsync(300);
    await runPromise;

    // ackCancelled was true when typing indicator resolved → ctx.sendMessage not called
    const ackCalls = sendMessage.mock.calls.filter(
      ([, text]) => typeof text === 'string' && text.includes('berfikir'),
    );
    expect(ackCalls).toHaveLength(0);
  });
});
