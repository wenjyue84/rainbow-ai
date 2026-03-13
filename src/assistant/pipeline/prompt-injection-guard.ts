/**
 * Prompt Injection Detection (US-422)
 *
 * Lightweight regex/substring guard that detects common prompt injection
 * patterns and blocks them before they reach the LLM.
 */

export interface PromptInjectionResult {
  blocked: boolean;
  matchedPattern: string | null;
}

/** Default patterns — can be overridden via settings.json promptInjection.patterns */
const DEFAULT_PATTERNS: string[] = [
  'ignore previous instructions',
  'ignore all previous',
  'ignore your instructions',
  'disregard previous',
  'disregard your instructions',
  'forget your instructions',
  'forget all previous',
  'forget everything above',
  'you are now',
  'act as',
  'pretend to be',
  'simulate being',
  'roleplay as',
  'jailbreak',
  'DAN mode',
  'developer mode',
  'system:',
  'system prompt',
  'reveal your prompt',
  'show your instructions',
  'what are your instructions',
  'print your system',
  'output your system',
  'repeat your prompt',
  'override your',
  'bypass your',
  'new instructions:',
  'from now on you',
  'stop being',
  'do not follow',
  'do anything now',
];

/**
 * Check if a message contains prompt injection patterns.
 * Uses case-insensitive substring matching against a configurable pattern list.
 *
 * @param text - The user's message text
 * @param customPatterns - Optional patterns from settings.json (overrides defaults if provided)
 * @returns Detection result with matched pattern (if any)
 */
export function detectPromptInjection(
  text: string,
  customPatterns?: string[]
): PromptInjectionResult {
  const patterns = customPatterns && customPatterns.length > 0 ? customPatterns : DEFAULT_PATTERNS;
  const lower = text.toLowerCase();

  for (const pattern of patterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return { blocked: true, matchedPattern: pattern };
    }
  }

  return { blocked: false, matchedPattern: null };
}
