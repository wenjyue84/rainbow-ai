/**
 * US-947: OWASP LLM02 — Sensitive Information Disclosure Guard
 *
 * Output-side PII scanner that checks LLM responses BEFORE they reach
 * the guest. Detects phone numbers, IC numbers, emails, credit card
 * patterns, and passport numbers in AI output. If PII belonging to a
 * DIFFERENT user is found, the response is blocked and replaced with
 * an apology message; the event is logged to escalation_events.
 *
 * Also provides maskKBSensitiveFields() to redact IC/passport numbers
 * in knowledge base content before it is injected into the LLM prompt
 * or indexed into the vector store.
 */

// ─── PII Detection Patterns (output-side) ─────────────────────────

interface PiiMatch {
  type: string;
  value: string;
  /** Start index in the original text */
  index: number;
}

/**
 * Patterns tuned for OUTPUT scanning (more conservative than input redaction
 * to avoid false positives on hostel info like room numbers or prices).
 */
const OUTPUT_PII_PATTERNS: Array<{ type: string; regex: RegExp; validate?: (m: string) => boolean }> = [
  // Credit card: 16 digits optionally separated
  {
    type: 'CREDIT_CARD',
    regex: /\b(\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4})\b/g,
    validate: (match) => {
      const digits = match.replace(/[\s\-]/g, '');
      if (digits.length !== 16) return false;
      // Luhn check
      let sum = 0;
      let alt = false;
      for (let i = digits.length - 1; i >= 0; i--) {
        let n = parseInt(digits[i], 10);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
        alt = !alt;
      }
      return sum % 10 === 0;
    },
  },
  // Malaysian IC: YYMMDD-SS-NNNN (12 digits with optional dashes)
  {
    type: 'MY_IC',
    regex: /\b(\d{6})-?(\d{2})-?(\d{4})\b/g,
    validate: (match) => {
      // Basic date validation for first 6 digits (YYMMDD)
      const digits = match.replace(/-/g, '');
      if (digits.length !== 12) return false;
      const month = parseInt(digits.slice(2, 4), 10);
      const day = parseInt(digits.slice(4, 6), 10);
      return month >= 1 && month <= 12 && day >= 1 && day <= 31;
    },
  },
  // Passport: 1-2 letters + 6-9 digits
  {
    type: 'PASSPORT',
    regex: /\b([A-Z]{1,2}\d{6,9})\b/g,
  },
  // Email addresses
  {
    type: 'EMAIL',
    regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  },
  // Malaysian phone: +60... or 01X...
  {
    type: 'PHONE',
    regex: /\+?60[\s\-]?\d{1,2}[\s\-]?\d{3,4}[\s\-]?\d{4}\b/g,
  },
  {
    type: 'PHONE',
    regex: /\b0[1][0-9][\s\-]?\d{3,4}[\s\-]?\d{4}\b/g,
  },
];

// ─── Known Safe Patterns (hostel-specific) ──────────────────────────

/**
 * Patterns that look like PII but are actually safe hostel information.
 * These are whitelisted to avoid false positives.
 */
const SAFE_PATTERNS: RegExp[] = [
  // Hostel phone numbers (from KB)
  /\+?60[\s\-]?7[\s\-]?223[\s\-]?8800/g,   // Example hostel number
  // Common hostel email patterns
  /info@pelangi/gi,
  /booking@pelangi/gi,
  /privacy@/gi,
];

// ─── Normalisation ─────────────────────────────────────────────────

/** Normalise a phone number for comparison (strip spaces, dashes, leading +) */
function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\+]/g, '');
}

// ─── Core Scanner ──────────────────────────────────────────────────

export interface PiiScanResult {
  /** Whether foreign (non-owner) PII was detected in the output */
  hasForeignPii: boolean;
  /** All PII matches found */
  matches: PiiMatch[];
  /** PII types detected */
  types: string[];
}

/**
 * Scan an LLM response for PII patterns.
 *
 * @param response - The LLM-generated text to scan
 * @param ownerPhone - The phone number of the current conversation owner
 *                     (their own number is NOT flagged as foreign PII)
 * @param ownerEmail - Optional: the owner's known email (also whitelisted)
 */
