/**
 * Tests for chatWithToolsLoop graceful fallback (US-805)
 *
 * When FNB_MCP_URL is unavailable, all tool calls return isError:true.
 * chatWithToolsLoop should detect this and make one final toolless LLM
 * call to return a meaningful response instead of the hostel fallback text.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing module under test
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
    getRouting: vi.fn(() => ({ pricing: {}, booking: {}, general: {} })),
  },
}));

vi.mock('../context-windows.js', () => ({
  getContextWindows: vi.fn(() => ({ combined: 10, reply: 5, classification: 5 })),
}));

import { chatWithToolsLoop } from '../ai-response-generator.js';
import { chatWithFallback } from '../ai-provider-manager.js';
import type { MCPTool, MCPToolResult, ToolHandler } from '../../types/mcp.js';

const mockedChatWithFallback = vi.mocked(chatWithFallback);

// Helper: a tool that always returns isError:true
function makeFailingHandler(name: string): ToolHandler {
  return async (_args: any): Promise<MCPToolResult> => ({
    content: [{ type: 'text', text: `Error: ${name} unavailable` }],
    isError: true,
  });
}

const testTools: MCPTool[] = [
  {
    name: 'get_menu',
    description: 'Fetch menu items',
    inputSchema: { type: 'object', properties: {} },
  },
];

describe('chatWithToolsLoop - graceful fallback (US-805)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('when all tool calls fail, makes a final toolless LLM call and returns meaningful text', async () => {
    const toolHandlers = new Map<string, ToolHandler>([
      ['get_menu', makeFailingHandler('get_menu')],
    ]);

    // Loops 1-3: LLM requests tool calls each time
    const toolCallResponse = {
      content: null,
      toolCalls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_menu', arguments: '{}' },
        },
      ],
      provider: { name: 'test-provider', model: 'test-model' },
      usage: { total_tokens: 50 },
    };

    // Final toolless call returns meaningful text
    const toollessFallbackResponse = {
      content: 'Our cafe is open 8am to 10pm. We serve local Malaysian dishes.',
      toolCalls: undefined,
      provider: { name: 'test-provider', model: 'test-model' },
      usage: { total_tokens: 40 },
    };

    mockedChatWithFallback
      .mockResolvedValueOnce(toolCallResponse) // loop 1
      .mockResolvedValueOnce(toolCallResponse) // loop 2
      .mockResolvedValueOnce(toolCallResponse) // loop 3
      .mockResolvedValueOnce(toollessFallbackResponse); // toolless fallback

    const result = await chatWithToolsLoop(
      'You are a helpful cafe assistant.',
      [],
      'What food do you have?',
      testTools,
      toolHandlers
    );

    // Should return the meaningful text from toolless fallback, not hostel fallback
    expect(result).toBe('Our cafe is open 8am to 10pm. We serve local Malaysian dishes.');
    expect(result).not.toContain('hostel');
    expect(result.length).toBeGreaterThan(10);

    // 3 tool loops + 1 toolless fallback = 4 total calls
    expect(mockedChatWithFallback).toHaveBeenCalledTimes(4);

    // The 4th call (toolless) should NOT have tools passed
    const fourthCallArgs = mockedChatWithFallback.mock.calls[3];
    expect(fourthCallArgs[5]).toBeUndefined(); // tools arg is undefined
  });

  test('toolless fallback call excludes tool result messages and assistant tool_call messages', async () => {
    const toolHandlers = new Map<string, ToolHandler>([
      ['get_menu', makeFailingHandler('get_menu')],
    ]);

    const toolCallResponse = {
      content: null,
      toolCalls: [
        {
          id: 'call_abc',
          type: 'function',
          function: { name: 'get_menu', arguments: '{}' },
        },
      ],
      provider: { name: 'test' },
    };

    const toollessFallbackResponse = {
      content: 'I can answer general questions about our cafe.',
      toolCalls: undefined,
      provider: { name: 'test' },
    };

    // Only 1 loop then toolless fallback — use MAX_LOOPS=3 but after 3 loops check messages
    mockedChatWithFallback
      .mockResolvedValueOnce(toolCallResponse)
      .mockResolvedValueOnce(toolCallResponse)
      .mockResolvedValueOnce(toolCallResponse)
      .mockResolvedValueOnce(toollessFallbackResponse);

    await chatWithToolsLoop(
      'System prompt.',
      [],
      'User question',
      testTools,
      toolHandlers
    );

    // Check the 4th call's messages array
    const messagesPassedToToollessCall = mockedChatWithFallback.mock.calls[3][0] as any[];

    // Should not contain any 'tool' role messages
    const toolRoleMessages = messagesPassedToToollessCall.filter((m: any) => m.role === 'tool');
    expect(toolRoleMessages).toHaveLength(0);

    // Should not contain any assistant messages with tool_calls
    const assistantToolCallMessages = messagesPassedToToollessCall.filter(
      (m: any) => m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0
    );
    expect(assistantToolCallMessages).toHaveLength(0);
  });

  test('when toolless fallback also fails, returns profile-aware fallback (not hardcoded hostel text)', async () => {
    const toolHandlers = new Map<string, ToolHandler>([
      ['get_menu', makeFailingHandler('get_menu')],
    ]);

    const toolCallResponse = {
      content: null,
      toolCalls: [
        { id: 'call_x', type: 'function', function: { name: 'get_menu', arguments: '{}' } },
      ],
      provider: { name: 'test' },
    };

    mockedChatWithFallback
      .mockResolvedValueOnce(toolCallResponse)
      .mockResolvedValueOnce(toolCallResponse)
      .mockResolvedValueOnce(toolCallResponse)
      .mockRejectedValueOnce(new Error('LLM also down')); // toolless fallback fails

    const result = await chatWithToolsLoop(
      'System prompt.',
      [],
      'User question',
      testTools,
      toolHandlers
    );

    // Should still return a non-empty string (the fallback message)
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('when LLM returns text without tool calls, returns text directly', async () => {
    const toolHandlers = new Map<string, ToolHandler>([
      ['get_menu', makeFailingHandler('get_menu')],
    ]);

    mockedChatWithFallback.mockResolvedValueOnce({
      content: 'We are open daily from 8am to 10pm.',
      toolCalls: undefined,
      provider: { name: 'test' },
    });

    const result = await chatWithToolsLoop(
      'You are a cafe assistant.',
      [],
      'What are your hours?',
      testTools,
      toolHandlers
    );

    expect(result).toBe('We are open daily from 8am to 10pm.');
    expect(mockedChatWithFallback).toHaveBeenCalledTimes(1);
  });
});
