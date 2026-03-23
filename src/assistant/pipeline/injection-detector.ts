/**
 * US-273: Intent Classifier Input Sanitizer with Injection Detection
 *
 * Validation layer that detects prompt injection attempts in user messages
 * before they reach the AI classifier. Returns a risk assessment with
 * reason string for audit logging.
 *
 * Complements the existing prompt-injection-guard.ts (US-422) with a
 * richer detection engine that covers:
 *   - Unicode homoglyph / fullwidth tricks
 *   - Role-play prompt injections
 *   - Nested prompt / delimiter attacks
 *   - Common jailbreak patterns (DAN, developer mode, etc.)
 *   - Base64-encoded injection payloads
 *   - Invisible character obfuscation
 */

export interface InjectionRiskResult {
  risk: 'high' | 'low';
  reason?: string;
}

// ─── Pattern Categories ────────────────────────────────────────────────

/** Role-play and persona hijack patterns */
const ROLEPLAY_PATTERNS: RegExp[] = [
  /you\s+are\s+now\s+/i,
  /act\s+as\s+(a|an|if)\b/i,
  /pretend\s+(to\s+be|you\s*(?:are|'re))/i,
  /roleplay\s+as/i,
  /simulate\s+being/i,
  /from\s+now\s+on\s*,?\s*you/i,
  /let['']?s\s+play\s+a\s+game/i,
  /imagine\s+you\s+are/i,
  /i\s+want\s+you\s+to\s+act/i,
  /you\s+(?:will|must|should)\s+(?:now\s+)?(?:act|behave|respond)\s+as/i,
  /take\s+on\s+the\s+(?:role|persona)\s+of/i,
  /switch\s+(?:to|into)\s+(?:\w+\s+)?mode/i,
];

/** Instruction override / ignore previous patterns */
const INSTRUCTION_OVERRIDE_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above|your)\s+(?:instructions?|directives?|rules?|prompts?)/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|above|your)\s+(?:instructions?|directives?|rules?|prompts?)/i,
  /forget\s+(?:all\s+)?(?:previous|prior|above|your|everything)\s+(?:instructions?|directives?|rules?|prompts?|above)?/i,
  /override\s+(?:your|all|the)\s+(?:instructions?|rules?|settings?|prompts?)/i,
  /bypass\s+(?:your|all|the)\s+(?:instructions?|rules?|filters?|safety|restrictions?)/i,
  /new\s+instructions?\s*:/i,
  /do\s+not\s+follow\s+(?:your|the|any)/i,
  /stop\s+being\s+(?:an?\s+)?(?:helpful|assistant|bot|ai)/i,
];

/** Jailbreak patterns (DAN, developer mode, etc.) */
const JAILBREAK_PATTERNS: RegExp[] = [
  /\bDAN\b\s*(?:mode)?/,
  /\bdeveloper\s+mode\b/i,
  /\bjailbreak\b/i,
  /\bdo\s+anything\s+now\b/i,
  /\bunleash(?:ed)?\s+mode\b/i,
  /\bno\s+(?:restrictions?|limits?|rules?|filters?|guardrails?)\b/i,
  /\buncensored\s+mode\b/i,
  /\bevil\s+(?:mode|assistant|bot)\b/i,
  /\bopposite\s+mode\b/i,
  /\bgod\s+mode\b/i,
  /\bmaster\s+(?:key|override)\b/i,
];

/** System prompt extraction patterns */
const SYSTEM_PROMPT_PATTERNS: RegExp[] = [
  /(?:reveal|show|print|output|display|repeat|tell\s+me|what\s+(?:is|are))\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?|rules?|directives?)/i,
  /\bsystem\s*:\s*/i,
  /\bsystem\s+prompt\b/i,
  /what\s+(?:is|are)\s+your\s+(?:hidden|secret|internal)\s+(?:instructions?|prompts?)/i,
  /\b(?:dump|leak|extract)\s+(?:your|the|system)\s+(?:prompt|instructions?)/i,
];