export function scanOutputForPii(
  response: string,
  ownerPhone: string,
  ownerEmail?: string
): PiiScanResult {
  if (!response || typeof response !== 'string') {
    return { hasForeignPii: false, matches: [], types: [] };
  }

  const matches: PiiMatch[] = [];
  const normalizedOwnerPhone = normalizePhone(ownerPhone);

  for (const { type, regex, validate } of OUTPUT_PII_PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(response)) !== null) {
      const value = match[0];

      // Skip if validator rejects the match
      if (validate && !validate(value)) continue;

      // Whitelist: skip owner's own phone number
      if (type === 'PHONE') {
        const normalizedMatch = normalizePhone(value);
        if (
          normalizedOwnerPhone.endsWith(normalizedMatch) ||
          normalizedMatch.endsWith(normalizedOwnerPhone) ||
          normalizedOwnerPhone === normalizedMatch
        ) {
          continue;
        }
      }

      // Whitelist: skip owner's own email
      if (type === 'EMAIL' && ownerEmail) {
        if (value.toLowerCase() === ownerEmail.toLowerCase()) continue;
      }

      // Whitelist: skip known safe hostel patterns
      let isSafe = false;
      for (const safePattern of SAFE_PATTERNS) {
        safePattern.lastIndex = 0;
        if (safePattern.test(value)) {
          isSafe = true;
          break;
        }
      }
      if (isSafe) continue;

      matches.push({ type, value, index: match.index });
    }
  }

  const types = [...new Set(matches.map(m => m.type))];

  return {
    hasForeignPii: matches.length > 0,
    matches,
    types,
  };
}

// ─── Blocking / Apology Messages ────────────────────────────────────

const PII_BLOCK_MESSAGES: Record<string, string> = {
  en: "I apologize, but I'm unable to share that information as it may contain private details. For privacy protection, I can only help with your own account. Is there anything else I can help you with?\n\n-- Rainbow",
  ms: "Maaf, saya tidak dapat berkongsi maklumat tersebut kerana ia mungkin mengandungi butiran peribadi. Untuk perlindungan privasi, saya hanya boleh membantu dengan akaun anda sendiri. Ada apa-apa lagi yang boleh saya bantu?\n\n-- Rainbow",
  zh: "抱歉，我无法分享该信息，因为它可能包含私人详情。为了保护隐私，我只能帮助您处理自己的账户。还有什么我可以帮助您的吗？\n\n-- Rainbow",
};

export function getPiiBlockMessage(lang: string): string {
  return PII_BLOCK_MESSAGES[lang] || PII_BLOCK_MESSAGES.en;
}

// ─── KB Sensitive Field Masking ─────────────────────────────────────

/**
 * US-947 AC5: Mask sensitive fields (IC numbers, passport numbers) in
 * knowledge base content before it is injected into the LLM prompt or
 * indexed into the vector store. This prevents the LLM from learning
 * and regurgitating guest PII from KB documents.
 */
export function maskKBSensitiveFields(content: string): string {
  if (!content || typeof content !== 'string') return '';

  let masked = content;

  // Mask Malaysian IC numbers (YYMMDD-SS-NNNN)
  masked = masked.replace(
    /\b(\d{6})-?(\d{2})-?(\d{4})\b/g,
    (match) => {
      const digits = match.replace(/-/g, '');
      if (digits.length !== 12) return match;
      const month = parseInt(digits.slice(2, 4), 10);
      const day = parseInt(digits.slice(4, 6), 10);
      if (month < 1 || month > 12 || day < 1 || day > 31) return match;
      // Keep first 6 digits (birth date portion), mask the rest
      return `${digits.slice(0, 6)}-**-****`;
    }
  );

  // Mask passport numbers (1-2 letters + 6-9 digits)
  masked = masked.replace(
    /\b([A-Z]{1,2})(\d{6,9})\b/g,
    (_, letters, digits) => `${letters}${'*'.repeat(digits.length)}`
  );

  return masked;
}
