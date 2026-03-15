/**
 * PII Redactor (US-421)
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
 * - Malaysian phone numbers
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
  // Malaysian phone numbers — MUST come before BANK_ACCOUNT to avoid 10+ digit phone being caught as bank account
  // Formats: +60123456789, 60123456789, 012-3456789, 0176543210, +60 12-345 6789
  {
    label: 'PHONE',
    regex: /\+?60[\s\-]?\d{1,2}[\s\-]?\d{3,4}[\s\-]?\d{4}\b|(?<!\d)0\d{1,2}[\s\-]?\d{3,4}[\s\-]?\d{4}(?!\d)/g,
  },
  // Bank account: 10-16 consecutive digits (not already matched as CC or IC or phone)
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
