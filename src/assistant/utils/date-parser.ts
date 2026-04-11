/**
 * US-455: Booking Intent Date Parser for Flexible Date Formats
 *
 * Extracts and normalizes dates from user input in various formats:
 * - DD/MM/YYYY, DD/MM/YY, DD/MM
 * - Natural language: "tomorrow", "next week", "in X days", "this weekend"
 *
 * Returns array of ExtractedDate objects with normalized ISO format and confidence.
 */

export interface ExtractedDate {
  /** Original matched text from user input */
  original: string;
  /** Parsed date as ISO 8601 string (YYYY-MM-DD) */
  iso: string;
  /** Type of format detected: 'ddmmyyyy', 'ddmmyy', 'ddmm', 'natural_language', or 'unknown' */
  format: string;
  /** Confidence score (0-1) for the extraction accuracy */
  confidence: number;
  /** Human-readable interpretation (e.g., "March 15, 2025") */
  interpreted: string;
}

/**
 * Parse and extract all dates from user input.
 * Handles multiple date formats and natural language phrases.
 *
 * @param input User message text
 * @returns Array of ExtractedDate objects (empty if no dates found)
 */
export function parseFlexibleDate(input: string): ExtractedDate[] {
  if (!input || typeof input !== 'string') {
    return [];
  }

  const results: ExtractedDate[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize to midnight UTC

  // === STRATEGY 1: DD/MM/YYYY format (e.g., "15/03/2025") ===
  const ddmmyyyyPattern = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  let match;
  const ddmmyyyyMatches = new Set<string>();

  while ((match = ddmmyyyyPattern.exec(input)) !== null) {
    const original = match[0];
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);

    if (isValidDate(day, month, year)) {
      if (!ddmmyyyyMatches.has(original)) {
        ddmmyyyyMatches.add(original);
        const date = new Date(year, month - 1, day);
        results.push({
          original,
          iso: formatAsISO(date),
          format: 'ddmmyyyy',
          confidence: 0.95,
          interpreted: formatAsHumanReadable(date),
        });
      }
    }
  }

  // === STRATEGY 2: DD/MM/YY format (e.g., "15/03/25") ===
  const ddmmyyPattern = /\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/g;
  const ddmmyyMatches = new Set<string>();

  while ((match = ddmmyyPattern.exec(input)) !== null) {
    const original = match[0];
    // Skip if already matched by DD/MM/YYYY
    if (ddmmyyyyMatches.has(original)) {
      continue;
    }

    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    let year = parseInt(match[3], 10);

    // Convert 2-digit year to 4-digit (00-30 → 2000-2030, 31-99 → 1931-1999)
    if (year <= 30) {
      year += 2000;
    } else {
      year += 1900;
    }

    if (isValidDate(day, month, year)) {
      if (!ddmmyyMatches.has(original)) {
        ddmmyyMatches.add(original);
        const date = new Date(year, month - 1, day);
        results.push({
          original,
          iso: formatAsISO(date),
          format: 'ddmmyy',
          confidence: 0.90,
          interpreted: formatAsHumanReadable(date),
        });
      }
    }
  }

  // === STRATEGY 3: DD/MM format (e.g., "15/03") ===
  // Only match if not immediately followed by digits (to avoid matching first part of DD/MM/YY)
  const ddmmPattern = /\b(\d{1,2})\/(\d{1,2})(?!\/\d)/g;
  const ddmmMatches = new Set<string>();
  // Track positions of DD/MM/YYYY and DD/MM/YY matches to avoid overlap
  const positionsToSkip = new Set<string>();
  for (const m of Array.from(ddmmyyyyMatches)) {
    positionsToSkip.add(m);
  }
  for (const m of Array.from(ddmmyyMatches)) {
    positionsToSkip.add(m);
  }

  while ((match = ddmmPattern.exec(input)) !== null) {
    const original = match[0];
    // Skip if already matched by DD/MM/YYYY or DD/MM/YY
    if (positionsToSkip.has(original)) {
      continue;
    }

    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    // Use current year as default
    const year = today.getFullYear();

    if (isValidDate(day, month, year)) {
      if (!ddmmMatches.has(original)) {
        ddmmMatches.add(original);
        const date = new Date(year, month - 1, day);
        // For DD/MM format, lower confidence since we assume current year
        const isFutureDate = date >= today;
        results.push({
          original,
          iso: formatAsISO(date),
          format: 'ddmm',
          confidence: isFutureDate ? 0.85 : 0.50, // Past dates less likely intended
          interpreted: formatAsHumanReadable(date),
        });
      }
    }
  }

  // === STRATEGY 4: Natural language patterns ===
  const naturalLanguageResults = parseNaturalLanguage(input, today);
  results.push(...naturalLanguageResults);

  return results;
}

/**
 * Parse natural language date expressions.
 *
 * Handles:
 * - "tomorrow"
 * - "next week"
 * - "this weekend"
 * - "in X days"
 * - "in X weeks"
 * - "in X months"
 */
