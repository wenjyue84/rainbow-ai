/**
 * Date validation utilities for booking workflow
 * Validates check-in/check-out dates and provides suggestions for past dates
 */

export interface DateValidationResult {
  isValid: boolean;
  checkInDate?: string; // YYYY-MM-DD
  checkOutDate?: string; // YYYY-MM-DD
  suggestedCheckIn?: string; // YYYY-MM-DD if check-in is in the past
  suggestedCheckOut?: string; // YYYY-MM-DD if check-out is in the past
  reason?: string;
}

/**
 * Parse ISO date string to Date object with validation
 * Returns null if the date is invalid or doesn't match expected format
 */
function parseISODate(dateStr: string): Date | null {
  // Validate ISO format: YYYY-MM-DD
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch) return null;

  const year = parseInt(isoMatch[1], 10);
  const month = parseInt(isoMatch[2], 10);
  const day = parseInt(isoMatch[3], 10);

  // Validate ranges
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const parsed = new Date(year, month - 1, day);

  // Check if the parsed date matches the input (e.g., Feb 30 -> invalid)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

/**
 * Format Date to YYYY-MM-DD
 */
function formatToISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get today's date at 00:00 UTC
 */
function getTodayUTC(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * Check if a date is in the past or today (on or before today at 00:00 UTC)
 * Check-in cannot be today; earliest is tomorrow
 */
export function isDateInPast(dateStr: string): boolean {
  const parsed = parseISODate(dateStr);
  if (!parsed) return false;

  // Set to 00:00 for comparison
  parsed.setHours(0, 0, 0, 0);

  const today = getTodayUTC();
  return parsed <= today;
}

/**
 * Get the next available date (tomorrow or later)
 * If today is the proposed check-in, suggests tomorrow
 * If past date is proposed, suggests tomorrow
 */
export function getNextAvailableDate(fromDate?: string): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  return formatToISO(tomorrow);
}

/**
 * Get a date 1 month from a given date, handling month-end edge cases
 * Example: Jan 31 + 1 month = Feb 28 (last day of Feb in non-leap year)
 */
export function getDateOneMonthLater(fromDate: string): string {
  const parsed = parseISODate(fromDate);
  if (!parsed) {
    // Fallback to 1 month from tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setMonth(tomorrow.getMonth() + 1);
    return formatToISO(tomorrow);
  }

  const future = new Date(parsed);
  const targetMonth = future.getMonth() + 1;
  const targetYear = targetMonth > 11 ? future.getFullYear() + 1 : future.getFullYear();
  const actualMonth = targetMonth > 11 ? 0 : targetMonth;

  // Get the last day of the target month
  const lastDay = new Date(targetYear, actualMonth + 1, 0).getDate();
  const day = Math.min(parsed.getDate(), lastDay);

  future.setFullYear(targetYear);
  future.setMonth(actualMonth);
  future.setDate(day);
  return formatToISO(future);
}

/**
 * Validate booking dates: check-in and check-out
 * Returns validation result with suggested dates if check-in is in the past
 *
 * Rules:
 * - Check-in must be tomorrow or later (not today, not past)
 * - Check-out must be after check-in
 * - If check-in is today or earlier, suggest tomorrow as new check-in
 * - If check-out is in the past/invalid, suggest 1 month after new check-in
 */
export function validateBookingDates(
  checkInStr: string,
  checkOutStr: string
): DateValidationResult {
  const checkInParsed = parseISODate(checkInStr);
  const checkOutParsed = parseISODate(checkOutStr);

  // Invalid date formats
  if (!checkInParsed || !checkOutParsed) {
    return {
      isValid: false,
      reason: 'Invalid date format. Expected YYYY-MM-DD.'
    };
  }

  const today = getTodayUTC();
  const checkInTime = new Date(checkInParsed);
  checkInTime.setHours(0, 0, 0, 0);

  const checkOutTime = new Date(checkOutParsed);
  checkOutTime.setHours(0, 0, 0, 0);

  // Check if check-in is today or earlier (should be tomorrow at earliest)
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let finalCheckIn = checkInStr;
  let finalCheckOut = checkOutStr;
  let suggestedCheckIn: string | undefined;
  let suggestedCheckOut: string | undefined;
  let hasErrors = false;

  // If check-in is today or earlier, suggest tomorrow
  if (checkInTime <= today) {
    suggestedCheckIn = formatToISO(tomorrow);
    finalCheckIn = suggestedCheckIn;
    hasErrors = true;
  }

  // Check if check-out is after the (potentially adjusted) check-in
  const finalCheckInTime = new Date(parseISODate(finalCheckIn)!);
  finalCheckInTime.setHours(0, 0, 0, 0);

  if (checkOutTime <= finalCheckInTime) {
    // Suggest check-out as 1 month after the (potentially adjusted) check-in
    suggestedCheckOut = getDateOneMonthLater(finalCheckIn);
    finalCheckOut = suggestedCheckOut;
    hasErrors = true;
  }

  return {
    isValid: !hasErrors,
    checkInDate: finalCheckIn,
    checkOutDate: finalCheckOut,
    suggestedCheckIn,
    suggestedCheckOut,
    reason: hasErrors
      ? 'Check-in date is today or earlier. Suggesting next available dates.'
      : undefined
  };
}

/**
 * Format validation result as a human-readable message
 */
export function formatDateValidationMessage(
  result: DateValidationResult,
  language: 'en' | 'ms' | 'zh' = 'en'
): string {
  if (result.isValid) {
    return '';
  }

  if (!result.suggestedCheckIn && !result.suggestedCheckOut) {
    const messages: Record<string, string> = {
      en: `Sorry, the dates you provided are invalid. ${result.reason || 'Please try again.'}`,
      ms: `Maaf, tarikh yang anda berikan tidak sah. ${result.reason || 'Sila cuba semula.'}`,
      zh: `抱歉，您提供的日期无效。${result.reason || '请重试。'}`
    };
    return messages[language];
  }

  const messages: Record<string, string> = {
    en: `Sorry, check-in date cannot be today or earlier. I suggest:\nCheck-in: ${result.suggestedCheckIn || result.checkInDate}\nCheck-out: ${result.suggestedCheckOut || result.checkOutDate}\n\nWould these dates work for you?`,
    ms: `Maaf, tarikh check-in tidak boleh hari ini atau sebelumnya. Saya cadangkan:\nCheck-in: ${result.suggestedCheckIn || result.checkInDate}\nCheck-out: ${result.suggestedCheckOut || result.checkOutDate}\n\nAdakah tarikh ini sesuai untuk anda?`,
    zh: `抱歉，入住日期不能是今天或更早。我建议：\n入住：${result.suggestedCheckIn || result.checkInDate}\n退房：${result.suggestedCheckOut || result.checkOutDate}\n\n这些日期对您合适吗？`
  };

  return messages[language];
}