/** Nested prompt / delimiter injection patterns */
const NESTED_PROMPT_PATTERNS: RegExp[] = [
  /```\s*system/i,
  /\[(?:INST|SYS|SYSTEM)\]/i,
  /<\|(?:im_start|system|endoftext)\|>/i,
  /\bHuman:\s*.*\bAssistant:/is,
  /###\s*(?:System|Instruction|New\s+Task)/i,
  /\n\s*---+\s*\n.*(?:instruction|command|directive)/is,
  /<\/?(?:system|instruction|prompt)>/i,
  /\bBEGIN\s+(?:NEW\s+)?(?:INSTRUCTION|PROMPT|TASK)\b/i,
  /\bEND\s+(?:OF\s+)?(?:PREVIOUS\s+)?(?:INSTRUCTION|PROMPT|CONTEXT)\b/i,
];

/** Unicode homoglyph / obfuscation patterns */
const UNICODE_TRICKS: Array<{ test: (text: string) => boolean; label: string }> = [
  {
    // Invisible / zero-width characters
    test: (t) => /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD\u2060\u2061\u2062\u2063\u2064]/.test(t),
    label: 'invisible_characters',
  },
  {
    // Fullwidth Latin letters (U+FF01-U+FF5E) — used to bypass substring filters
    test: (t) => /[\uFF01-\uFF5E]{3,}/.test(t),
    label: 'fullwidth_latin_obfuscation',
  },
  {
    // Combining diacritical marks used to obscure text (zalgo)
    test: (t) => /[\u0300-\u036F]{3,}/.test(t),
    label: 'zalgo_text',
  },
  {
    // Cyrillic homoglyphs mixed with Latin
    test: (t) => {
      const hasLatin = /[a-zA-Z]/.test(t);
      const hasCyrillic = /[\u0400-\u04FF]/.test(t);
      return hasLatin && hasCyrillic;
    },
    label: 'cyrillic_latin_mix',
  },
  {
    // Right-to-left override character
    test: (t) => /[\u202A-\u202E\u2066-\u2069]/.test(t),
    label: 'bidi_override',
  },
];

/** Base64-encoded payload detection */
function containsBase64Injection(text: string): boolean {
  // Look for base64 strings that are at least 20 chars (likely encoded payloads)
  const b64Regex = /[A-Za-z0-9+/]{20,}={0,2}/g;
  const matches = text.match(b64Regex);
  if (!matches) return false;

  for (const match of matches) {
    try {
      const decoded = Buffer.from(match, 'base64').toString('utf-8');
      // Check if decoded content contains injection keywords
      const lower = decoded.toLowerCase();
      if (
        lower.includes('ignore') ||
        lower.includes('system') ||
        lower.includes('prompt') ||
        lower.includes('instruction') ||
        lower.includes('jailbreak') ||
        lower.includes('override')
      ) {
        return true;
      }
    } catch {
      // Not valid base64 — skip
    }
  }
  return false;
}

// ─── Main Detection Function ───────────────────────────────────────────

/**
 * Detect prompt injection risk in a user message.
 *
 * Normalizes the input (NFKC, strip invisible chars for matching) and checks
 * against multiple pattern categories. Returns 'high' risk with a reason
 * string if any pattern matches; 'low' otherwise.
 *
 * @param message - Raw user message text
 * @returns Risk assessment with optional reason
 */
export function detectInjectionRisk(message: string): InjectionRiskResult {
  if (!message || message.trim().length === 0) {
    return { risk: 'low' };
  }

  // NFKC normalization to collapse fullwidth, compatibility chars, etc.
  const normalized = message.normalize('NFKC');

  // ─── Unicode trick detection (run BEFORE normalization-based regex) ───
  for (const trick of UNICODE_TRICKS) {
    if (trick.test(message)) {
      return { risk: 'high', reason: `unicode_obfuscation:${trick.label}` };
    }
  }

  // ─── Role-play injection ─────────────────────────────────────────────
  for (const pattern of ROLEPLAY_PATTERNS) {
    if (pattern.test(normalized)) {
      return { risk: 'high', reason: `roleplay_injection:${pattern.source.slice(0, 40)}` };
    }
  }

  // ─── Instruction override ────────────────────────────────────────────
  for (const pattern of INSTRUCTION_OVERRIDE_PATTERNS) {
    if (pattern.test(normalized)) {
      return { risk: 'high', reason: `instruction_override:${pattern.source.slice(0, 40)}` };
    }
  }

  // ─── Jailbreak patterns ──────────────────────────────────────────────
  for (const pattern of JAILBREAK_PATTERNS) {
    if (pattern.test(normalized)) {
      return { risk: 'high', reason: `jailbreak:${pattern.source.slice(0, 40)}` };
    }
  }

  // ─── System prompt extraction ────────────────────────────────────────
  for (const pattern of SYSTEM_PROMPT_PATTERNS) {
    if (pattern.test(normalized)) {
      return { risk: 'high', reason: `system_prompt_extraction:${pattern.source.slice(0, 40)}` };
    }
  }

  // ─── Nested prompt / delimiter injection ─────────────────────────────
  for (const pattern of NESTED_PROMPT_PATTERNS) {
    if (pattern.test(normalized)) {
      return { risk: 'high', reason: `nested_prompt:${pattern.source.slice(0, 40)}` };
    }
  }

  // ─── Base64-encoded injection payloads ───────────────────────────────
  if (containsBase64Injection(normalized)) {
    return { risk: 'high', reason: 'base64_encoded_injection' };
  }

  return { risk: 'low' };
}
