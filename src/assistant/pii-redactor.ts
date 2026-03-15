/**
 * PII Redactor (US-421, US-915)
 *
 * Detects and redacts sensitive PII patterns from message text before
 * it is sent to external LLM providers or written to structured logs.
 *
 * Covered patterns:
 * - Credit card numbers (Luhn-valid 16-digit sequences)
 * - Malaysian IC numbers (YYMMDD-SS-NNNN format)
 * - International passport numbers
 * - Bank account numbers (10-16 digit sequences)
 * - Email addresses
 * - Malaysian phone numbers (+60 / 60 / 01X formats)
 *
 * US-915 (PDPA 2024): Added Malaysian phone number patterns and
 * maskPiiForProvider() for pre-API-call masking.
 */

export interface RedactionResult {
  /** The redacted text with PII replaced by labelled placeholders. */
  redacted: string;
  /** Whether any PII was found and redacted. */
  hadPii: boolean;
  /** List of PII types that were redacted. */
  types: string[];
}

// ─── Luhn Algorithm ────────────────────────────────────────────────

function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

// ─── PII Pattern Definitions ───────────────────────────────────────

interface PiiPattern {
  label: string;
  regex: RegExp;
  /** Optional validator — if provided, match is only redacted when validator returns true. */
  validate?: (match: string) => boolean;
}

const PII_PATTERNS: PiiPattern[] = [
  // Credit card: 16 digits, optionally separated by spaces or dashes
  {
    label: 'CREDIT_CARD',
    regex: /\b(\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4})\b/g,
    validate: (match) => isLuhnValid(match.replace(/[\s\-]/g, '')),
  },
  // Malaysian IC: YYMMDD-SS-NNNN or YYMMDDSSNNNN
  {
    label: 'MY_IC',
    regex: /\b(\d{6})-?(\d{2})-?(\d{4})\b/g,
  },
  // International passport: 1-2 letters followed by 6-9 digits
  {
    label: 'PASSPORT',
    regex: /\b([A-Z]{1,2}\d{6,9})\b/g,
  },
  // US-915: Malaysian phone numbers — must be BEFORE BANK_ACCOUNT to match first
  // +60XXXXXXXXX, 60XXXXXXXXX, +60-12-345-6789, +60 12 3456 7890 (country code formats)
  {
    label: 'PHONE',
    regex: /\+?60[\s\-]?\d{1,2}[\s\-]?\d{3,4}[\s\-]?\d{4}\b/g,
  },
  // 01X-XXXXXXX, 01XXXXXXXXX (local formats)
  {
    label: 'PHONE',
    regex: /\b0[1][0-9][\s\-]?\d{3,4}[\s\-]?\d{4}\b/g,
  },
  // Bank account: 10-16 consecutive digits (not already matched as CC, IC, or PHONE)
  {
    label: 'BANK_ACCOUNT',
    regex: /\b(\d{10,16})\b/g,
  },
  // Email address
  {
    label: 'EMAIL',
    regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  },
];

// ─── Main Redactor ─────────────────────────────────────────────────

/**
 * Redact PII from a message string.
 *
 * Replaces matched patterns with `[TYPE_REDACTED]` placeholders.
 * Patterns are applied in order; once a span of text is replaced,
 * subsequent patterns cannot match it (the text is already replaced).
 *
 * @param text - Raw message text
 * @returns RedactionResult with redacted text and metadata
 */
export function redactPii(text: string): RedactionResult {
  let result = text;
  const types = new Set<string>();

  for (const { label, regex, validate } of PII_PATTERNS) {
    // Reset regex lastIndex before each application
    regex.lastIndex = 0;

    result = result.replace(regex, (match) => {
      if (validate && !validate(match)) return match;
      types.add(label);
      return `[${label}_REDACTED]`;
    });
  }

  return {
    redacted: result,
    hadPii: types.size > 0,
    types: [...types],
  };
}

// ─── US-915: PDPA 2024 — Provider-level PII masking ─────────────

/**
 * Mask PII in an array of chat messages before sending to an AI provider.
 * Returns a new array with PII redacted; original messages are not mutated.
 * Also replaces guest names (push_name style) with 'Guest' when provided.
 */
export function maskPiiForProvider(
  messages: Array<{ role: string; content: string | any }>,
  guestName?: string
): { masked: Array<{ role: string; content: string | any }>; categories: string[] } {
  const allTypes = new Set<string>();

  const masked = messages.map(msg => {
    // Only mask string content (skip system messages with cache_control objects)
    if (typeof msg.content !== 'string') return msg;

    let text = msg.content;

    // Replace known guest name with 'Guest' (case-insensitive, whole word)
    if (guestName && guestName.length >= 2) {
      const escaped = guestName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const nameRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
      if (nameRegex.test(text)) {
        text = text.replace(nameRegex, 'Guest');
        allTypes.add('GUEST_NAME');
      }
    }

    // Apply all PII patterns
    const result = redactPii(text);
    for (const t of result.types) allTypes.add(t);

    return { ...msg, content: result.redacted };
  });

  return { masked, categories: [...allTypes] };
}
