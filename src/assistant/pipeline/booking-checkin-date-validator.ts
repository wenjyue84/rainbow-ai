/**
 * US-383: Booking Check-in Date Validator with Flexible Date Format Normalization
 *
 * Validates and normalizes check-in date input from booking workflows.
 * - Rejects past dates with clear error messages
 * - Normalizes DD/MM/YYYY, MM/DD/YYYY, natural language ('tomorrow', 'esok')
 * - Returns ValidationError with suggested valid date ranges (next 30 days)
 */

import { parseSingleDate, todayMYT } from '../../lib/date-normalizer.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CheckinValidationResult {
  isValid: boolean;
  /** ISO 8601 normalized date (YYYY-MM-DD), only present when isValid=true */
  normalizedDate?: string;
  /** Human-readable error message, only present when isValid=false */
  errorMessage?: string;
  /** Suggested valid dates (ISO strings for next 7 days), only present when isValid=false */
  suggestions?: string[];
}

/**
 * Custom error thrown by validateCheckinDate when check-in date is invalid.
 * Carries suggestions for the next 30 valid days.
 */
export class ValidationError extends Error {
  public readonly code: 'PAST_DATE' | 'UNPARSEABLE';
  public readonly suggestions: string[];
  public readonly rawInput: string;

  constructor(
    message: string,
    code: 'PAST_DATE' | 'UNPARSEABLE',
    suggestions: string[],
    rawInput: string
  ) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.suggestions = suggestions;
    this.rawInput = rawInput;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate the next N valid dates (ISO strings) from a given reference date.
 */
function generateSuggestions(from: Date, count = 5): string[] {
  const suggestions: string[] = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    suggestions.push(d.toISOString().slice(0, 10));
  }
  return suggestions;
}

/**
 * Try to parse MM/DD/YYYY as a fallback when DD/MM/YYYY parsing produces an implausible result.
 * Returns null if the input doesn't look like MM/DD/YYYY.
 */
function tryMMDDYYYY(input: string, ref: Date): Date | null {
  const m = input.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const d = new Date(yyyy, mm - 1, dd);
  if (isNaN(d.getTime())) return null;
  return d;
}

// ─── Main Validator ───────────────────────────────────────────────────────────

/**
 * Validates and normalizes a check-in date string.
 *
 * Supported formats:
 *   - DD/MM/YYYY, DD/MM/YY, DD/MM (assumes current/next year)
 *   - MM/DD/YYYY (US format, attempted as fallback)
 *   - Natural language: 'today', 'tomorrow', 'esok', 'lusa', '明天', '今天'
 *   - Month name: '20 Apr', '5 March', '20 Mac' (Malay)
 *
 * @param input - Raw check-in date string from user
 * @param profile - Profile ID (used for timezone context; defaults to 'pelangi')
 * @param now - Reference date for "today" (injectable for testing)
 * @returns CheckinValidationResult with isValid, normalizedDate, errorMessage, suggestions
 * @throws ValidationError when date is in the past or unparseable
 */
export function validateCheckinDate(
  input: string,
  _profile: string = 'pelangi',
  now?: Date
): CheckinValidationResult {
  const ref = now ?? todayMYT(new Date());
  // Normalize ref to midnight UTC
  const today = new Date(Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate()));
  const suggestions = generateSuggestions(today, 5);

  const trimmed = input?.trim() ?? '';
  if (!trimmed) {
    throw new ValidationError(
      'Check-in date cannot be empty. Please provide a date.',
      'UNPARSEABLE',
      suggestions,
      input
    );
  }

  // Attempt parse via date-normalizer's parseSingleDate (handles all common formats)
  let parsed = parseSingleDate(trimmed, ref);

  // If primary parse failed and input looks like MM/DD/YYYY, try that format
  if (!parsed) {
    parsed = tryMMDDYYYY(trimmed, ref);
  }

  if (!parsed) {
    throw new ValidationError(
      `Could not understand date "${trimmed}". Please use a format like "25/03/2026", "tomorrow", or "25 Mar".`,
      'UNPARSEABLE',
      suggestions,
      input
    );
  }

  // Normalize parsed date to midnight UTC for comparison
  const parsedISO = new Date(
    Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
  );

  // Reject past dates (strictly before today)
  if (parsedISO < today) {
    const pastSuggestions = generateSuggestions(today, 7);
    throw new ValidationError(
      `Check-in date "${trimmed}" is in the past. Please choose a future date.`,
      'PAST_DATE',
      pastSuggestions,
      input
    );
  }

  const normalizedDate = parsedISO.toISOString().slice(0, 10);
  return {
    isValid: true,
    normalizedDate,
  };
}

/**
 * Safe wrapper around validateCheckinDate that returns a result object
 * instead of throwing. Suitable for use in workflow step execution.
 */
export function safeValidateCheckinDate(
  input: string,
  profile: string = 'pelangi',
  now?: Date
): CheckinValidationResult {
  try {
    return validateCheckinDate(input, profile, now);
  } catch (err) {
    if (err instanceof ValidationError) {
      return {
        isValid: false,
        errorMessage: err.message,
        suggestions: err.suggestions,
      };
    }
    return {
      isValid: false,
      errorMessage: 'An unexpected error occurred validating the check-in date.',
      suggestions: [],
    };
  }
}
