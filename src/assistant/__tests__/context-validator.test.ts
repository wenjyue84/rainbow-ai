/**
 * US-267: Null Safety Validator for Conversation Context Pipeline
 *
 * Tests cover:
 * 1. validateConversationContext throws InvalidContextError for null/undefined conversation
 * 2. validateConversationContext throws InvalidContextError for null/undefined messages array
 * 3. Valid conversation passes validation and is returned
 * 4. InvalidContextError carries error_code 'invalid_context' and debug endpoint hint
 * 5. Integration: null context fails before AI inference would be reached
 * 6. Non-throwing checkConversationContext variant returns result object
 * 7. Individual message validation (role, content)
 */

import { describe, test, expect } from 'vitest';
import {
  validateConversationContext,
  InvalidContextError,
  checkConversationContext,
  buildInvalidContextResponse,
} from '../pipeline/context-validator.js';
import type { ConversationState, ChatMessage } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeConvo(overrides?: Partial<ConversationState>): ConversationState {
  return {
    phone: '60123456789',
    pushName: 'TestGuest',
    messages: [
      { role: 'user', content: 'Hello', timestamp: Date.now() },
      { role: 'assistant', content: 'Hi there! How can I help?', timestamp: Date.now() },
    ],
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
    ...overrides,
  };
}

// ─── validateConversationContext — Null / Undefined ConversationState ─

describe('validateConversationContext', () => {
  test('throws InvalidContextError when conversation state is null', () => {
    expect(() => validateConversationContext(null, 'conv-001')).toThrow(
      InvalidContextError,
    );

    try {
      validateConversationContext(null, 'conv-001');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidContextError);
      const e = err as InvalidContextError;
      expect(e.error_code).toBe('invalid_context');
      expect(e.message).toContain('null or undefined');
      expect(e.debugHint).toContain('/admin/debug-conversation:conv-001');
    }
  });

  test('throws InvalidContextError when conversation state is undefined', () => {
    expect(() => validateConversationContext(undefined)).toThrow(
      InvalidContextError,
    );

    try {
      validateConversationContext(undefined);
    } catch (err) {
      const e = err as InvalidContextError;
      expect(e.error_code).toBe('invalid_context');
      expect(e.message).toContain('null or undefined');
      // No conversationId provided — generic hint
      expect(e.debugHint).toContain('/admin/debug-conversation:');
    }
  });

  // ─── Null / Undefined Messages Array ────────────────────────────────

  test('throws InvalidContextError when messages array is null', () => {
    const convo = makeConvo({ messages: null as any });

    expect(() => validateConversationContext(convo)).toThrow(
      InvalidContextError,
    );

    try {
      validateConversationContext(convo);
    } catch (err) {
      const e = err as InvalidContextError;
      expect(e.error_code).toBe('invalid_context');
      expect(e.message).toContain('messages array is null or undefined');
      expect(e.debugHint).toContain('/admin/debug-conversation:');
    }
  });

  test('throws InvalidContextError when messages array is undefined', () => {
    const convo = makeConvo({ messages: undefined as any });

    expect(() => validateConversationContext(convo)).toThrow(
      InvalidContextError,
    );

    try {
      validateConversationContext(convo);
    } catch (err) {
      const e = err as InvalidContextError;
      expect(e.error_code).toBe('invalid_context');
      expect(e.message).toContain('messages array is null or undefined');
    }
  });

  test('throws InvalidContextError when messages is not an array', () => {
    const convo = makeConvo({ messages: 'not an array' as any });

    expect(() => validateConversationContext(convo)).toThrow(
      InvalidContextError,
    );

    try {
      validateConversationContext(convo);
    } catch (err) {
      const e = err as InvalidContextError;
      expect(e.error_code).toBe('invalid_context');
      expect(e.message).toContain('not an array');
    }
  });

  // ─── Individual Message Validation ──────────────────────────────────

  test('throws InvalidContextError when a message in the array is null', () => {
    const convo = makeConvo({
      messages: [
        { role: 'user', content: 'Hello', timestamp: Date.now() },
        null as any,
      ],
    });

    expect(() => validateConversationContext(convo)).toThrow(
      InvalidContextError,
    );

    try {
      validateConversationContext(convo);
    } catch (err) {
      const e = err as InvalidContextError;
      expect(e.error_code).toBe('invalid_context');
      expect(e.message).toContain('index 1');
      expect(e.message).toContain('null');
    }
  });

  test('throws InvalidContextError when a message has invalid role', () => {
    const convo = makeConvo({
      messages: [
        { role: 'system' as any, content: 'Hello', timestamp: Date.now() },
      ],
    });

    expect(() => validateConversationContext(convo)).toThrow(
      InvalidContextError,
    );

    try {
      validateConversationContext(convo);
    } catch (err) {
      const e = err as InvalidContextError;
      expect(e.error_code).toBe('invalid_context');
      expect(e.message).toContain("invalid role 'system'");
    }
  });

  test('throws InvalidContextError when a message has non-string content', () => {
    const convo = makeConvo({
      messages: [
        { role: 'user', content: 42 as any, timestamp: Date.now() },
      ],
    });

    expect(() => validateConversationContext(convo)).toThrow(
      InvalidContextError,
    );

    try {
      validateConversationContext(convo);
    } catch (err) {
      const e = err as InvalidContextError;
      expect(e.error_code).toBe('invalid_context');
      expect(e.message).toContain('non-string content');
    }
  });

  // ─── Valid Context ──────────────────────────────────────────────────

  test('returns the conversation state when context is valid', () => {
    const convo = makeConvo();
    const result = validateConversationContext(convo, 'conv-002');
    expect(result).toBe(convo);
  });

  test('accepts an empty messages array (no messages yet)', () => {
    const convo = makeConvo({ messages: [] });
    const result = validateConversationContext(convo);
    expect(result).toBe(convo);
    expect(result.messages).toEqual([]);
  });

  test('accepts valid multi-message conversation', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hi', timestamp: Date.now() },
      { role: 'assistant', content: 'Hello!', timestamp: Date.now() },
      { role: 'user', content: 'What is the wifi password?', timestamp: Date.now() },
      { role: 'assistant', content: 'The wifi password is PELANGI2024.', timestamp: Date.now() },
    ];
    const convo = makeConvo({ messages });
    const result = validateConversationContext(convo);
    expect(result.messages).toHaveLength(4);
  });
});

