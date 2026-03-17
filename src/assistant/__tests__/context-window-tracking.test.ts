/**
 * US-004: Context window tracking tests
 *
 * Verifies that:
 * 1. History is tracked per phone number
 * 2. Window size is configurable (reads from intent config)
 * 3. Old messages are pruned when window size is exceeded
 * 4. History is reset after configurable inactivity timeout
 * 5. Memory footprint is bounded
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock dependencies ───────────────────────────────────────────────

// Mock state-persistence to avoid DB calls
vi.mock('../state-persistence.js', () => ({
  initStatePersistence: vi.fn().mockResolvedValue(undefined),
  loadActiveStates: vi.fn().mockResolvedValue([]),
  schedulePersist: vi.fn(),
  deletePersistedState: vi.fn().mockResolvedValue(undefined),
}));

// Mock invariant to avoid import issues
vi.mock('../../lib/invariant.js', () => ({
  softInvariant: vi.fn(),
}));

// Mock formatter for language detection
vi.mock('../formatter.js', () => ({
  detectLanguage: vi.fn().mockReturnValue('en'),
}));

// Controllable intent config mock
let _mockIntentConfig = {
  tiers: {
    tier1_emergency: { enabled: true, contextMessages: 0 },
    tier2_fuzzy: { enabled: true, contextMessages: 3, threshold: 0.80 },
    tier3_semantic: { enabled: true, contextMessages: 5, threshold: 0.67 },
    tier4_llm: { enabled: true, contextMessages: 5 },
  },
  conversationState: {
    trackLastIntent: true,
    trackSlots: true,
    maxHistoryMessages: 5,   // default 5 for tests
    contextTTL: 30,           // 30 minutes
  },
};

vi.mock('../intent-config.js', () => ({
  getIntentConfig: vi.fn(() => _mockIntentConfig),
  loadIntentTiersFromFile: vi.fn(),
}));

// ─── Import after mocks ──────────────────────────────────────────────

import {
  getOrCreate,
  addMessage,
  getMessages,
  clearConversation,
  getContextWindowConfig,
} from '../conversation.js';

describe('US-004: Context window tracking', () => {
  const phone = '60123456789';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T10:00:00Z'));

    // Reset to default test config
    _mockIntentConfig = {
      ..._mockIntentConfig,
      conversationState: {
        trackLastIntent: true,
        trackSlots: true,
        maxHistoryMessages: 5,
        contextTTL: 30,
      },
    };

    clearConversation(phone);
  });

  afterEach(() => {
    vi.useRealTimers();
    clearConversation(phone);
  });

  // ─── 1. History tracked per phone ─────────────────────────────────

  it('tracks history separately per phone number', () => {
    const phone2 = '60987654321';

    getOrCreate(phone, 'Alice');
    getOrCreate(phone2, 'Bob');

    addMessage(phone, 'user', 'Hello from Alice');
    addMessage(phone2, 'user', 'Hello from Bob');
    addMessage(phone, 'assistant', 'Hi Alice!');

    expect(getMessages(phone)).toHaveLength(2);
    expect(getMessages(phone2)).toHaveLength(1);
    expect(getMessages(phone)[0].content).toBe('Hello from Alice');
    expect(getMessages(phone2)[0].content).toBe('Hello from Bob');

    clearConversation(phone2);
  });

  // ─── 2. History passed as context (window size respected) ─────────

  it('returns configurable number of messages via getMessages', () => {
    getOrCreate(phone, 'Test');

    for (let i = 1; i <= 4; i++) {
      addMessage(phone, 'user', `Message ${i}`);
      addMessage(phone, 'assistant', `Reply ${i}`);
    }

    const msgs = getMessages(phone);
    expect(msgs).toHaveLength(5); // window is 5, only last 5 kept after 8 messages
  });

  // ─── 3. Old messages pruned at window size ─────────────────────────

  it('prunes old messages to stay within configurable window size', () => {
    _mockIntentConfig.conversationState.maxHistoryMessages = 3;

    getOrCreate(phone, 'Test');

    addMessage(phone, 'user', 'msg 1');
    addMessage(phone, 'user', 'msg 2');
    addMessage(phone, 'user', 'msg 3');
    addMessage(phone, 'user', 'msg 4'); // should push out msg 1

    const msgs = getMessages(phone);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].content).toBe('msg 2');
    expect(msgs[2].content).toBe('msg 4');
  });

  it('keeps exactly N messages when window size is 1', () => {
    _mockIntentConfig.conversationState.maxHistoryMessages = 1;

    getOrCreate(phone, 'Test');
    addMessage(phone, 'user', 'old');
    addMessage(phone, 'user', 'new');

    const msgs = getMessages(phone);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('new');
  });

  // ─── 4. History cleared after inactivity timeout ──────────────────

  it('clears message history on new message after inactivity timeout', () => {
    _mockIntentConfig.conversationState.contextTTL = 30; // 30 minutes

    getOrCreate(phone, 'Test');
    addMessage(phone, 'user', 'before idle');
    addMessage(phone, 'assistant', 'reply before idle');

    expect(getMessages(phone)).toHaveLength(2);

    // Advance time past inactivity TTL (30 min + 1 sec)
    vi.advanceTimersByTime(31 * 60 * 1000);

    // New user message should reset context
    addMessage(phone, 'user', 'after idle restart');

    const msgs = getMessages(phone);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('after idle restart');
  });

  it('does NOT clear history if inactivity is within TTL', () => {
    _mockIntentConfig.conversationState.contextTTL = 30;

    getOrCreate(phone, 'Test');
    addMessage(phone, 'user', 'first message');
    addMessage(phone, 'assistant', 'first reply');

    // Advance time within TTL (20 minutes)
    vi.advanceTimersByTime(20 * 60 * 1000);

    addMessage(phone, 'user', 'still active');

    const msgs = getMessages(phone);
    expect(msgs).toHaveLength(3);
  });

  it('does not reset on assistant message even after passing context TTL', () => {
    // contextTTL = 30 min, StateManager session TTL = 1 hour
    // Use 35 min advance: beyond contextTTL but within session lifetime
    _mockIntentConfig.conversationState.contextTTL = 30;

    getOrCreate(phone, 'Test');
    addMessage(phone, 'user', 'user msg');

    vi.advanceTimersByTime(35 * 60 * 1000); // 35 min: beyond contextTTL but session alive

    // Assistant message (e.g. async notification) should NOT clear context
    // because only *user* messages trigger the inactivity check
    addMessage(phone, 'assistant', 'async notification');

    const msgs = getMessages(phone);
    expect(msgs).toHaveLength(2); // both preserved
  });

  // ─── 5. Memory footprint bounded ──────────────────────────────────

  it('memory footprint stays bounded regardless of how many messages are added', () => {
    _mockIntentConfig.conversationState.maxHistoryMessages = 10;

    getOrCreate(phone, 'Test');

    for (let i = 0; i < 100; i++) {
      addMessage(phone, 'user', `message ${i}`);
    }

    const msgs = getMessages(phone);
    expect(msgs.length).toBeLessThanOrEqual(10);
  });

  // ─── 6. getContextWindowConfig() exposes current config ───────────

  it('getContextWindowConfig returns current configurable values', () => {
    _mockIntentConfig.conversationState.maxHistoryMessages = 7;
    _mockIntentConfig.conversationState.contextTTL = 15;

    const config = getContextWindowConfig();
    expect(config.maxMessages).toBe(7);
    expect(config.inactivityTTLMs).toBe(15 * 60 * 1000);
  });

  it('getContextWindowConfig defaults to safe values if config missing', () => {
    // Simulate missing config by returning empty conversationState
    (_mockIntentConfig as any).conversationState = {};

    const config = getContextWindowConfig();
    expect(config.maxMessages).toBe(20); // DEFAULT_MAX_MESSAGES
    expect(config.inactivityTTLMs).toBe(30 * 60 * 1000); // 30 min default
  });
});
