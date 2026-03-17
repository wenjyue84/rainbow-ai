/**
 * Date Normalizer for Malaysian Booking Inputs (US-027)
 *
 * Parses free-text date input from Malaysian guests (English, Malay, Chinese)
 * and normalizes to ISO 8601 format (YYYY-MM-DD).
 *
 * Supported input formats:
 *   Numeric:  DD/MM  DD/MM/YY  DD/MM/YYYY  (also with - or . separators)
 *   Text:     DD MonthName  MonthName DD  DD MonthName YYYY
 *   Relative: today, tomorrow, esok, lusa, 今天, 明天, 后天/後天
 *
 * Malay months differ from English:
 *   Mac=March  Mei=May  Jun=June  Jul=July  Ogo=August  Okt=October  Dis=December
 *
 * Combined input separator patterns:
 *   "DATE to DATE"  "DATE hingga DATE"  "DATE - DATE"
 *   "Check-in: DATE, Check-out: DATE"  and Malay/Chinese equivalents
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type DateNormalizeOk = {
  ok: true;
  checkIn: string;   // ISO YYYY-MM-DD
  checkOut: string;  // ISO YYYY-MM-DD
  rawInput: string;
};

export type DateNormalizeError = {
  ok: false;
  error: 'past_date' | 'invalid_sequence' | 'unparseable';
  message: string;
  rawInput: string;
};

export type DateNormalizerResult = DateNormalizeOk | DateNormalizeError;

// ─── Month Maps ──────────────────────────────────────────────────────────────

// English month names and abbreviations (lowercase)
const EN_MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

// Malay month abbreviations that differ from English
const MS_MONTHS: Record<string, number> = {
  mac: 3,   // Mac = March (Malay overrides "mar")
  mei: 5,   // Mei = May
  ogo: 8,   // Ogos = August
  okt: 10,  // Oktober = October
  dis: 12,  // Disember = December
};

// Combined: Malay takes precedence for overlapping keys
const MONTH_MAP: Record<string, number> = { ...EN_MONTHS, ...MS_MONTHS };

// ─── Relative Date Lookup Sets ───────────────────────────────────────────────

// Today: English, Malay, Chinese (simplified + traditional)
const RELATIVE_TODAY = new Set([
  'today', 'hari ini', 'harini',
  '\u4eca\u5929', // 今天
  '\u4eca\u65e5', // 今日
]);

// Tomorrow: English, Malay, Chinese
const RELATIVE_TOMORROW = new Set([
  'tomorrow', 'esok',
  '\u660e\u5929', // 明天
  '\u660e\u65e5', // 明日
]);

// Day after tomorrow: English, Malay, Chinese (simplified + traditional)
const RELATIVE_DAY_AFTER = new Set([
  'day after tomorrow', 'lusa',
  '\u540e\u5929', // 后天 (simplified)
  '\u5f8c\u5929', // 後天 (traditional)
]);

// ─── Timezone ────────────────────────────────────────────────────────────────

// Asia/Kuala_Lumpur = MYT = UTC+8 (no DST)
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

export function todayMYT(now?: Date): Date {
  const base = now || new Date();
  // Shift to MYT, then extract UTC date components
  const myt = new Date(base.getTime() + MYT_OFFSET_MS);
  return new Date(Date.UTC(myt.getUTCFullYear(), myt.getUTCMonth(), myt.getUTCDate()));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setUTCDate(result.getUTCDate() + n);
  return result;
}

// ─── Single Date Parser ───────────────────────────────────────────────────────

/**
 * Parse one date token (trimmed, potentially multi-word) to a UTC midnight Date.
 * @param token  Raw date string segment (e.g., "15 Mac", "esok", "15/3/26")
 * @param today  Reference "today" date in UTC midnight (MYT context)
 * @returns Date or null if unparseable
 */
export function parseSingleDate(token: string, today: Date): Date | null {
  const t = token.trim().toLowerCase().replace(/\s+/g, ' ');

  // Relative terms
  if (RELATIVE_TODAY.has(t)) return new Date(today);
  if (RELATIVE_TOMORROW.has(t)) return addDays(today, 1);
  if (RELATIVE_DAY_AFTER.has(t)) return addDays(today, 2);

  // Numeric: DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const full3 = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (full3) {
    const day = parseInt(full3[1], 10);
    const month = parseInt(full3[2], 10);
    let year = parseInt(full3[3], 10);
    if (year < 100) year += 2000;
    if (isValidDMY(day, month, year)) return new Date(Date.UTC(year, month - 1, day));
  }

  // Numeric: DD/MM or DD-MM (no year — advance to next year if past)
  const short2 = t.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (short2) {
    const day = parseInt(short2[1], 10);
    const month = parseInt(short2[2], 10);
    if (isValidDMY(day, month, today.getUTCFullYear())) {
      const candidate = new Date(Date.UTC(today.getUTCFullYear(), month - 1, day));
      if (candidate < today) return new Date(Date.UTC(today.getUTCFullYear() + 1, month - 1, day));
      return candidate;
    }
  }

  // Text: DD MonthName [YYYY]
  const ddMon = t.match(/^(\d{1,2})\s+([a-z\u4e00-\u9fff]+)(?:\s+(\d{4}))?$/);
  if (ddMon) {
    const day = parseInt(ddMon[1], 10);
    const monthName = ddMon[2];
    const month = MONTH_MAP[monthName];
    const yearStr = ddMon[3];
    if (month) {
      const year = yearStr ? parseInt(yearStr, 10) : undefined;
      return resolveTextDate(day, month, year, today);
    }
  }

  // Text: MonthName DD [YYYY]
  const monDD = t.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  if (monDD) {
    const monthName = monDD[1];
    const day = parseInt(monDD[2], 10);
    const month = MONTH_MAP[monthName];
    const yearStr = monDD[3];
    if (month) {
      const year = yearStr ? parseInt(yearStr, 10) : undefined;
      return resolveTextDate(day, month, year, today);
    }
  }

  return null;
}

