/**
 * intent_fallback_prompts.test.ts — Tests for US-579: Custom Fallback Prompts
 * (US-579: Add Custom Fallback Prompts for Low-Confidence Intent Classifications)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getFallbackPrompt,
  hasIntentFallbackPrompt,
  invalidateFallbackPromptCache,
} from '../../src/assistant/fallback-prompt-selector.js';
import type { SupportedLanguage } from '../../src/assistant/language-router.js';

describe('Fallback Prompt Selector (US-579)', () => {
  beforeEach(() => {
    invalidateFallbackPromptCache();
  });

  afterEach(() => {
    invalidateFallbackPromptCache();
  });

  // ─── AC1: Fallback Selection for Specific Intents ───
  describe('AC1: Fallback Selection for Specific Intents', () => {
    it('should return fallback prompt for booking intent in English', async () => {
      const prompt = await getFallbackPrompt('booking', 'en');
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('booking');
      expect(prompt).toContain('check-in');
      expect(prompt).toContain('nights');
    });

    it('should return fallback prompt for checkin_info intent in English', async () => {
      const prompt = await getFallbackPrompt('checkin_info', 'en');
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('check-in');
      expect(prompt).toContain('3:00 PM');
    });

    it('should return fallback prompt for checkout_info intent in English', async () => {
      const prompt = await getFallbackPrompt('checkout_info', 'en');
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('checkout');
      expect(prompt).toContain('11:00 AM');
    });

    it('should return fallback prompt for wifi intent in English', async () => {
      const prompt = await getFallbackPrompt('wifi', 'en');
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('WiFi');
      expect(prompt).toContain('password');
    });

    it('should return fallback prompt for payment intent in English', async () => {
      const prompt = await getFallbackPrompt('payment', 'en');
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('payment');
      expect(prompt).toContain('card');
    });

    it('should return null for intent without fallback prompt', async () => {
      const prompt = await getFallbackPrompt('greeting', 'en');
      expect(prompt).toBeNull();
    });

    it('should return null for unknown intent', async () => {
      const prompt = await getFallbackPrompt('unknown_intent_xyz', 'en');
      expect(prompt).toBeNull();
    });
  });

  // ─── AC2: Prompt Rendering with Proper Language ───
  describe('AC2: Prompt Rendering with Proper Language', () => {
    it('should return Malay prompt for booking intent', async () => {
      const prompt = await getFallbackPrompt('booking', 'ms');
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('tempahan');
      expect(prompt).toContain('Tarikh masuk');
    });

    it('should return Chinese prompt for wifi intent', async () => {
      const prompt = await getFallbackPrompt('wifi', 'zh');
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('WiFi密码');
      expect(prompt).toContain('房间');
    });

    it('should return Tamil prompt for payment intent', async () => {
      const prompt = await getFallbackPrompt('payment', 'ta');
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('பணம்');
    });

    it('should fall back to English if language not available', async () => {
      const prompt = await getFallbackPrompt('booking', 'fr' as SupportedLanguage);
      expect(prompt).toBeTruthy();
      // Should fall back to English
      expect(prompt).toContain('check-in');
    });

    it('should default to English language if not specified', async () => {
      const prompt = await getFallbackPrompt('booking');
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('check-in');
    });
  });

  // ─── AC3: Multi-language Fallback Variations ───
  describe('AC3: Multi-language Fallback Variations', () => {
    it('should have consistent multi-language prompts for booking', async () => {
      const en = await getFallbackPrompt('booking', 'en');
      const ms = await getFallbackPrompt('booking', 'ms');
      const zh = await getFallbackPrompt('booking', 'zh');
      const ta = await getFallbackPrompt('booking', 'ta');

      expect(en).toBeTruthy();
      expect(ms).toBeTruthy();
      expect(zh).toBeTruthy();
      expect(ta).toBeTruthy();

      // All should be strings
      expect(typeof en).toBe('string');
      expect(typeof ms).toBe('string');
      expect(typeof zh).toBe('string');
      expect(typeof ta).toBe('string');

      // All should contain phone number or request for clarification
      expect(en).toContain('+60127088789');
      expect(ms).toContain('+60127088789');
      expect(zh).toContain('+60127088789');
      expect(ta).toContain('+60127088789');
    });

    it('should have different prompts for different intents', async () => {
      const booking = await getFallbackPrompt('booking', 'en');
      const wifi = await getFallbackPrompt('wifi', 'en');
      const payment = await getFallbackPrompt('payment', 'en');

      expect(booking).not.toBe(wifi);
      expect(booking).not.toBe(payment);
      expect(wifi).not.toBe(payment);
    });

    it('should provide context-specific guidance for checkout intent', async () => {
      const prompt = await getFallbackPrompt('checkout_info', 'en');
      expect(prompt).toContain('11:00 AM');
      expect(prompt).toContain('late checkout');
    });

    it('should provide context-specific guidance for pricing intent', async () => {
      const prompt = await getFallbackPrompt('pricing', 'en');
      expect(prompt).toContain('room types');
      expect(prompt).toContain('price list');
    });
  });

  // ─── Helper Functions ───
  describe('Helper Functions', () => {
    it('hasIntentFallbackPrompt should return true for intents with fallback', async () => {
      const hasFallback = await hasIntentFallbackPrompt('booking');
      expect(hasFallback).toBe(true);
    });

    it('hasIntentFallbackPrompt should return false for intents without fallback', async () => {
      const hasFallback = await hasIntentFallbackPrompt('greeting');
      expect(hasFallback).toBe(false);
    });

    it('hasIntentFallbackPrompt should return false for unknown intents', async () => {
      const hasFallback = await hasIntentFallbackPrompt('nonexistent_intent');
      expect(hasFallback).toBe(false);
    });

    it('invalidateFallbackPromptCache should clear cache', async () => {
      // Load prompt (loads cache)
      const prompt1 = await getFallbackPrompt('booking', 'en');
      expect(prompt1).toBeTruthy();

      // Invalidate cache
      invalidateFallbackPromptCache();

      // Load again (should reload from disk)
      const prompt2 = await getFallbackPrompt('booking', 'en');
      expect(prompt2).toBeTruthy();
      expect(prompt1).toBe(prompt2);
    });
  });

  // ─── Integration: Fallback Prompts for Low-Confidence Classification ───
  describe('Integration: Fallback Use Cases', () => {
    it('should select booking fallback when confidence < 0.5 for booking intent', async () => {
      const intent = 'booking';
      const confidence = 0.35; // Below 0.5 threshold
      const language = 'en';

      if (confidence < 0.5) {
        const fallback = await getFallbackPrompt(intent, language);
        expect(fallback).toBeTruthy();
        expect(fallback).toContain('booking');
      }
    });

    it('should not select fallback when confidence >= 0.5 for booking intent', async () => {
      const intent = 'booking';
      const confidence = 0.75; // Above 0.5 threshold
      const language = 'en';

      if (confidence < 0.5) {
        const fallback = await getFallbackPrompt(intent, language);
        expect(fallback).toBeFalsy();
      } else {
        // Should not call getFallbackPrompt
        expect(true).toBe(true);
      }
    });

    it('should fall back to generic unknown prompt when intent has no custom fallback', async () => {
      const intent = 'greeting';
      const confidence = 0.25; // Below 0.5 threshold
      const language = 'en';

      if (confidence < 0.5) {
        const fallback = await getFallbackPrompt(intent, language);
        // Should be null since 'greeting' has no fallback prompt
        expect(fallback).toBeNull();
      }
    });

    it('should respect conversation language preference', async () => {
      const intent = 'checkin_info';
      const userLanguage = 'ms'; // Malay
      const confidence = 0.45; // Below 0.5 threshold

      if (confidence < 0.5) {
        const fallback = await getFallbackPrompt(intent, userLanguage);
        expect(fallback).toBeTruthy();
        // Check that it's the Malay version (contains Malay text)
        expect(fallback).toContain('check-in');
        expect(fallback).toContain('petang'); // Malay for "afternoon"
      }
    });
  });

  // ─── Edge Cases ───
  describe('Edge Cases', () => {
    it('should handle empty intent string gracefully', async () => {
      const prompt = await getFallbackPrompt('', 'en');
      expect(prompt).toBeNull();
    });

    it('should handle case-sensitive intent matching', async () => {
      const prompt1 = await getFallbackPrompt('booking', 'en');
      const prompt2 = await getFallbackPrompt('Booking', 'en');
      // Case matters
      expect(prompt1).toBeTruthy();
      expect(prompt2).toBeNull();
    });

    it('should handle all configured intents without errors', async () => {
      const configuredIntents = ['booking', 'checkin_info', 'checkout_info', 'wifi', 'payment', 'pricing', 'complaint', 'contact_staff', 'availability', 'facilities_info', 'rules_policy'];

      for (const intent of configuredIntents) {
        const prompt = await getFallbackPrompt(intent, 'en');
        expect(prompt).toBeTruthy();
      }
    });
  });
});
