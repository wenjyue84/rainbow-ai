/**
 * fallback-prompt-selector.ts — Selects intent-specific fallback prompts
 * (US-579: Add Custom Fallback Prompts for Low-Confidence Intent Classifications)
 *
 * When intent classification confidence falls below threshold (0.5),
 * this module provides custom fallback prompts tailored to the specific intent,
 * rather than returning a generic "I didn't understand" message.
 */

import type { SupportedLanguage } from './language-router.js';

export interface IntentFallbackPrompt {
  intent: string;
  fallbackPrompt: Record<SupportedLanguage, string>;
}

/** Load intent definitions with fallback prompts from JSON config */
async function loadIntentFallbackPrompts(): Promise<Map<string, Record<SupportedLanguage, string>>> {
  try {
    const intentKeywordsData = await import('./data/intent-keywords.json', { assert: { type: 'json' } });
    const fallbackMap = new Map<string, Record<SupportedLanguage, string>>();

    const intents = intentKeywordsData.default?.intents || [];
    for (const intent of intents) {
      if (intent.intent && intent.fallbackPrompt) {
        fallbackMap.set(intent.intent, intent.fallbackPrompt);
      }
    }

    return fallbackMap;
  } catch (error) {
    console.error('[FallbackPrompt] Failed to load intent fallback prompts:', error);
    return new Map();
  }
}

// Cache for fallback prompts (performance optimization)
let cachedFallbackPrompts: Map<string, Record<SupportedLanguage, string>> | null = null;

/**
 * Get the custom fallback prompt for an intent and language.
 *
 * Returns the intent-specific fallback prompt if available,
 * or null if the intent has no custom fallback prompt configured.
 *
 * @param intent - The classified intent (e.g., 'booking', 'wifi', 'checkin_info')
 * @param language - The preferred language (e.g., 'en', 'ms', 'zh', 'ta')
 * @returns The localized fallback prompt, or null if not configured
 */
export async function getFallbackPrompt(
  intent: string,
  language: SupportedLanguage = 'en'
): Promise<string | null> {
  if (!cachedFallbackPrompts) {
    cachedFallbackPrompts = await loadIntentFallbackPrompts();
  }

  const prompts = cachedFallbackPrompts.get(intent);
  if (!prompts) {
    return null; // Intent has no custom fallback prompt
  }

  // Return localized version, fall back to English if language not available
  const prompt = prompts[language] || prompts.en;
  return prompt || null;
}

/**
 * Check if an intent has a custom fallback prompt configured.
 *
 * @param intent - The classified intent
 * @returns true if fallback prompt is configured, false otherwise
 */
export async function hasIntentFallbackPrompt(intent: string): Promise<boolean> {
  if (!cachedFallbackPrompts) {
    cachedFallbackPrompts = await loadIntentFallbackPrompts();
  }
  return cachedFallbackPrompts.has(intent);
}

/**
 * Invalidate the cache (useful for testing or config reloads).
 */
export function invalidateFallbackPromptCache(): void {
  cachedFallbackPrompts = null;
}
