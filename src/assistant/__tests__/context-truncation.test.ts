/**
 * US-307: Conversation Context Truncation Logger with Profile Metrics
 *
 * Integration test verifying that:
 * 1. A 12-turn conversation triggers a WARN log with profile, intent, turn_count
 * 2. The Prometheus counter (conversation_context_truncations_total) is incremented
 * 3. Conversations at or below the CONTEXT_WINDOW_SIZE (10) do NOT trigger warnings
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock fns (available before vi.mock hoisting) ───────────
const { mockCounterAdd, mockWarn } = vi.hoisted(() => ({
  mockCounterAdd: vi.fn(),
  mockWarn: vi.fn(),
}));

// ─── Mock OpenTelemetry metrics ─────────────────────────────────────
vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: vi.fn(() => ({
      createCounter: vi.fn(() => ({ add: mockCounterAdd })),
    })),
  },
}));

// ─── Mock logger ────────────────────────────────────────────────────
vi.mock('../../lib/logger.js', () => ({
  createModuleLogger: vi.fn(() => ({
    warn: mockWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ─── Import after mocks ─────────────────────────────────────────────
import {
  checkContextTruncation,
  CONTEXT_WINDOW_SIZE,
} from '../pipeline/context-manager.js';

describe('US-307: Context truncation logger with profile metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('CONTEXT_WINDOW_SIZE is 10', () => {
    expect(CONTEXT_WINDOW_SIZE).toBe(10);
  });

  it('emits WARN log and increments counter when 12-turn conversation exceeds window', () => {
    const turnCount = 12;
    const profile = 'data-pelangi';
    const intent = 'booking';

    const result = checkContextTruncation(turnCount, profile, intent);

    // Should return true indicating truncation detected
    expect(result).toBe(true);

    // AC1: WARN log emitted with profile, intent, turn_count
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('12'),
      expect.objectContaining({
        profile: 'data-pelangi',
        intent: 'booking',
        turn_count: 12,
      }),
    );

    // AC2: Prometheus counter incremented with correct labels
    expect(mockCounterAdd).toHaveBeenCalledTimes(1);
    expect(mockCounterAdd).toHaveBeenCalledWith(1, {
      profile: 'data-pelangi',
      intent: 'booking',
    });
  });

  it('does NOT warn or increment counter when turns <= CONTEXT_WINDOW_SIZE', () => {
    const result = checkContextTruncation(10, 'data-pelangi', 'greeting');

    expect(result).toBe(false);
    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockCounterAdd).not.toHaveBeenCalled();
  });

  it('does NOT warn for conversations with exactly CONTEXT_WINDOW_SIZE turns', () => {
    const result = checkContextTruncation(CONTEXT_WINDOW_SIZE, 'data-southern', 'wifi');

    expect(result).toBe(false);
    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockCounterAdd).not.toHaveBeenCalled();
  });

  it('warns for conversations with CONTEXT_WINDOW_SIZE + 1 turns', () => {
    const result = checkContextTruncation(CONTEXT_WINDOW_SIZE + 1, 'data-southern', 'pricing');

    expect(result).toBe(true);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining(`${CONTEXT_WINDOW_SIZE + 1}`),
      expect.objectContaining({
        profile: 'data-southern',
        intent: 'pricing',
        turn_count: CONTEXT_WINDOW_SIZE + 1,
      }),
    );
    expect(mockCounterAdd).toHaveBeenCalledTimes(1);
    expect(mockCounterAdd).toHaveBeenCalledWith(1, {
      profile: 'data-southern',
      intent: 'pricing',
    });
  });

  it('tracks different profiles and intents independently via counter labels', () => {
    checkContextTruncation(15, 'data-pelangi', 'complaint');
    checkContextTruncation(20, 'data-southern', 'booking');

    expect(mockCounterAdd).toHaveBeenCalledTimes(2);
    expect(mockCounterAdd).toHaveBeenNthCalledWith(1, 1, {
      profile: 'data-pelangi',
      intent: 'complaint',
    });
    expect(mockCounterAdd).toHaveBeenNthCalledWith(2, 1, {
      profile: 'data-southern',
      intent: 'booking',
    });
  });

  it('includes turn_count in WARN log metadata for observability', () => {
    checkContextTruncation(25, 'data-pelangi', 'facilities');

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('25'),
      expect.objectContaining({ turn_count: 25 }),
    );
  });

  it('log message includes the context window limit', () => {
    checkContextTruncation(12, 'data-pelangi', 'checkin');

    const logMessage = mockWarn.mock.calls[0][0] as string;
    expect(logMessage).toContain(String(CONTEXT_WINDOW_SIZE));
    expect(logMessage).toContain('12');
  });
});
