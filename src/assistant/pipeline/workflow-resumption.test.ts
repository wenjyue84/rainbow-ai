import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getWorkflowResumptionHint } from './workflow-resumption.js';
import type { PipelineState } from './types.js';
import { configStore } from '../config-store.js';

// Mock configStore and formatter
vi.mock('../config-store.js', () => ({
  configStore: {
    getWorkflows: vi.fn(() => [
      {
        id: 'booking',
        name: 'Booking Flow',
        steps: [
          { id: 'collect_guest_name', name: 'Collect Guest Name' },
          { id: 'collect_guest_email', name: 'Collect Guest Email' },
          { id: 'collect_guest_phone', name: 'Collect Guest Phone' },
          { id: 'collect_checkin_date', name: 'Collect Check-in Date' },
          { id: 'collect_checkout_date', name: 'Collect Check-out Date' },
        ]
      }
    ])
  }
}));

vi.mock('../formatter.js', () => ({
  detectLanguage: vi.fn((text: string) => {
    if (text.includes('hello') || text.includes('hi')) return 'en';
    if (text.includes('你好')) return 'zh';
    if (text.includes('مرحبا')) return 'ms';
    return 'en';
  })
}));

/**
 * Create a mock PipelineState for testing
 */
function createMockState(overrides?: Partial<PipelineState>): PipelineState {
  const now = Date.now();
  return {
    phone: '+60123456789',
    text: 'hello',
    profileId: 'pelangi',
    requestId: 'req-123',
    convo: {
      phone: '+60123456789',
      pushName: 'Test User',
      messages: [],
      language: 'en',
      bookingState: null,
      workflowState: null,
      activeFlow: null,
      unknownCount: 0,
      createdAt: now,
      lastActiveAt: now,
      lastIntent: null,
      lastIntentConfidence: null,
      lastIntentTimestamp: null,
      slots: {},
      repeatCount: 0,
      lastUserMessageAt: now,
    },
    profileConfig: {} as any,
    devMetadata: {
      source: 'llm',
      model: 'haiku',
      usage: { prompt_tokens: 10, completion_tokens: 20 },
      responseTime: 100,
    },
    diaryEvent: {
      intent: null,
      confidence: null,
      action: null,
    },
    traceStart: now,
    processText: 'hello',
    ...overrides,
  } as PipelineState;
}

describe('WorkflowResumption [US-590]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should NOT send resumption hint when workflow state is null', () => {
    const state = createMockState({
      convo: {
        ...createMockState().convo,
        workflowState: null,
      },
    });

    const hint = getWorkflowResumptionHint(state);
    expect(hint).toBeNull();
  });

  it('should NOT send resumption hint when gap is less than 5 minutes', () => {
    const now = Date.now();
    const state = createMockState({
      convo: {
        ...createMockState().convo,
        workflowState: {
          workflowId: 'booking',
          currentStepIndex: 0,
          collectedData: {},
          startedAt: now - 60000, // 1 minute ago
          lastUpdateAt: now - 30000, // 30 seconds ago
        },
      },
    });

    const hint = getWorkflowResumptionHint(state);
    expect(hint).toBeNull();
  });

  it('should send resumption hint when gap is greater than 5 minutes', () => {
    const now = Date.now();
    const state = createMockState({
      text: 'hello',
      convo: {
        ...createMockState().convo,
        workflowState: {
          workflowId: 'booking',
          currentStepIndex: 0,
          collectedData: {},
          startedAt: now - 600000, // 10 minutes ago
          lastUpdateAt: now - 350000, // >5 min 50 sec ago
        },
      },
    });

    const hint = getWorkflowResumptionHint(state);
    expect(hint).not.toBeNull();
    expect(hint).toContain('Collect Guest Name');
  });

  it('should include workflow step name in resumption hint', () => {
    const now = Date.now();
    const state = createMockState({
      text: 'hello',
      convo: {
        ...createMockState().convo,
        workflowState: {
          workflowId: 'booking',
          currentStepIndex: 2, // Check-in phone step
          collectedData: {},
          startedAt: now - 600000,
          lastUpdateAt: now - 350000,
        },
      },
    });

    const hint = getWorkflowResumptionHint(state);
    expect(hint).toContain('Collect Guest Phone');
  });

  it('should include check-in and check-out dates in resumption hint for booking workflow', () => {
    const now = Date.now();
    const state = createMockState({
      text: 'hello',
      convo: {
        ...createMockState().convo,
        workflowState: {
          workflowId: 'booking',
          currentStepIndex: 3, // Check-out date step
          collectedData: {
            check_in_date: 'Apr 15',
            check_out_date: 'Apr 17',
          },
          startedAt: now - 600000,
          lastUpdateAt: now - 350000,
        },
      },
    });

    const hint = getWorkflowResumptionHint(state);
    expect(hint).toContain('Apr 15');
    expect(hint).toContain('Apr 17');
  });

  it('should return null when step index is out of range', () => {
    const now = Date.now();
    const state = createMockState({
      text: 'hello',
      convo: {
        ...createMockState().convo,
        workflowState: {
          workflowId: 'booking',
          currentStepIndex: 999, // Out of range
          collectedData: {},
          startedAt: now - 600000,
          lastUpdateAt: now - 350000,
        },
      },
    });

    const hint = getWorkflowResumptionHint(state);
    expect(hint).toBeNull();
  });

  it('should return null when workflow not found in config', () => {
    const now = Date.now();
    const state = createMockState({
      text: 'hello',
      convo: {
        ...createMockState().convo,
        workflowState: {
          workflowId: 'non-existent-workflow',
          currentStepIndex: 0,
          collectedData: {},
          startedAt: now - 600000,
          lastUpdateAt: now - 350000,
        },
      },
    });

    const hint = getWorkflowResumptionHint(state);
    expect(hint).toBeNull();
  });

  it('should detect language from user text', () => {
    const now = Date.now();
    const state = createMockState({
      text: '你好', // Chinese greeting
      convo: {
        ...createMockState().convo,
        workflowState: {
          workflowId: 'booking',
          currentStepIndex: 0,
          collectedData: {},
          startedAt: now - 600000,
          lastUpdateAt: now - 350000,
        },
      },
    });

    const hint = getWorkflowResumptionHint(state);
    // Should contain Chinese text for booking hint
    expect(hint).toContain('预订'); // Chinese character for booking
  });
});
