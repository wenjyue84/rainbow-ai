import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
    getRouting: vi.fn(() => ({})),
  },
}));

vi.mock('../context-windows.js', () => ({
  getContextWindows: vi.fn(() => ({ combined: 10, reply: 5, classification: 5 })),
}));

import { getUnknownFallbackMessages, looksLikeJson, chatWithToolsLoop } from '../../assistant/ai-response-generator.js';
import { chatWithFallback } from '../ai-provider-manager.js';
import type { ConfigStore } from '../../assistant/config-store.js';
import type { MCPTool, MCPToolResult, ToolHandler } from '../../types/mcp.js';

const mockedChatWithFallback = vi.mocked(chatWithFallback);

/**
 * Regression tests for Image 3 and Image 4 bugs in the FnB widget:
 * US-802: Raw JSON should not be returned from chatWithToolsLoop
 * US-801: Hostel fallback text should not appear in makan-moments cafe widget
 */
describe('FnB Widget Bugs - Image 3 & Image 4', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('US-801: Profile-aware fallback messages', () => {
    it('should return cafe-scoped fallback for makan-moments profile without hostel text', () => {
      // Mock makan-moments config store with cafe-appropriate fallback
      const mockStore = {
        getSettings: () => ({
          unknownFallback: {
            en: 'Sorry, I could not get that information right now. Please ask our staff or try: Show me the menu / Place an order / Check my order.',
            ms: 'Maaf, saya tidak dapat maklumat itu sekarang. Sila tanya staf kami atau cuba: Tunjuk menu / Buat pesanan / Semak pesanan saya.',
            zh: '抱歉，我暂时无法获取该信息。请联系我们的员工，或尝试：显示菜单 / 下单 / 查询订单。'
          }
        })
      } as any as ConfigStore;

      const fallback = getUnknownFallbackMessages(mockStore);

      // English fallback should not mention hostel-specific words
      expect(fallback.en).not.toContain('hostel');
      expect(fallback.en).not.toContain('check-in');
      expect(fallback.en).not.toContain('check-out');
      expect(fallback.en).not.toContain('amenities');
      expect(fallback.en).not.toContain('bookings');

      // Should mention cafe-appropriate options
      expect(fallback.en).toContain('staff');
      expect(fallback.en).toContain('menu');
      expect(fallback.en).toContain('order');

      // Malay fallback should not mention hostel
      expect(fallback.ms).not.toContain('hostel');
      expect(fallback.ms).not.toContain('check-in');
      expect(fallback.ms).toContain('menu');
      expect(fallback.ms).toContain('pesanan');
    });

    it('should use default fallback when no custom store provided', () => {
      const fallback = getUnknownFallbackMessages();

      // Default fallback (hostel-scoped)
      expect(fallback.en).toBeDefined();
      expect(fallback.ms).toBeDefined();
      expect(fallback.zh).toBeDefined();
      expect(typeof fallback.en).toBe('string');
    });
  });

  describe('US-802: looksLikeJson utility for JSON guard', () => {
    it('should detect JSON strings starting with {', () => {
      expect(looksLikeJson('{"key":"value"}')).toBe(true);
      expect(looksLikeJson(' {"key":"value"}')).toBe(true);
      expect(looksLikeJson('  { "intent": "test" }')).toBe(true);
    });

    it('should detect JSON arrays starting with [{', () => {
      expect(looksLikeJson('[{"key":"value"}]')).toBe(true);
      expect(looksLikeJson('[{"intent":"test"}]')).toBe(true);
    });

    it('should not detect non-JSON strings', () => {
      expect(looksLikeJson('Hello world')).toBe(false);
      expect(looksLikeJson('This is a response')).toBe(false);
      expect(looksLikeJson('{incomplete')).toBe(false);
      expect(looksLikeJson('[incomplete')).toBe(false);
    });

    it('should correctly identify JSON-like strings with escaped quotes', () => {
      expect(looksLikeJson('{"response":"Here is the menu"}')).toBe(true);
      expect(looksLikeJson('{"intent":"menu_query","response":"OK","confidence":0.5}')).toBe(true);
    });

    it('should handle edge cases', () => {
      expect(looksLikeJson('')).toBe(false);
      expect(looksLikeJson('  ')).toBe(false);
      expect(looksLikeJson('{')).toBe(false);
      expect(looksLikeJson('[]')).toBe(false);
    });
  });

  describe('US-802: chatWithToolsLoop JSON extraction (Image 3 regression)', () => {
    const testTools: MCPTool[] = [
      { name: 'get_menu', description: 'Fetch menu items', inputSchema: { type: 'object', properties: {} } },
    ];

    it('should extract response field from JSON instead of returning raw JSON', async () => {
      const toolHandlers = new Map<string, ToolHandler>();

      // LLM returns raw JSON with response field instead of plain text
      mockedChatWithFallback.mockResolvedValueOnce({
        content: '{"intent":"menu_query","response":"OK","confidence":0.5}',
        toolCalls: undefined,
        provider: { name: 'test-provider', model: 'test-model' },
        usage: { total_tokens: 30 },
      });

      const result = await chatWithToolsLoop(
        'You are a cafe assistant.',
        [],
        'Show me the menu',
        testTools,
        toolHandlers
      );

      // Should extract "OK" from the response field, not return raw JSON
      expect(result).toBe('OK');
      expect(result).not.toContain('{');
      expect(result).not.toContain('"intent"');
    });
  });

  describe('US-801: chatWithToolsLoop tool failure fallback (Image 4 regression)', () => {
    const testTools: MCPTool[] = [
      { name: 'get_menu', description: 'Fetch menu items', inputSchema: { type: 'object', properties: {} } },
    ];

    function makeFailingHandler(name: string): ToolHandler {
      return async (_args: any): Promise<MCPToolResult> => ({
        content: [{ type: 'text', text: `Error: ${name} unavailable` }],
        isError: true,
      });
    }

    it('should not contain hostel/check-in/bookings when all tool handlers fail with makan-moments profile', async () => {
      const toolHandlers = new Map<string, ToolHandler>([
        ['get_menu', makeFailingHandler('get_menu')],
      ]);

      // Makan-moments profile config store
      const makanStore = {
        getSettings: () => ({
          unknownFallback: {
            en: 'Sorry, I could not get that information right now. Please ask our staff or try: Show me the menu / Place an order / Check my order.',
            ms: 'Maaf, saya tidak dapat maklumat itu sekarang.',
            zh: '抱歉，我暂时无法获取该信息。',
          }
        })
      } as any as ConfigStore;

      // Loops 1-3: LLM requests tool calls each time
      const toolCallResponse = {
        content: null,
        toolCalls: [
          { id: 'call_1', type: 'function', function: { name: 'get_menu', arguments: '{}' } },
        ],
        provider: { name: 'test-provider' },
      };

      // Toolless fallback also fails
      mockedChatWithFallback
        .mockResolvedValueOnce(toolCallResponse) // loop 1
        .mockResolvedValueOnce(toolCallResponse) // loop 2
        .mockResolvedValueOnce(toolCallResponse) // loop 3
        .mockRejectedValueOnce(new Error('LLM down')); // toolless fallback fails

      const result = await chatWithToolsLoop(
        'You are a cafe assistant.',
        [],
        'What food do you have?',
        testTools,
        toolHandlers,
        makanStore
      );

      // Result should NOT contain hostel-specific words
      expect(result).not.toContain('hostel');
      expect(result).not.toContain('check-in');
      expect(result).not.toContain('bookings');
      // Should be the cafe-scoped fallback
      expect(result).toContain('staff');
    });
  });
});
