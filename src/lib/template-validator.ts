/**
 * WhatsApp Template Category Auto-Validator (US-906)
 *
 * Pure function that validates a template body for common rejection triggers.
 * Runs client-side (real-time) and server-side (on PUT /admin/wa-templates/:name).
 *
 * Reference: https://support.wati.io/en/articles/11463457-best-practices-to-avoid-template-message-rejection
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type WarningSeverity = 'error' | 'warning' | 'info';

export interface TemplateWarning {
  code: string;
  message: string;
  severity: WarningSeverity;
}

// ─── Default promotional keyword list ────────────────────────────────────────
// Configurable via admin settings (passed in as optional param).

export const DEFAULT_PROMO_KEYWORDS: string[] = [
  'discount',
  'offer',
  'buy now',
  'click here',
  'limited time',
  'free',
  'sale',
  'deal',
  'promo',
  'promotion',
  'save',
  'exclusive',
  'special offer',
  'act now',
  'order now',
  'shop now',
  'don\'t miss',
  'hurry',
  'expires',
  'coupon',
  'voucher',
  'cashback',
];

// ─── Variable placeholder regex ───────────────────────────────────────────────

const VARIABLE_AT_START = /^\{\{[^}]+\}\}/;
const VARIABLE_AT_END = /\{\{[^}]+\}\}$/;

// ─── validateTemplate ─────────────────────────────────────────────────────────

/**
 * Validates a WhatsApp message template body for common rejection triggers.
 *
 * @param body              - Template body text
 * @param existingTemplates - Array of existing template bodies in the same profile (for duplicate check)
 * @param promoKeywords     - Optional override for promotional keyword list
 * @returns Array of TemplateWarning objects (empty = no issues found)
 */
export function validateTemplate(
  body: string,
  existingTemplates: string[] = [],
  promoKeywords: string[] = DEFAULT_PROMO_KEYWORDS,
): TemplateWarning[] {
  const warnings: TemplateWarning[] = [];

  if (!body || typeof body !== 'string') {
    return warnings;
  }

  const trimmed = body.trim();
  const lower = trimmed.toLowerCase();

  // ─── Check 1: Promotional keywords ──────────────────────────────────────────
  const foundKeywords: string[] = [];
  for (const kw of promoKeywords) {
    if (lower.includes(kw.toLowerCase())) {
      foundKeywords.push(kw);
    }
  }
  if (foundKeywords.length > 0) {
    warnings.push({
      code: 'PROMOTIONAL_KEYWORD',
      message: `Template contains promotional keywords that may trigger reclassification as a marketing template: ${foundKeywords.map(k => `"${k}"`).join(', ')}. This can change delivery cost and characteristics.`,
      severity: 'warning',
    });
  }

  // ─── Check 2: Body starts with a {{variable}} placeholder ────────────────────
  if (VARIABLE_AT_START.test(trimmed)) {
    warnings.push({
      code: 'STARTS_WITH_VARIABLE',
      message: 'Template body starts with a variable placeholder ({{...}}). Meta may reject templates that begin with a variable.',
      severity: 'warning',
    });
  }

  // ─── Check 3: Body ends with a {{variable}} placeholder ──────────────────────
  if (VARIABLE_AT_END.test(trimmed)) {
    warnings.push({
      code: 'ENDS_WITH_VARIABLE',
      message: 'Template body ends with a variable placeholder ({{...}}). Meta may reject templates that end with a variable.',
      severity: 'warning',
    });
  }

  // ─── Check 4: Duplicate body text ────────────────────────────────────────────
  const normalised = trimmed.replace(/\s+/g, ' ');
  const duplicate = existingTemplates.some(existing => {
    const existingNorm = (existing || '').trim().replace(/\s+/g, ' ');
    return existingNorm === normalised;
  });
  if (duplicate) {
    warnings.push({
      code: 'DUPLICATE_BODY',
      message: 'A template with identical body text already exists in this profile. Meta rejects duplicate templates.',
      severity: 'error',
    });
  }

  return warnings;
}
