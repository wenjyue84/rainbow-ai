/**
 * Tests for US-929: OWASP LLM08 Excessive Agency — tool permission guard
 *
 * Covers:
 * 1. Allowed tool call passes through
 * 2. Disallowed tool call is blocked with reason
 * 3. Low-confidence destructive call is deferred (blocked)
 * 4. High-confidence destructive call is allowed
 * 5. chatWithToolsLoop blocks disallowed tools and returns graceful response
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  checkToolPermission,
  auditToolDispatch,
  blockedToolResult,
  clearPermissionsCache,
  type ToolCallContext
} from '../tool-permission-guard.js';

// ─── Unit tests for checkToolPermission ──────────────────────────────────────

describe('checkToolPermission', () => {
  beforeEach(() => {
    clearPermissionsCache();
  });

  test('allowed tool for known intent returns allowed:true', () => {
    const ctx: ToolCallContext = { intent: 'availability', confidence: 0.9 };
    const result = checkToolPermission('list_units', ctx);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('disallowed tool for intent returns allowed:false with reason', () => {
    // 'greeting' intent only allows: list_units, check_availability, get_dashboard
    const ctx: ToolCallContext = { intent: 'greeting', confidence: 0.95 };
    const result = checkToolPermission('fnb_create_order', ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('fnb_create_order');
    expect(result.reason).toContain('greeting');
  });

  test('destructive tool with low confidence is blocked', () => {
    // checkout_now permits checkout_guest, but confidence must be >= 0.85
    const ctx: ToolCallContext = { intent: 'checkout_now', confidence: 0.70 };
    const result = checkToolPermission('checkout_guest', ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('0.70');
    expect(result.reason).toContain('0.85');
  });

  test('destructive tool with high confidence is allowed', () => {
    const ctx: ToolCallContext = { intent: 'checkout_now', confidence: 0.90 };
    const result = checkToolPermission('checkout_guest', ctx);
    expect(result.allowed).toBe(true);
  });

  test('destructive tool at exact threshold is allowed', () => {
    const ctx: ToolCallContext = { intent: 'checkout_now', confidence: 0.85 };
    const result = checkToolPermission('checkout_guest', ctx);
    expect(result.allowed).toBe(true);
  });

  test('unknown intent falls back to read-only — read-only tool allowed', () => {
    const ctx: ToolCallContext = { intent: 'completely_unknown_intent_xyz', confidence: 0.9 };
    const result = checkToolPermission('list_units', ctx);
    expect(result.allowed).toBe(true);
  });

  test('unknown intent falls back to read-only — write tool blocked', () => {
    const ctx: ToolCallContext = { intent: 'completely_unknown_intent_xyz', confidence: 0.9 };
    const result = checkToolPermission('checkin_guest', ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('completely_unknown_intent_xyz');
  });

  test('ORDER_CONFIRM intent allows fnb_create_order at high confidence', () => {
    const ctx: ToolCallContext = { intent: 'ORDER_CONFIRM', confidence: 0.92 };
    const result = checkToolPermission('fnb_create_order', ctx);
    expect(result.allowed).toBe(true);
  });

  test('ORDER_CONFIRM intent blocks fnb_create_order at low confidence', () => {
    const ctx: ToolCallContext = { intent: 'ORDER_CONFIRM', confidence: 0.60 };
    const result = checkToolPermission('fnb_create_order', ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Destructive');
  });
});

// ─── Unit tests for auditToolDispatch ────────────────────────────────────────

describe('auditToolDispatch', () => {
  test('emits a JSON log entry for allowed dispatch', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx: ToolCallContext = { intent: 'availability', confidence: 0.9 };
    auditToolDispatch('list_units', ctx, { allowed: true });

    expect(logSpy).toHaveBeenCalledOnce();
    const logArg = logSpy.mock.calls[0][0] as string;
    expect(logArg).toContain('[ToolPermissionAudit]');
    const parsed = JSON.parse(logArg.replace('[ToolPermissionAudit] ', ''));
    expect(parsed.toolName).toBe('list_units');
    expect(parsed.outcome).toBe('allowed');
    expect(parsed.intent).toBe('availability');
    logSpy.mockRestore();
  });

  test('emits a JSON log entry for blocked dispatch with reason', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx: ToolCallContext = { intent: 'greeting', confidence: 0.5 };
    auditToolDispatch('checkin_guest', ctx, { allowed: false, reason: 'not permitted for greeting' });

    const logArg = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(logArg.replace('[ToolPermissionAudit] ', ''));
    expect(parsed.outcome).toBe('blocked');
    expect(parsed.reason).toBe('not permitted for greeting');
    logSpy.mockRestore();
  });
});

// ─── Unit tests for blockedToolResult ────────────────────────────────────────

describe('blockedToolResult', () => {
  test('returns a non-error result with explanation text', () => {
    const result = blockedToolResult('cancel_booking', 'not permitted for intent greeting');
    expect(result.isError).toBe(false);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('cancel_booking');
    expect(result.content[0].text).toContain('blocked');
  });
});

// ─── Integration tests via chatWithToolsLoop ──────────────────────────────────

vi.mock('../ai-provider-manager.js', () => ({
  isAIAvailable: vi.fn(() => true),
  getAISettings: vi.fn(() => ({ max_chat_tokens: 500, chat_temperature: 0.3 })),
  getProviders: vi.fn(() => []),
  resolveApiKey: vi.fn(() => 'test-key'),
  getGroqInstance: vi.fn(() => null),
  providerChat: vi.fn(),
  chatWithFallback: vi.fn(),
}));

vi.mock('../config-store.js', () => ({
  configStore: {
    getSettings: vi.fn(() => ({})),
    getRouting: vi.fn(() => ({ availability: {}, general: {} })),
  },
}));

vi.mock('../context-windows.js', () => ({
  getContextWindows: vi.fn(() => ({ combined: 10, reply: 5, classification: 5 })),
}));

import { chatWithToolsLoop } from '../ai-response-generator.js';
import { chatWithFallback } from '../ai-provider-manager.js';
import type { MCPTool, MCPToolResult, ToolHandler } from '../../types/mcp.js';

const mockedChatWithFallback = vi.mocked(chatWithFallback);

const listUnitsTool: MCPTool = {
  name: 'list_units',
  description: 'List hostel units',
  inputSchema: { type: 'object', properties: {} }
};

const checkinTool: MCPTool = {
  name: 'checkin_guest',
  description: 'Check in a guest',
  inputSchema: { type: 'object', properties: { guestId: { type: 'string' } } }
};

const makeHandler = (name: string, text: string): ToolHandler =>
  async (_args: any): Promise<MCPToolResult> => ({
    content: [{ type: 'text', text }],
    isError: false
  });

describe('chatWithToolsLoop + permission guard integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPermissionsCache();
  });

  test('allowed tool is called and response is returned', async () => {
    // First call: AI requests list_units (allowed for 'availability')
    mockedChatWithFallback
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'tc1', function: { name: 'list_units', arguments: '{}' } }]
      } as any)
      // Second call: AI produces final text
      .mockResolvedValueOnce({ content: 'We have 5 units available.', toolCalls: [] } as any);

    const handlers = new Map<string, ToolHandler>([
      ['list_units', makeHandler('list_units', '[{"id":1,"name":"Pod A"}]')]
    ]);

    const result = await chatWithToolsLoop(
      'System prompt',
      [],
      'What units are available?',
      [listUnitsTool],
      handlers,
      undefined,
      undefined,
      { intent: 'availability', confidence: 0.90 }
    );

    expect(result).toBe('We have 5 units available.');
    // Tool handler should have been called (allowed)
    const allCalls = mockedChatWithFallback.mock.calls;
    expect(allCalls.length).toBe(2);
  });

  test('disallowed tool is blocked and AI still returns graceful response', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // First call: AI tries to call checkin_guest (NOT allowed for 'greeting' intent)
    mockedChatWithFallback
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'tc2', function: { name: 'checkin_guest', arguments: '{"guestId":"123"}' } }]
      } as any)
      // Second call: AI gets blocked result, produces fallback response
      .mockResolvedValueOnce({ content: 'I cannot perform that action right now.', toolCalls: [] } as any);

    const handlerSpy = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'checked in' }], isError: false
    });
    const handlers = new Map<string, ToolHandler>([['checkin_guest', handlerSpy]]);

    const result = await chatWithToolsLoop(
      'System prompt',
      [],
      'Hello!',
      [checkinTool],
      handlers,
      undefined,
      undefined,
      { intent: 'greeting', confidence: 0.95 }
    );

    expect(result).toBe('I cannot perform that action right now.');
    // The actual handler must NOT have been called (blocked by permission guard)
    expect(handlerSpy).not.toHaveBeenCalled();
    // Audit log should have been emitted
    const auditCall = logSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('[ToolPermissionAudit]')
    );
    expect(auditCall).toBeDefined();
    const auditEntry = JSON.parse((auditCall![0] as string).replace('[ToolPermissionAudit] ', ''));
    expect(auditEntry.outcome).toBe('blocked');

    logSpy.mockRestore();
  });

  test('low-confidence destructive call is deferred to human (blocked)', async () => {
    // checkout_guest is destructive; confidence 0.70 < 0.85 threshold
    mockedChatWithFallback
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'tc3', function: { name: 'checkout_guest', arguments: '{"guestId":"42"}' } }]
      } as any)
      .mockResolvedValueOnce({ content: 'Please speak to staff to proceed.', toolCalls: [] } as any);

    const handlerSpy = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'checked out' }], isError: false
    });
    const checkoutTool: MCPTool = {
      name: 'checkout_guest',
      description: 'Check out a guest',
      inputSchema: { type: 'object', properties: { guestId: { type: 'string' } } }
    };
    const handlers = new Map<string, ToolHandler>([['checkout_guest', handlerSpy]]);

    const result = await chatWithToolsLoop(
      'System prompt',
      [],
      'Check out room 3',
      [checkoutTool],
      handlers,
      undefined,
      undefined,
      { intent: 'checkout_now', confidence: 0.70 }
    );

    expect(result).toBe('Please speak to staff to proceed.');
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});