function isValidDMY(day: number, month: number, year: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2020 && year <= 2100;
}

function resolveTextDate(day: number, month: number, year: number | undefined, today: Date): Date | null {
  if (!isValidDMY(day, month, year ?? today.getUTCFullYear())) return null;
  if (year) return new Date(Date.UTC(year, month - 1, day));
  // No year: pick current year, advance to next year if date is in the past
  const candidate = new Date(Date.UTC(today.getUTCFullYear(), month - 1, day));
  if (candidate < today) return new Date(Date.UTC(today.getUTCFullYear() + 1, month - 1, day));
  return candidate;
}

// ─── Combined Input Splitter ──────────────────────────────────────────────────

/**
 * Split a combined booking input string into [checkIn, checkOut] date tokens.
 * Handles labeled (Check-in: / Check-out:) and positional formats.
 */
export function extractDateTokens(raw: string): [string, string] | null {
  const text = raw.trim();

  // 1. Labeled: "Check-in: DATE ... Check-out: DATE"
  const labelCI = text.match(
    /(?:check[-\s]?in|ci|masuk|\u5165\u4f4f)[:\s]+([^,;\n]+?)(?=\s*(?:,|;|\n|check[-\s]?out|keluar|\u9000\u623f))/i
  );
  const labelCO = text.match(
    /(?:check[-\s]?out|co|keluar|\u9000\u623f)[:\s]+([^,;\n]+)/i
  );
  if (labelCI && labelCO) {
    return [labelCI[1].trim(), labelCO[1].trim()];
  }

  // 2. Keyword separators: "DATE to/hingga/sampai/到 DATE"
  const kwMatch = text.match(/^(.+?)\s+(?:to|hingga|sampai|\u5230)\s+(.+)$/i);
  if (kwMatch) return [kwMatch[1].trim(), kwMatch[2].trim()];

  // 3. Em/en dash: "DATE – DATE" or "DATE — DATE"
  const emDash = text.match(/^(.+?)\s*[\u2013\u2014]\s*(.+)$/);
  if (emDash) return [emDash[1].trim(), emDash[2].trim()];

  // 4. Space-dash-space: "DATE - DATE" (avoids splitting DD-MM-YYYY)
  const spaceDash = text.match(/^(.+?)\s+-\s+(.+)$/);
  if (spaceDash) return [spaceDash[1].trim(), spaceDash[2].trim()];

  // 5. Comma: "DATE, DATE" (no labels)
  const comma = text.match(/^([^,]+),\s*([^,]+)$/);
  if (comma) return [comma[1].trim(), comma[2].trim()];

  return null;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Normalize a booking date input string to ISO 8601 check-in and check-out dates.
 *
 * @param rawInput     Free-text guest date input
 * @param referenceDate  Override "today" (for testing); defaults to today in MYT
 * @returns DateNormalizerResult — ok:true with ISO dates, or ok:false with error
 */
export function normalizeDates(rawInput: string, referenceDate?: Date): DateNormalizerResult {
  const today = referenceDate ? new Date(referenceDate) : todayMYT();

  const tokens = extractDateTokens(rawInput);
  if (!tokens) {
    return {
      ok: false,
      error: 'unparseable',
      message: "I couldn't extract check-in and check-out dates. Please use a format like: 15 Mar to 17 Mar.",
      rawInput,
    };
  }

  const [ciToken, coToken] = tokens;
  const checkInDate = parseSingleDate(ciToken, today);
  const checkOutDate = parseSingleDate(coToken, today);

  if (!checkInDate || !checkOutDate) {
    return {
      ok: false,
      error: 'unparseable',
      message: `I couldn't understand the dates "${ciToken}" and/or "${coToken}". Please use formats like: 15 Mac, 15/3, or 15/3/2026.`,
      rawInput,
    };
  }

  // Past date check (check-in must not be before today)
  if (checkInDate < today) {
    return {
      ok: false,
      error: 'past_date',
      message: `Check-in date ${toISODate(checkInDate)} has already passed. Please provide a future date.`,
      rawInput,
    };
  }

  // Sequence check (check-out must be strictly after check-in)
  if (checkOutDate <= checkInDate) {
    return {
      ok: false,
      error: 'invalid_sequence',
      message: `Check-out (${toISODate(checkOutDate)}) must be after check-in (${toISODate(checkInDate)}). Please correct your dates.`,
      rawInput,
    };
  }

  return {
    ok: true,
    checkIn: toISODate(checkInDate),
    checkOut: toISODate(checkOutDate),
    rawInput,
  };
}