// ─── InvalidContextError properties ──────────────────────────────────

describe('InvalidContextError', () => {
  test('error_code is always "invalid_context"', () => {
    const err = new InvalidContextError('test error', 'conv-xyz');
    expect(err.error_code).toBe('invalid_context');
    expect(err.name).toBe('InvalidContextError');
  });

  test('debugHint includes conversationId when provided', () => {
    const err = new InvalidContextError('test', 'conv-123');
    expect(err.debugHint).toBe(
      'Use /admin/debug-conversation:conv-123 to inspect conversation state',
    );
  });

  test('debugHint uses generic placeholder when no conversationId', () => {
    const err = new InvalidContextError('test');
    expect(err.debugHint).toBe(
      'Use /admin/debug-conversation:<conversationId> to inspect conversation state',
    );
  });

  test('is an instance of Error', () => {
    const err = new InvalidContextError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InvalidContextError);
  });
});

// ─── checkConversationContext (non-throwing variant) ──────────────────

describe('checkConversationContext', () => {
  test('returns valid: true for a valid conversation', () => {
    const convo = makeConvo();
    const result = checkConversationContext(convo);
    expect(result.valid).toBe(true);
    expect(result.error_code).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  test('returns valid: false with error_code for null conversation', () => {
    const result = checkConversationContext(null, 'conv-fail');
    expect(result.valid).toBe(false);
    expect(result.error_code).toBe('invalid_context');
    expect(result.message).toContain('null or undefined');
    expect(result.debugHint).toContain('/admin/debug-conversation:conv-fail');
  });

  test('returns valid: false with error_code for null messages', () => {
    const convo = makeConvo({ messages: null as any });
    const result = checkConversationContext(convo);
    expect(result.valid).toBe(false);
    expect(result.error_code).toBe('invalid_context');
    expect(result.message).toContain('messages array is null or undefined');
  });
});

// ─── buildInvalidContextResponse ─────────────────────────────────────

describe('buildInvalidContextResponse', () => {
  test('builds a response object with error_code, message, and debugHint', () => {
    const err = new InvalidContextError('Messages are broken', 'conv-abc');
    const response = buildInvalidContextResponse(err);

    expect(response.error_code).toBe('invalid_context');
    expect(response.message).toBe('Messages are broken');
    expect(response.debugHint).toContain('/admin/debug-conversation:conv-abc');
  });
});

// ─── Integration: null context blocks AI inference path ─────────────

describe('Integration: null context blocks AI inference path', () => {
  test('message with null conversation context fails before AI call', () => {
    // Simulate the pipeline checking context before calling classifyAndRespond
    const convo = null;
    const conversationId = 'phone-60112233445';

    // This is the check that would run before AI inference
    const result = checkConversationContext(convo, conversationId);

    // Verify we catch the error BEFORE reaching AI providers
    expect(result.valid).toBe(false);
    expect(result.error_code).toBe('invalid_context');
    expect(result.message).toBeDefined();
    expect(result.debugHint).toContain('/admin/debug-conversation:');

    // The AI call should never be reached — we can verify by ensuring
    // the response includes the expected error structure
    expect(result.error_code).not.toBe('ai_error'); // not an AI error
    expect(result.error_code).toBe('invalid_context'); // caught pre-inference
  });

  test('message with undefined messages array fails before AI call', () => {
    // Simulate a corrupted ConversationState where messages is undefined
    const convo = makeConvo({ messages: undefined as any });

    // Validate before AI inference
    let caughtBeforeAI = false;
    try {
      validateConversationContext(convo, convo.phone);
      // If we get here, validation passed — AI call would proceed
    } catch (err) {
      caughtBeforeAI = true;
      expect(err).toBeInstanceOf(InvalidContextError);
      const e = err as InvalidContextError;
      expect(e.error_code).toBe('invalid_context');
      expect(e.message).toContain('messages array is null or undefined');
      expect(e.debugHint).toContain('/admin/debug-conversation:');
    }

    // Validation must have caught the error
    expect(caughtBeforeAI).toBe(true);
  });

  test('response to user includes error_code and actionable debug endpoint', () => {
    const convo = null;
    const conversationId = 'conv-12345';

    try {
      validateConversationContext(convo, conversationId);
    } catch (err) {
      const e = err as InvalidContextError;
      const response = buildInvalidContextResponse(e);

      // AC3: Response includes error_code 'invalid_context'
      expect(response.error_code).toBe('invalid_context');

      // AC3: Response includes actionable message suggesting debug endpoint
      expect(response.debugHint).toContain('/admin/debug-conversation:conv-12345');
      expect(response.message).toBeTruthy();
    }
  });
});
