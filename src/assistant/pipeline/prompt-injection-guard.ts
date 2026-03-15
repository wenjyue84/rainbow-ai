/**
 * Prompt Injection Detection (US-422 + US-928 OWASP LLM01)
 *
 * Multi-layer guard that detects prompt injection patterns and
 * system prompt leakage in LLM output (output fencing).
 *
 * Layer 1a: Substring matching (original US-422 patterns)
 * Layer 1b: OWASP LLM01 regex patterns (instruction override, role hijack,
 *           prompt extraction, delimiter injection, encoded payloads,
 *           multi-turn manipulation, jailbreak attempts)
 * Layer 2:  Output fencing — detect system prompt leakage in AI responses
 */

export interface PromptInjectionResult {
  blocked: boolean;
  matchedPattern: string | null;
  /** Which detection layer triggered: 'substring' | 'regex' | null */
  layer: 'substring' | 'regex' | null;
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
 * US-928: OWASP LLM01 regex patterns grouped by attack category.
 * These catch more sophisticated injection attempts that simple substring
 * matching would miss (e.g. variations in phrasing, encoded payloads).
 */
const OWASP_REGEX_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  // Instruction override
  { pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|rules|guidelines|directives)/i, category: 'instruction_override' },
  { pattern: /disregard\s+(all\s+)?(previous|prior|above|earlier|your)\s+(instructions|rules|guidelines|directives)/i, category: 'instruction_override' },
  { pattern: /new\s+(instructions|rules|directives)\s*[:=]/i, category: 'instruction_override' },
  { pattern: /override\s+(all\s+)?(previous|prior|system)\s+(instructions|rules|settings|prompts)/i, category: 'instruction_override' },

  // Role hijacking
  { pattern: /you\s+are\s+now\s+(a|an|the|my)\s+/i, category: 'role_hijack' },
  { pattern: /from\s+now\s+on\s+(you\s+)?(are|will|must|should)\s+/i, category: 'role_hijack' },
  { pattern: /pretend\s+(you\s+are|to\s+be|that\s+you)/i, category: 'role_hijack' },
  { pattern: /act\s+as\s+(a|an|the|my|if)\s+/i, category: 'role_hijack' },
  { pattern: /simulate\s+(being|a|an|the)/i, category: 'role_hijack' },
  { pattern: /roleplay\s+as\s+/i, category: 'role_hijack' },

  // Prompt extraction
  { pattern: /reveal\s+(your|the)\s+(system\s+)?(prompt|instructions|rules|guidelines)/i, category: 'prompt_extraction' },
  { pattern: /show\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions|rules|initial)/i, category: 'prompt_extraction' },
  { pattern: /what\s+(are|is)\s+your\s+(system\s+)?(prompt|instructions|rules|guidelines)/i, category: 'prompt_extraction' },
  { pattern: /print\s+(your|the)\s+(system\s+)?(prompt|instructions|configuration)/i, category: 'prompt_extraction' },
  { pattern: /output\s+(your|the)\s+(system\s+)?(prompt|instructions|configuration)/i, category: 'prompt_extraction' },
  { pattern: /repeat\s+(your|the)\s+(system\s+)?(prompt|instructions|initial\s+message)/i, category: 'prompt_extraction' },
  { pattern: /display\s+(your|the)\s+(system|hidden|secret)\s+(prompt|instructions|message)/i, category: 'prompt_extraction' },

  // Delimiter injection (attempts to inject system-level markers)
  { pattern: /<\|?(system|im_start|im_end|endoftext|s|\/s)\|?>/i, category: 'delimiter_injection' },
  { pattern: /\[INST\]|\[\/INST\]|\[SYS\]|\[\/SYS\]/i, category: 'delimiter_injection' },
  { pattern: /<<\s*SYS\s*>>|<<\s*\/SYS\s*>>/i, category: 'delimiter_injection' },
  { pattern: /###\s*(system|instruction|human|assistant)\s*(message|prompt)?\s*:/i, category: 'delimiter_injection' },

  // Encoded injection (base64, hex, unicode escapes)
  { pattern: /(?:base64|atob|decode)\s*\(\s*['"][\w+/=]{20,}['"]\s*\)/i, category: 'encoded_injection' },
  { pattern: /\\u0069\\u0067\\u006e\\u006f\\u0072\\u0065/i, category: 'encoded_injection' }, // "ignore" in unicode escapes

  // Multi-turn manipulation
  { pattern: /in\s+your\s+(previous|last|first)\s+(message|response|reply).*you\s+(said|told|agreed|promised)/i, category: 'multi_turn_manipulation' },
  { pattern: /remember\s+when\s+you\s+(said|agreed|told|promised)/i, category: 'multi_turn_manipulation' },

  // Jailbreak attempts
  { pattern: /\bDAN\b.*\bmode\b|\bmode\b.*\bDAN\b/i, category: 'jailbreak_attempt' },
  { pattern: /\bjailbreak\b/i, category: 'jailbreak_attempt' },
  { pattern: /do\s+anything\s+now/i, category: 'jailbreak_attempt' },
  { pattern: /\bdevmode\b|developer\s+mode\s+(enabled|on|activated)/i, category: 'jailbreak_attempt' },
  { pattern: /maximum\s+virtual\s+machine/i, category: 'jailbreak_attempt' },
  { pattern: /bypass\s+(all\s+)?(your|safety|content|security)\s+(filters?|restrictions?|guardrails?|guidelines?)/i, category: 'jailbreak_attempt' },
];

/**
 * Check if a message contains prompt injection patterns.
 *
 * Layer 1a: Case-insensitive substring matching against pattern list.
 * Layer 1b: OWASP LLM01 regex patterns for sophisticated attacks.
 *
 * @param text - The user's message text
 * @param customPatterns - Optional patterns from settings.json (overrides default substring list if provided)
 * @returns Detection result with matched pattern and layer
 */
export function detectPromptInjection(
  text: string,
  customPatterns?: string[]
): PromptInjectionResult {
  // Layer 1a: Substring matching
  const patterns = customPatterns && customPatterns.length > 0 ? customPatterns : DEFAULT_PATTERNS;
  const lower = text.toLowerCase();

  for (const pattern of patterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return { blocked: true, matchedPattern: pattern, layer: 'substring' };
    }
  }

  // Layer 1b: OWASP LLM01 regex patterns
  for (const { pattern, category } of OWASP_REGEX_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, matchedPattern: `[${category}] ${pattern.source}`, layer: 'regex' };
    }
  }

  return { blocked: false, matchedPattern: null, layer: null };
}


