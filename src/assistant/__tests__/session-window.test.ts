import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isWithin24HourWindow } from '../session-window.js';
import type { ConversationState } from '../types.js';

function makeConvo(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    phone: '60123456789',
    pushName: 'Test',
    messages: [],
    language: 'en',
    bookingState: null,
    workflowState: null,
    unknownCount: 0,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    lastIntent: null,
    lastIntentConfidence: null,
    lastIntentTimestamp: null,
    slots: {},
    repeatCount: 0,
    lastUserMessageAt: null,
    ...overrides,
  };
}

describe('isWithin24HourWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-13T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false when no user message has been received', () => {
    const convo = makeConvo({ lastUserMessageAt: null });
    expect(isWithin24HourWindow(convo)).toBe(false);
  });

  it('returns true when last user message was 1 hour ago', () => {
    const oneHourAgo = Date.now() - 3_600_000;
    const convo = makeConvo({ lastUserMessageAt: oneHourAgo });
    expect(isWithin24HourWindow(convo)).toBe(true);
  });

  it('returns true when last user message was 23 hours ago', () => {
    const twentyThreeHoursAgo = Date.now() - 23 * 3_600_000;
    const convo = makeConvo({ lastUserMessageAt: twentyThreeHoursAgo });
    expect(isWithin24HourWindow(convo)).toBe(true);
  });

  it('returns false when last user message was exactly 24 hours ago', () => {
    const twentyFourHoursAgo = Date.now() - 86_400_000;
    const convo = makeConvo({ lastUserMessageAt: twentyFourHoursAgo });
    expect(isWithin24HourWindow(convo)).toBe(false);
  });

  it('returns false when last user message was 25 hours ago', () => {
    const twentyFiveHoursAgo = Date.now() - 25 * 3_600_000;
    const convo = makeConvo({ lastUserMessageAt: twentyFiveHoursAgo });
    expect(isWithin24HourWindow(convo)).toBe(false);
  });

  it('returns true when user message was just now', () => {
    const convo = makeConvo({ lastUserMessageAt: Date.now() });
    expect(isWithin24HourWindow(convo)).toBe(true);
  });
});
