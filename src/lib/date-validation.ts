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
 * Parse ISO date string to Date object
 */
function parseISODate(dateStr: string): Date | null {
  const parsed = new Date(dateStr);
  return !isNaN(parsed.getTime()) ? parsed : null;
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
 * Check if a date is in the past (before today at 00:00 UTC)
 */
export function isDateInPast(dateStr: string): boolean {
  const parsed = parseISODate(dateStr);
  if (!parsed) return false;

  // Set to 00:00 for comparison
  parsed.setHours(0, 0, 0, 0);

  const today = getTodayUTC();
  return parsed < today;
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
 * Get a date 1 month from a given date
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
  future.setMonth(future.getMonth() + 1);
  return formatToISO(future);
}

/**
 * Validate booking dates: check-in and check-out
 * Returns validation result with suggested dates if check-in is in the past
 *
 * Rules:
 * - Check-in must be today or later (tomorrow minimum)
 * - Check-out must be after check-in
 * - If check-in is in the past, suggest tomorrow as new check-in
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

  // Check if check-in is today (should be tomorrow at earliest)
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let finalCheckIn = checkInStr;
  let finalCheckOut = checkOutStr;
  let suggestedCheckIn: string | undefined;
  let suggestedCheckOut: string | undefined;

  // If check-in is today or earlier, suggest tomorrow
  if (checkInTime <= today) {
    suggestedCheckIn = formatToISO(tomorrow);
    finalCheckIn = suggestedCheckIn;
  }

  // Check if check-out is after check-in
  if (checkOutTime <= checkInTime) {
    // Suggest check-out as 1 month after the (potentially adjusted) check-in
    suggestedCheckOut = getDateOneMonthLater(finalCheckIn);
    finalCheckOut = suggestedCheckOut;
  }

  return {
    isValid: !suggestedCheckIn && !suggestedCheckOut,
    checkInDate: finalCheckIn,
    checkOutDate: finalCheckOut,
    suggestedCheckIn,
    suggestedCheckOut,
    reason:
      suggestedCheckIn || suggestedCheckOut
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