function parseNaturalLanguage(input: string, today: Date): ExtractedDate[] {
  const results: ExtractedDate[] = [];
  const lowerInput = input.toLowerCase();

  // "tomorrow"
  if (/\btomorrow\b|\bbesok\b/.test(lowerInput)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    results.push({
      original: 'tomorrow',
      iso: formatAsISO(tomorrow),
      format: 'natural_language',
      confidence: 0.98,
      interpreted: formatAsHumanReadable(tomorrow),
    });
  }

  // "today"
  if (/\btoday\b|\bhari\s+ini\b/.test(lowerInput)) {
    results.push({
      original: 'today',
      iso: formatAsISO(today),
      format: 'natural_language',
      confidence: 0.98,
      interpreted: formatAsHumanReadable(today),
    });
  }

  // "next week" / "next monday" etc.
  if (/\bnext\s+week\b|\bbulan\s+depan\b/.test(lowerInput)) {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    results.push({
      original: 'next week',
      iso: formatAsISO(nextWeek),
      format: 'natural_language',
      confidence: 0.80,
      interpreted: `${formatAsHumanReadable(nextWeek)} (in 7 days)`,
    });
  }

  // "next monday", "next tuesday", etc.
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const malayDayNames = ['ahad', 'isnin', 'selasa', 'rabu', 'khamis', 'jumaat', 'sabtu'];
  const allDayNames = [...dayNames, ...malayDayNames];

  for (let i = 0; i < dayNames.length; i++) {
    const pattern = new RegExp(`\\bnext\\s+${dayNames[i]}\\b|\\bnext\\s+${malayDayNames[i]}\\b`, 'i');
    if (pattern.test(lowerInput)) {
      const nextDay = getNextDayOfWeek(today, i);
      results.push({
        original: `next ${dayNames[i]}`,
        iso: formatAsISO(nextDay),
        format: 'natural_language',
        confidence: 0.88,
        interpreted: formatAsHumanReadable(nextDay),
      });
    }
  }

  // "this weekend" (Saturday or Sunday, whichever is closest)
  if (/\bthis\s+weekend\b|\bhujung\s+minggu\s+ini\b/.test(lowerInput)) {
    const saturday = getNextDayOfWeek(today, 6); // Saturday
    const sunday = getNextDayOfWeek(today, 0); // Sunday
    // Return Saturday as primary interpretation
    results.push({
      original: 'this weekend',
      iso: formatAsISO(saturday),
      format: 'natural_language',
      confidence: 0.75,
      interpreted: `${formatAsHumanReadable(saturday)} (Saturday)`,
    });
  }

  // "in X days" / "in X weeks" / "in X months" / "dalam X hari/minggu/bulan"
  const inPattern = /(?:in|dalam|dalam\s+)\s+(\d+)\s+(days?|weeks?|months?|bulan|hari|minggu)\b/gi;
  let inMatch;
  const seenPatterns = new Set<string>();

  while ((inMatch = inPattern.exec(lowerInput)) !== null) {
    const original = inMatch[0];
    if (seenPatterns.has(original)) continue;
    seenPatterns.add(original);

    const num = parseInt(inMatch[1], 10);
    const unit = inMatch[2].toLowerCase();

    let targetDate = new Date(today);
    let isValid = true;

    if (unit.includes('day') || unit === 'hari') {
      targetDate.setDate(targetDate.getDate() + num);
    } else if (unit.includes('week') || unit === 'minggu') {
      targetDate.setDate(targetDate.getDate() + num * 7);
    } else if (unit.includes('month') || unit === 'bulan') {
      targetDate.setMonth(targetDate.getMonth() + num);
    } else {
      isValid = false;
    }

    if (isValid && num > 0 && num <= 365) {
      results.push({
        original,
        iso: formatAsISO(targetDate),
        format: 'natural_language',
        confidence: 0.85,
        interpreted: `${formatAsHumanReadable(targetDate)} (in ${num} ${unit})`,
      });
    }
  }

  return results;
}

/**
 * Check if a given day/month/year combination is valid.
 * Handles leap years and month boundaries.
 */
function isValidDate(day: number, month: number, year: number): boolean {
  // Basic range checks
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1900 || year > 2100) return false;

  // Create date and verify it didn't roll over (e.g., Feb 30)
  const date = new Date(year, month - 1, day);
  return date.getDate() === day && date.getMonth() === month - 1 && date.getFullYear() === year;
}

/**
 * Format a date as ISO 8601 (YYYY-MM-DD).
 */
function formatAsISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a date as human-readable string (e.g., "March 15, 2025").
 */
function formatAsHumanReadable(date: Date): string {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * Get the date of the next occurrence of a given day of week.
 * dayOfWeek: 0 (Sunday) to 6 (Saturday)
 */
function getNextDayOfWeek(fromDate: Date, targetDayOfWeek: number): Date {
  const date = new Date(fromDate);
  const currentDayOfWeek = date.getDay();

  // Calculate days to add
  let daysToAdd = targetDayOfWeek - currentDayOfWeek;
  if (daysToAdd <= 0) {
    daysToAdd += 7; // Next occurrence
  }

  date.setDate(date.getDate() + daysToAdd);
  return date;
}
