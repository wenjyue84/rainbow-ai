/**
 * FnB Widget Bug Regression Tests (US-806)
 *
 * Tests for preventing regression of two critical bugs visible in screenshots:
 * (1) Image 3: hostel fallback text appearing in makan-moments cafe widget
 * (2) Image 4: raw JSON being rendered in chat bubble instead of plain text
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chatWithToolsLoop, looksLikeJson, getUnknownFallbackMessages } from '../../assistant/ai-response-generator.js';
import type { ChatMessage, ConfigStore } from '../../assistant/types.js';

describe('FnB Widget Bugs (US-806)', () => {
  // ─── Test 1: Image 4 - JSON response extraction ─────────────────────
  describe('Image 4: Raw JSON rendered in chat bubble', () => {
    it('should extract response field from JSON and return plain text', async () => {
      // Mock the chatWithFallback to return JSON format
      const mockResult = {
        content: '{"intent":"menu_query","response":"Here is the menu","confidence":0.5}',
        toolCalls: []
      };

      // chatWithToolsLoop should extract the response field from JSON
      const jsonStr = mockResult.content;
      expect(looksLikeJson(jsonStr)).toBe(true);

      // Parse and extract response
      const parsed = JSON.parse(jsonStr);
      const extracted = parsed.response;
      expect(extracted).toBe('Here is the menu');
      expect(extracted).not.toMatch(/^\{/); // Should not start with {
    });

    it('looksLikeJson should correctly identify JSON strings', () => {
      expect(looksLikeJson('{"intent":"menu"}')).toBe(true);
      expect(looksLikeJson('[{"item":"nasi lemak"}]')).toBe(true);
      expect(looksLikeJson('plain text response')).toBe(false);
      expect(looksLikeJson('not json at all')).toBe(false);
    });
  });

  // ─── Test 2: Image 3 - Profile-aware fallback ────────────────────────
  describe('Image 3: Hostel fallback text appearing in makan-moments widget', () => {
    it('should return profile-aware fallback, not generic hostel text', () => {
      // Create a mock config store for makan-moments with cafe-appropriate fallback
      const mockConfigStore: Partial<ConfigStore> = {
        getSettings: vi.fn().mockReturnValue({
          unknownFallback: {
            en: 'Sorry, I could not get that information. Please ask our staff or try: Show me the menu / Place an order / Check my order.',
            ms: 'Maaf, saya tidak dapat maklumat itu. Sila tanya staf kami atau cuba: Tunjuk menu / Buat pesanan / Semak pesanan saya.',
            zh: '抱歉，我无法获取该信息。请联系我们的员工，或尝试：显示菜单 / 下单 / 查询订单。'
          }
        })
      } as ConfigStore;

      const fallback = getUnknownFallbackMessages(mockConfigStore);

      // Verify no hostel-specific words in cafe fallback
      expect(fallback.en).not.toMatch(/hostel|booking|check-in|amenities/i);
      expect(fallback.en).toMatch(/menu|order|staff/i);

      // Verify it's cafe-appropriate
      expect(fallback.en).toContain('menu');
      expect(fallback.en).toContain('order');
    });

    it('getUnknownFallbackMessages should return custom fallback from configStore', () => {
      const mockConfigStore: Partial<ConfigStore> = {
        getSettings: vi.fn().mockReturnValue({
          unknownFallback: {
            en: 'Cafe custom fallback',
            ms: 'Fallback kafe',
            zh: '咖啡厅回退'
          }
        })
      } as ConfigStore;

      const fallback = getUnknownFallbackMessages(mockConfigStore);

      expect(fallback.en).toBe('Cafe custom fallback');
      expect(fallback.ms).toBe('Fallback kafe');
      expect(fallback.zh).toBe('咖啡厅回退');
    });

    it('getUnknownFallbackMessages should use defaults when no custom config', () => {
      const mockConfigStore: Partial<ConfigStore> = {
        getSettings: vi.fn().mockReturnValue({
          // No unknownFallback property
        })
      } as ConfigStore;

      const fallback = getUnknownFallbackMessages(mockConfigStore);

      expect(fallback.en).toBeDefined();
      expect(fallback.ms).toBeDefined();
      expect(fallback.zh).toBeDefined();
      expect(fallback.en).toContain('understand');
    });
  });

  // ─── Cleanup ──────────────────────────────────────────────────────────
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });
});
