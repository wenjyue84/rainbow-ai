/**
 * US-946: OWASP LLM05 — Output Sanitization
 *
 * Sanitizes LLM-generated output before sending to downstream consumers
 * (webchat widget, WhatsApp, external APIs). Prevents XSS via embedded
 * HTML/script tags and strips dangerous content from AI responses.
 */

// ─── HTML Entity Escaping ───────────────────────────────────────────

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
};

const HTML_ESCAPE_RE = /[&<>"']/g;

/**
 * Escape HTML entities in a string to prevent XSS.
 * Use this for any LLM output rendered in an HTML context (webchat widget).
 */
export function escapeHtml(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text.replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPE_MAP[ch] || ch);
}

// ─── Dangerous Content Stripping ────────────────────────────────────

/**
 * Patterns that should never appear in guest-facing LLM output.
 * These indicate the LLM was manipulated into generating dangerous content.
 */
const DANGEROUS_OUTPUT_PATTERNS: RegExp[] = [
  // Script injection
  /<script[\s>]/gi,
  /<\/script>/gi,
  // Event handlers
  /\bon\w+\s*=\s*["']/gi,
  // JavaScript URIs
  /javascript\s*:/gi,
  // Data URIs (potential XSS vector)
  /data\s*:\s*text\/html/gi,
  // iframe injection
  /<iframe[\s>]/gi,
  /<\/iframe>/gi,
  // object/embed injection
  /<object[\s>]/gi,
  /<embed[\s>]/gi,
  // SVG with scripts
  /<svg[\s>][\s\S]*?<script/gi,
  // Base tag hijacking
  /<base[\s>]/gi,
  // Form injection
  /<form[\s>]/gi,
  // Meta refresh
  /<meta[\s>]/gi,
];

/**
 * Strip dangerous HTML patterns from LLM output.
 * Unlike escapeHtml (which encodes ALL HTML), this selectively removes
 * only dangerous patterns while preserving safe formatting.
 */
export function stripDangerousHtml(text: string): string {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;
  for (const pattern of DANGEROUS_OUTPUT_PATTERNS) {
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned;
}

// ─── Webchat Output Sanitizer ───────────────────────────────────────

export interface SanitizeResult {
  text: string;
  wasSanitized: boolean;
  /** Patterns that were stripped (for logging, not user-facing) */
  strippedPatterns: string[];
}

/**
 * US-946: Sanitize LLM output for webchat widget rendering.
 * Strips dangerous HTML/JS patterns and escapes remaining HTML entities.
 * This is the primary defense against OWASP LLM05 for webchat output.
 *
 * @param text - Raw LLM response text
 * @returns Sanitized text safe for HTML rendering
 */
export function sanitizeWebchatOutput(text: string): SanitizeResult {
  if (!text || typeof text !== 'string') {
    return { text: '', wasSanitized: false, strippedPatterns: [] };
  }

  const strippedPatterns: string[] = [];
  let cleaned = text;

  // Step 1: Detect and log dangerous patterns
  for (const pattern of DANGEROUS_OUTPUT_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(cleaned)) {
      strippedPatterns.push(pattern.source);
      pattern.lastIndex = 0;
      cleaned = cleaned.replace(pattern, '');
    }
  }

  // Step 2: Escape remaining HTML entities for safe rendering
  cleaned = escapeHtml(cleaned.trim());

  return {
    text: cleaned,
    wasSanitized: strippedPatterns.length > 0,
    strippedPatterns,
  };
}

// ─── Tool Error Sanitizer ───────────────────────────────────────────

/**
 * US-946: Create a safe error message for failed tool invocations.
 * Strips internal details (schema names, argument names, SQL patterns)
 * and returns a generic message suitable for the LLM to relay to users.
 */
export function sanitizeToolError(toolName: string, errors: string[]): string {
  // Generic message — never expose validation details to end users
  const safeToolName = toolName.replace(/[^a-zA-Z0-9_-]/g, '');
  return `Tool '${safeToolName}' could not be executed due to invalid parameters. Please try rephrasing your request.`;
}
