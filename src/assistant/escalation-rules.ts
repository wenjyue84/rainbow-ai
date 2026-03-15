/**
 * escalation-rules.ts — Configurable escalation triggers (US-914)
 *
 * Detects high-stakes keywords (refund, cancel, complaint, legal, urgent)
 * and consecutive low-confidence AI responses. Returns structured trigger
 * reasons for the escalation pipeline.
 */

export interface EscalationRule {
  trigger: 'high_stakes_keyword' | 'consecutive_low_confidence' | 'consecutive_negative_sentiment';
  reason: string;
  detail: string;
}

// ─── High-Stakes Keyword Detection ──────────────────────────────────

const HIGH_STAKES_PATTERNS: Array<{ pattern: RegExp; keyword: string }> = [
  // English
  { pattern: /\b(refund|refunded|refunding)\b/i, keyword: 'refund' },
  { pattern: /\b(cancel|cancell?ation|cancelled)\b/i, keyword: 'cancel' },
  { pattern: /\b(complaint|complain|complaining)\b/i, keyword: 'complaint' },
  { pattern: /\b(legal|lawyer|sue|lawsuit|court)\b/i, keyword: 'legal' },
  { pattern: /\b(urgent|urgently|emergency)\b/i, keyword: 'urgent' },
  // Malay
  { pattern: /\b(bayar balik|mahu refund|nak refund|pulangkan wang)\b/i, keyword: 'refund' },
  { pattern: /\b(batal|pembatalan|cancel)\b/i, keyword: 'cancel' },
  { pattern: /\b(aduan|mengadu|buat aduan)\b/i, keyword: 'complaint' },
  { pattern: /\b(undang-undang|peguam|saman)\b/i, keyword: 'legal' },
  { pattern: /\b(segera|mendesak|kecemasan)\b/i, keyword: 'urgent' },
  // Chinese
  { pattern: /(退款|退钱|还钱)/i, keyword: 'refund' },
  { pattern: /(取消|退订)/i, keyword: 'cancel' },
  { pattern: /(投诉|举报|申诉)/i, keyword: 'complaint' },
  { pattern: /(法律|律师|起诉|法院)/i, keyword: 'legal' },
  { pattern: /(紧急|急|马上)/i, keyword: 'urgent' },
  // Tamil
  { pattern: /(பணம் திருப்பி|திருப்பிக் கொடு)/i, keyword: 'refund' },
  { pattern: /(ரத்து|நிறுத்து)/i, keyword: 'cancel' },
];

/**
 * Detect high-stakes keywords in a message.
 * Returns matched keywords or empty array if none found.
 */
export function detectHighStakesKeywords(text: string): string[] {
  const matched = new Set<string>();
  for (const { pattern, keyword } of HIGH_STAKES_PATTERNS) {
    if (pattern.test(text)) {
      matched.add(keyword);
    }
  }
  return Array.from(matched);
}

// ─── Consecutive Low-Confidence Tracking ────────────────────────────

/** Per-phone tracker for consecutive low-confidence responses */
const lowConfidenceTracker = new Map<string, { count: number; lastAt: number }>();
const TRACKER_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Track an AI confidence score for a phone number.
 * Returns the escalation rule if consecutive threshold is met.
 */
export function trackConfidenceScore(
  phone: string,
  confidence: number,
  threshold: number = 0.4,
  consecutiveLimit: number = 2,
): EscalationRule | null {
  const now = Date.now();
  const existing = lowConfidenceTracker.get(phone);

  if (confidence < threshold) {
    const count = (existing && (now - existing.lastAt) < TRACKER_TTL_MS)
      ? existing.count + 1
      : 1;
    lowConfidenceTracker.set(phone, { count, lastAt: now });

    if (count >= consecutiveLimit) {
      lowConfidenceTracker.delete(phone);
      return {
        trigger: 'consecutive_low_confidence',
        reason: `AI confidence below ${threshold} for ${count} consecutive messages`,
        detail: `confidence=${confidence.toFixed(2)}, consecutive=${count}`,
      };
    }
  } else {
    // Reset on satisfactory response
    lowConfidenceTracker.delete(phone);
  }

  return null;
}

/** Reset tracking for a phone (called on escalation resolve) */
export function resetEscalationTracking(phone: string): void {
  lowConfidenceTracker.delete(phone);
}

// ─── Case ID Generation ─────────────────────────────────────────────

let caseCounter = 0;

/**
 * Generate a human-readable case ID for escalation events.
 * Format: ESC-YYMMDD-XXXX (e.g., ESC-260315-0001)
 */
export function generateCaseId(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  caseCounter = (caseCounter + 1) % 10000;
  const seq = String(caseCounter).padStart(4, '0');
  return `ESC-${yy}${mm}${dd}-${seq}`;
}

// ─── Evaluate All Rules ─────────────────────────────────────────────

export interface EscalationRuleResult {
  shouldEscalate: boolean;
  rules: EscalationRule[];
  /** Highest-priority keyword matched, if any */
  highStakesKeywords: string[];
  caseId: string | null;
}

/**
 * Evaluate all escalation rules for a message.
 * Called from the response processor after AI response is generated.
 */
export function evaluateEscalationRules(
  phone: string,
  text: string,
  confidence: number,
  options?: {
    confidenceThreshold?: number;
    consecutiveLimit?: number;
  },
): EscalationRuleResult {
  const rules: EscalationRule[] = [];

  // Rule 1: High-stakes keywords
  const keywords = detectHighStakesKeywords(text);
  if (keywords.length > 0) {
    rules.push({
      trigger: 'high_stakes_keyword',
      reason: `High-stakes keywords detected: ${keywords.join(', ')}`,
      detail: keywords.join(', '),
    });
  }

  // Rule 2: Consecutive low confidence
  const confRule = trackConfidenceScore(
    phone,
    confidence,
    options?.confidenceThreshold ?? 0.4,
    options?.consecutiveLimit ?? 2,
  );
  if (confRule) {
    rules.push(confRule);
  }

  const shouldEscalate = rules.length > 0;
  return {
    shouldEscalate,
    rules,
    highStakesKeywords: keywords,
    caseId: shouldEscalate ? generateCaseId() : null,
  };
}
