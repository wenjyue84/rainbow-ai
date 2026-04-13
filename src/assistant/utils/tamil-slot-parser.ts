/**
 * US-598: Tamil Numeral and Date Slot Extractor
 *
 * Parses Tamil numerals (௦-௯), month names, and dates from booking messages.
 * Enables accurate slot filling for Tamil-language guests.
 *
 * Functions:
 * - parseTamilNumeral(char): convert single Tamil digit to Arabic
 * - parseDateSlot(text): extract Tamil month names and dates
 * - parseQuantitySlot(text): extract quantity from text
 * - parseSlots(text): main function returning extracted booking slots
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tamil numerals mapping: ௦=0, ௧=1, ௨=2, ..., ௯=9
const TAMIL_NUMERALS: Record<string, string> = {
  '௦': '0',
  '௧': '1',
  '௨': '2',
  '௩': '3',
  '௪': '4',
  '௫': '5',
  '௬': '6',
  '௭': '7',
  '௮': '8',
  '௯': '9',
};

// Cache for Tamil month mappings (lazy-loaded)
let tamilMonthMap: Record<string, string> | null = null;

/**
 * Lazy-load Tamil month mapping from JSON file.
 * Falls back to hardcoded mapping if file not found.
 */
function loadTamilMonthMap(): Record<string, string> {
  if (tamilMonthMap !== null) {
    return tamilMonthMap;
  }

  try {
    const mapPath = path.join(__dirname, '..', 'data', 'tamil-month-map.json');
    const fileContent = fs.readFileSync(mapPath, 'utf-8');
    tamilMonthMap = JSON.parse(fileContent);
  } catch {
    // Fallback to hardcoded Tamil months
    tamilMonthMap = {
      'ஜனவரி': '01',
      'பிப்ரவரி': '02',
      'மார்ச்': '03',
      'ஏப்ரல்': '04',
      'மே': '05',
      'ஜூன்': '06',
      'ஜூலை': '07',
      'ஆகஸ்ட்': '08',
      'செப்டம்பர்': '09',
      'டிசம்பர்': '12',
      'ஜனவரை': '01',
      'பிப்ரவரை': '02',
      'மார்ச்ஸ்': '03',
      'ஏப்ரல்': '04',
      'மாய்': '05',
      'ஜூன்': '06',
      'ஜூலாய்': '07',
      'ஆகஸ்ட்': '08',
      'செப்டம்பர்': '09',
      'நவம்பர்': '11',
      'டிசம்பர்': '12',
    };
  }

  return tamilMonthMap;
}

/**
 * Convert a single Tamil numeral character to Arabic numeral string.
 *
 * @param char - Single character (e.g., '௦', '௧')
 * @returns Arabic numeral string ('0'-'9') or original char if not Tamil numeral
 */
export function parseTamilNumeral(char: string): string {
  return TAMIL_NUMERALS[char] ?? char;
}

/**
 * Convert Tamil numerals in a string to Arabic numerals.
 * Handles mixed Tamil/Arabic input.
 *
 * @param text - Input text potentially containing Tamil numerals
 * @returns Text with Tamil numerals converted to Arabic (0-9)
 */
export function convertTamilNumerals(text: string): string {
  return text
    .split('')
    .map(char => parseTamilNumeral(char))
    .join('');
}

/**
 * Extract quantity slot from text.
 * Looks for number patterns (both Arabic and Tamil) followed by quantity keywords.
 *
 * Examples: "௧ rooms", "2 நபர்கள்", "three guests"
 *
 * @param text - Input text
 * @returns Object with quantity (1-10, or undefined) and confidence
 */
export function parseQuantitySlot(text: string): { quantity?: number; confidence: number } {
  const normalized = text.toLowerCase().trim();
  const converted = convertTamilNumerals(normalized);

  // Patterns for quantity extraction (number + optional keyword)
  const patterns = [
    /(\d+)\s*(?:அறை|rooms?|persons?|நபர்|guests?|க்|க)/i,
    /(\d+)\s*(?:பேர்|peoples?|persons?)/i,
    /^(\d+)\s*$/,
  ];

  for (const pattern of patterns) {
    const match = converted.match(pattern);
    if (match) {
      const quantity = parseInt(match[1], 10);
      if (quantity >= 1 && quantity <= 10) {
        return { quantity, confidence: 0.85 };
      }
    }
  }

  // Try text-based numbers (English words)
  const textNumbers: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  };

  for (const [word, num] of Object.entries(textNumbers)) {
    if (normalized.includes(word)) {
      return { quantity: num, confidence: 0.75 };
    }
  }

  return { confidence: 0 };
}

