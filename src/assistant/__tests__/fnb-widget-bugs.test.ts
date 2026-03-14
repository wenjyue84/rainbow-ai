import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getUnknownFallbackMessages, looksLikeJson } from '../../assistant/ai-response-generator.js';
import type { ConfigStore } from '../../assistant/config-store.js';

/**
 * Regression tests for Image 3 and Image 4 bugs in the FnB widget:
 * US-802: Raw JSON should not be returned from chatWithToolsLoop
 * US-801: Hostel fallback text should not appear in makan-moments cafe widget
 */
describe('FnB Widget Bugs - Image 3 & Image 4', () => {
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
      // Real JSON will have quotes, so these should be detected
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

  describe('Integration: JSON extraction from responses', () => {
    it('should extract response field from LLM JSON output pattern', () => {
      const jsonResponse = '{"intent":"menu_query","response":"Here is the menu","confidence":0.95}';
      expect(looksLikeJson(jsonResponse)).toBe(true);

      // Simulate the extraction logic from chatWithToolsLoop
      if (looksLikeJson(jsonResponse)) {
        const j = JSON.parse(jsonResponse);
        const extracted = j.response || j.text || j.message || null;
        expect(extracted).toBe('Here is the menu');
        expect(typeof extracted).toBe('string');
        expect(!looksLikeJson(extracted)).toBe(true);
      }
    });

    it('should fall back to default when JSON has no extractable text', () => {
      const jsonResponse = '{"intent":"unknown","confidence":0.2}';
      expect(looksLikeJson(jsonResponse)).toBe(true);

      const defaultFallback = 'Please rephrase your question';
      if (looksLikeJson(jsonResponse)) {
        const j = JSON.parse(jsonResponse);
        const extracted = j.response || j.text || j.message || null;
        const finalResponse = extracted && typeof extracted === 'string' ? extracted : defaultFallback;
        expect(finalResponse).toBe(defaultFallback);
      }
    });
  });
});