// ─── US-928: Output Fencing — System Prompt Leakage Detection ──────

/** Patterns that indicate system prompt content leaked into the AI response */
const OUTPUT_FENCE_PATTERNS: RegExp[] = [
  /<system>[\s\S]*?<\/system>/gi,
  /\[INST\][\s\S]*?\[\/INST\]/gi,
  /\[SYS\][\s\S]*?\[\/SYS\]/gi,
  /<<\s*SYS\s*>>[\s\S]*?<<\s*\/SYS\s*>>/gi,
  /<\|im_start\|>system[\s\S]*?<\|im_end\|>/gi,
  /<\|system\|>[\s\S]*?<\|end\|>/gi,
];

export interface OutputFenceResult {
  leaked: boolean;
  cleaned: string;
  /** Which patterns were found in the output */
  matchedPatterns: string[];
}

/**
 * US-928: Detect and strip system prompt leakage from AI response.
 * Removes <system>...</system>, [INST]...[/INST], <<SYS>>...<<SYS>>,
 * and similar delimiter blocks that should never appear in guest-facing output.
 *
 * @param response - The raw AI response text
 * @returns Cleaned response with leakage indicators
 */
export function detectSystemPromptLeakage(response: string): OutputFenceResult {
  let cleaned = response;
  const matchedPatterns: string[] = [];

  for (const pattern of OUTPUT_FENCE_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    if (pattern.test(response)) {
      matchedPatterns.push(pattern.source);
      pattern.lastIndex = 0;
      cleaned = cleaned.replace(pattern, '');
    }
  }

  // Clean up residual whitespace from removals
  if (matchedPatterns.length > 0) {
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  }

  return {
    leaked: matchedPatterns.length > 0,
    cleaned,
    matchedPatterns,
  };
}


// ─── US-928: Tool Argument Validation ──────────────────────────────

export interface ToolArgValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * US-928: Validate tool call arguments against the tool's inputSchema.
 * Checks required properties exist, types match, and no dangerous values
 * (SQL injection, shell commands, arbitrary URLs) are present.
 *
 * @param args - Parsed tool arguments from the LLM
 * @param schema - The tool's inputSchema definition
 * @returns Validation result with error messages
 */
export function validateToolArgs(
  args: Record<string, unknown>,
  schema: { type: 'object'; properties: Record<string, any>; required?: string[] }
): ToolArgValidationResult {
  const errors: string[] = [];

  // Check required properties
  if (schema.required) {
    for (const req of schema.required) {
      if (args[req] === undefined || args[req] === null) {
        errors.push(`Missing required argument: ${req}`);
      }
    }
  }

  // Check property types and dangerous values
  for (const [key, value] of Object.entries(args)) {
    const propSchema = schema.properties[key];

    // Reject unknown properties not in schema
    if (!propSchema) {
      errors.push(`Unknown argument: ${key}`);
      continue;
    }

    // Type checking
    if (propSchema.type && value !== undefined && value !== null) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (propSchema.type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) {
        errors.push(`Argument '${key}' must be an integer, got ${actualType}`);
      } else if (propSchema.type !== 'integer' && actualType !== propSchema.type) {
        errors.push(`Argument '${key}' must be type ${propSchema.type}, got ${actualType}`);
      }
    }

    // Dangerous value patterns (SQL injection, shell commands)
    if (typeof value === 'string') {
      if (DANGEROUS_ARG_PATTERNS.some(p => p.test(value))) {
        errors.push(`Argument '${key}' contains potentially dangerous content`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Patterns that indicate dangerous content in tool arguments */
const DANGEROUS_ARG_PATTERNS: RegExp[] = [
  // SQL injection
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|UNION)\b\s)/i,
  /(';\s*--)/i,
  /(;\s*(DROP|DELETE|ALTER)\s)/i,
  // Shell injection
  /(\$\(|`[^`]+`|\|\s*(bash|sh|cmd|powershell))/i,
  /(;\s*(rm|del|cat|wget|curl)\s)/i,
  // Path traversal
  /\.\.\//g,
];