/**
 * Extract date slot from text.
 * Supports Tamil month names with day numbers (both Arabic and Tamil).
 *
 * Examples:
 * - "டிசம்பர் 15" → "2026-12-15" (current year)
 * - "December 15" → "2026-12-15"
 * - "ஜனவரி ௧" → "2026-01-02"
 *
 * @param text - Input text potentially containing dates
 * @returns Object with ISO date string and confidence, or undefined
 */
export function parseDateSlot(text: string): { date?: string; confidence: number } {
  const normalized = text.toLowerCase().trim();
  const converted = convertTamilNumerals(normalized);
  const monthMap = loadTamilMonthMap();

  // Try Tamil month name + day number pattern first
  for (const [tamilMonth, monthNum] of Object.entries(monthMap)) {
    const tamilMonthLower = tamilMonth.toLowerCase();
    if (normalized.includes(tamilMonthLower)) {
      // Look for day number after month name
      const pattern = new RegExp(`${tamilMonthLower}\\s+(\\d+)`);
      const match = converted.match(pattern);
      if (match) {
        const day = parseInt(match[1], 10);
        if (day >= 1 && day <= 31) {
          const year = new Date().getFullYear();
          const isoDate = formatAsISO(year, parseInt(monthNum, 10), day);
          if (isoDate) {
            return { date: isoDate, confidence: 0.95 };
          }
        }
      }
    }
  }

  // Try English month name + day number pattern
  const englishMonths: Record<string, string> = {
    'january': '01', 'february': '02', 'march': '03', 'april': '04',
    'may': '05', 'june': '06', 'july': '07', 'august': '08',
    'september': '09', 'october': '10', 'november': '11', 'december': '12',
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
  };

  for (const [englishMonth, monthNum] of Object.entries(englishMonths)) {
    if (normalized.includes(englishMonth)) {
      const pattern = new RegExp(`${englishMonth}\\s+(\\d+)`);
      const match = converted.match(pattern);
      if (match) {
        const day = parseInt(match[1], 10);
        if (day >= 1 && day <= 31) {
          const year = new Date().getFullYear();
          const isoDate = formatAsISO(year, parseInt(monthNum, 10), day);
          if (isoDate) {
            return { date: isoDate, confidence: 0.90 };
          }
        }
      }
    }
  }

  // Try DD/MM pattern (Tamil or Arabic numerals)
  const ddmmPattern = /(\d+)[\/\-.](\d+)/;
  const match = converted.match(ddmmPattern);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const year = new Date().getFullYear();
      const isoDate = formatAsISO(year, month, day);
      if (isoDate) {
        return { date: isoDate, confidence: 0.85 };
      }
    }
  }

  return { confidence: 0 };
}

/**
 * Format date as ISO 8601 string (YYYY-MM-DD).
 * Returns null if date is invalid.
 */
function formatAsISO(year: number, month: number, day: number): string | null {
  // Validate date components
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  // Check for invalid day-month combination
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  if (day > lastDayOfMonth) {
    return null;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Parse booking slots from Tamil text.
 * Extracts check-in date, check-out date, and room quantity.
 *
 * @param text - User message text
 * @returns Object with extracted slots and confidence scores
 */
export interface BookingSlots {
  checkInDate?: string;
  checkOutDate?: string;
  roomType?: string;
  roomQuantity?: number;
  confidence: number;
}

export function parseSlots(text: string): BookingSlots {
  if (!text || typeof text !== 'string') {
    return { confidence: 0 };
  }

  const checkInResult = parseDateSlot(text);
  const quantityResult = parseQuantitySlot(text);

  // Try to extract check-out date (looking for "to" or "-" between two dates)
  let checkOutResult = { confidence: 0 };
  const toPattern = /(\d+-\d+-\d+)\s+(?:to|-|until)\s+(\d+-\d+-\d+)/;
  // Note: parseDateSlot returns first date found, we'd need more sophisticated parsing
  // for check-out; for now, we only extract one date

  // Calculate combined confidence
  const confidences = [checkInResult.confidence, quantityResult.confidence].filter(c => c > 0);
  const avgConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;

  return {
    checkInDate: checkInResult.date,
    roomQuantity: quantityResult.quantity,
    confidence: avgConfidence,
  };
}
