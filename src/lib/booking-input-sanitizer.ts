/**
 * US-490: Booking Workflow Input Sanitizer with Profile-Specific Rules
 *
 * Validates and sanitizes booking form inputs before passing to workflow engine.
 * Each profile (pelangi, southern, makan) has unique constraints:
 * - Unit types
 * - Check-in/check-out windows
 * - Guest count limits
 * - Special amenities
 *
 * Prevents invalid data from entering workflow steps.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface ProfileSpecificRules {
  profile: 'pelangi' | 'southern' | 'makan';
  maxGuests: number;
  minGuests: number;
  allowedUnitTypes: string[];
  minCheckInDaysAdvance: number; // minimum days in advance to book
  maxCheckInDaysAdvance: number; // maximum days in advance to book (e.g., 365 days)
  minStayNights: number;
  maxStayNights: number;
  allowedLanguages: string[];
  specialAmenities?: string[]; // e.g., wifi, ac, kitchen
}

export interface BookingInput {
  profile: string;
  guestName?: string;
  guestPhone?: string;
  guestEmail?: string;
  checkInDate?: string | Date;
  checkOutDate?: string | Date;
  guestCount?: number;
  unitType?: string;
  specialRequests?: string;
}

export interface SanitizationResult {
  valid: boolean;
  sanitized?: Partial<BookingInput>;
  violations: SanitizationViolation[];
}

export interface SanitizationViolation {
  field: string;
  issue: string;
  severity: 'error' | 'warning';
  suggestion?: string;
}

// ─── Default Profile Rules ──────────────────────────────────────────

const DEFAULT_RULES: Record<string, ProfileSpecificRules> = {
  pelangi: {
    profile: 'pelangi',
    maxGuests: 4,
    minGuests: 1,
    allowedUnitTypes: ['capsule', 'private-room', 'dorm'],
    minCheckInDaysAdvance: 0,
    maxCheckInDaysAdvance: 365,
    minStayNights: 1,
    maxStayNights: 90,
    allowedLanguages: ['en', 'ms', 'zh', 'ta'],
    specialAmenities: ['wifi', 'ac', 'locker', 'bathroom'],
  },
  southern: {
    profile: 'southern',
    maxGuests: 8,
    minGuests: 1,
    allowedUnitTypes: ['room', 'suite', 'apartment'],
    minCheckInDaysAdvance: 0,
    maxCheckInDaysAdvance: 365,
    minStayNights: 1,
    maxStayNights: 180,
    allowedLanguages: ['en', 'ms'],
    specialAmenities: ['wifi', 'ac', 'kitchen', 'parking'],
  },
  makan: {
    profile: 'makan',
    maxGuests: 4,
    minGuests: 1,
    allowedUnitTypes: ['private-room', 'event-space'],
    minCheckInDaysAdvance: 0,
    maxCheckInDaysAdvance: 90,
    minStayNights: 1,
    maxStayNights: 7,
    allowedLanguages: ['en', 'ms'],
    specialAmenities: ['wifi', 'seating'],
  },
};

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Create a profile-specific sanitizer with rules loaded from defaults or custom rules.
 */
export function createProfileSanitizer(
  profile: string,
  customRules?: Record<string, ProfileSpecificRules>
): (input: BookingInput) => SanitizationResult {
  const rulesMap = customRules || DEFAULT_RULES;
  const rules = rulesMap[profile];

  if (!rules) {
    throw new Error(`Unknown profile: ${profile}. Valid profiles: ${Object.keys(rulesMap).join(', ')}`);
  }

  return (input: BookingInput) => validateBookingInput(input, rules);
}

/**
 * Validate booking input against profile-specific rules.
 * Returns a SanitizationResult with violations and cleaned data.
 */
export function validateBookingInput(
  input: BookingInput,
  rules: ProfileSpecificRules
): SanitizationResult {
  const violations: SanitizationViolation[] = [];
  const sanitized: Partial<BookingInput> = {};

  // Profile validation
  if (!input.profile) {
    violations.push({
      field: 'profile',
      issue: 'Profile is required',
      severity: 'error',
    });
  } else {
    sanitized.profile = input.profile;
  }

  // Guest name validation
  if (input.guestName) {
    const cleaned = input.guestName.trim();
    if (cleaned.length === 0) {
      violations.push({
        field: 'guestName',
        issue: 'Guest name cannot be empty',
        severity: 'error',
      });
    } else if (cleaned.length > 100) {
      violations.push({
        field: 'guestName',
        issue: 'Guest name is too long (max 100 characters)',
        severity: 'error',
        suggestion: `Truncate to: "${cleaned.substring(0, 100)}"`,
      });
    } else {
      sanitized.guestName = cleaned;
    }
  }

  // Guest phone validation
  if (input.guestPhone) {
    const cleaned = sanitizePhone(input.guestPhone);
    if (!isValidPhone(cleaned)) {
      violations.push({
        field: 'guestPhone',
        issue: 'Invalid phone number format',
        severity: 'warning',
        suggestion: 'Expected format: +601234567890 or 0123456890',
      });
    } else {
      sanitized.guestPhone = cleaned;
    }
  }

  // Guest email validation
  if (input.guestEmail) {
    const cleaned = input.guestEmail.trim().toLowerCase();
    if (!isValidEmail(cleaned)) {
      violations.push({
        field: 'guestEmail',
        issue: 'Invalid email format',
        severity: 'warning',
      });
    } else {
      sanitized.guestEmail = cleaned;
    }
  }

  // Check-in and check-out date validation
  const dateValidation = validateDateRange(
    input.checkInDate,
    input.checkOutDate,
    rules
  );
  if (dateValidation.violations.length > 0) {
    violations.push(...dateValidation.violations);
  } else {
    if (dateValidation.checkInDate) sanitized.checkInDate = dateValidation.checkInDate;
    if (dateValidation.checkOutDate) sanitized.checkOutDate = dateValidation.checkOutDate;
  }

  // Guest count validation
  if (input.guestCount !== undefined) {
    const guestValidation = sanitizeGuestInfo(input.guestCount, rules);
    if (guestValidation.violations.length > 0) {
      violations.push(...guestValidation.violations);
    } else {
      sanitized.guestCount = guestValidation.sanitized;
    }
  }

  // Unit type validation
  if (input.unitType) {
    const cleaned = input.unitType.trim().toLowerCase();
    if (!rules.allowedUnitTypes.includes(cleaned)) {
      violations.push({
        field: 'unitType',
        issue: `Unit type "${cleaned}" not allowed for ${rules.profile}`,
        severity: 'error',
        suggestion: `Allowed types: ${rules.allowedUnitTypes.join(', ')}`,
      });
    } else {
      sanitized.unitType = cleaned;
    }
  }

  // Special requests validation
  if (input.specialRequests) {
    const cleaned = input.specialRequests.trim();
    if (cleaned.length > 500) {
      violations.push({
        field: 'specialRequests',
        issue: 'Special requests too long (max 500 characters)',
        severity: 'warning',
        suggestion: `Truncate to: "${cleaned.substring(0, 500)}"`,
      });
    } else if (cleaned.length > 0) {
      sanitized.specialRequests = cleaned;
    }
  }

  const valid = violations.filter(v => v.severity === 'error').length === 0;

  return {
    valid,
    sanitized: valid ? sanitized : undefined,
    violations,
  };
}

/**
 * Validate guest count against profile rules.
 * Returns sanitized count and any violations.
 */
export function sanitizeGuestInfo(
  guestCount: number | string | undefined,
  rules: ProfileSpecificRules
): { sanitized?: number; violations: SanitizationViolation[] } {
  const violations: SanitizationViolation[] = [];
  let count: number | undefined;

  if (guestCount === undefined) {
    return { violations };
  }

  // Convert string to number
  if (typeof guestCount === 'string') {
    const match = guestCount.match(/\d+/);
    if (!match) {
      violations.push({
        field: 'guestCount',
        issue: 'Guest count must be a number',
        severity: 'error',
      });
      return { violations };
    }
    count = parseInt(match[0], 10);
  } else {
    count = Math.floor(guestCount);
  }

  // Validate against rules
  if (count < rules.minGuests) {
    violations.push({
      field: 'guestCount',
      issue: `Minimum ${rules.minGuests} guest(s) required for ${rules.profile}`,
      severity: 'error',
    });
  } else if (count > rules.maxGuests) {
    violations.push({
      field: 'guestCount',
      issue: `Maximum ${rules.maxGuests} guests allowed for ${rules.profile}, got ${count}`,
      severity: 'error',
    });
  } else {
    return { sanitized: count, violations };
  }

  return { violations };
}

// ─── Helper Functions ────────────────────────────────────────────────

function parseDate(dateInput: string | Date | undefined): Date | null {
  if (!dateInput) return null;

  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) return null;
    return dateInput;
  }

  const dateStr = dateInput.trim();

  // Try ISO format: 2026-04-15
  const isoMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  // Try DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  // Try natural Date parsing
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;

  return null;
}

function validateDateRange(
  checkInDate: string | Date | undefined,
  checkOutDate: string | Date | undefined,
  rules: ProfileSpecificRules
): {
  checkInDate?: Date;
  checkOutDate?: Date;
  violations: SanitizationViolation[];
} {
  const violations: SanitizationViolation[] = [];
  let checkIn: Date | null = null;
  let checkOut: Date | null = null;

  // Parse check-in date
  if (checkInDate) {
    checkIn = parseDate(checkInDate);
    if (!checkIn) {
      violations.push({
        field: 'checkInDate',
        issue: 'Invalid check-in date format',
        severity: 'error',
        suggestion: 'Use YYYY-MM-DD or DD/MM/YYYY format',
      });
    }
  }

  // Parse check-out date
  if (checkOutDate) {
    checkOut = parseDate(checkOutDate);
    if (!checkOut) {
      violations.push({
        field: 'checkOutDate',
        issue: 'Invalid check-out date format',
        severity: 'error',
        suggestion: 'Use YYYY-MM-DD or DD/MM/YYYY format',
      });
    }
  }

  // If both dates parsed, validate them together
  if (checkIn && checkOut) {
    // Check-out must be after check-in
    if (checkOut <= checkIn) {
      violations.push({
        field: 'checkOutDate',
        issue: 'Check-out date must be after check-in date',
        severity: 'error',
      });
      return { violations };
    }

    // Calculate stay duration
    const nights = Math.floor((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));

    // Validate stay duration
    if (nights < rules.minStayNights) {
      violations.push({
        field: 'checkOutDate',
        issue: `Minimum stay is ${rules.minStayNights} night(s), got ${nights}`,
        severity: 'error',
      });
    } else if (nights > rules.maxStayNights) {
      violations.push({
        field: 'checkOutDate',
        issue: `Maximum stay is ${rules.maxStayNights} nights, got ${nights}`,
        severity: 'error',
      });
    }

    // Validate check-in advance time
    const now = new Date();
    const daysUntilCheckIn = Math.floor((checkIn.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilCheckIn < rules.minCheckInDaysAdvance) {
      violations.push({
        field: 'checkInDate',
        issue: `Check-in must be at least ${rules.minCheckInDaysAdvance} days in advance`,
        severity: 'error',
      });
    } else if (daysUntilCheckIn > rules.maxCheckInDaysAdvance) {
      violations.push({
        field: 'checkInDate',
        issue: `Check-in cannot be more than ${rules.maxCheckInDaysAdvance} days in advance`,
        severity: 'error',
      });
    }
  }

  // Return valid dates if no violations
  if (violations.length === 0) {
    return { checkInDate: checkIn || undefined, checkOutDate: checkOut || undefined, violations };
  }

  return { violations };
}

function sanitizePhone(phone: string): string {
  // Remove all non-digit characters except leading +
  return phone.replace(/[^\d+]/g, '');
}

function isValidPhone(phone: string): boolean {
  if (!phone) return false;
  // Malaysian phone: +601234567890 or 0123456890, or international formats
  const phoneRegex = /^(\+\d{1,3})?[1-9]\d{7,14}$/;
  return phoneRegex.test(phone);
}

function isValidEmail(email: string): boolean {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// ─── Export rule builder for custom profiles ──────────────────────────

export function buildProfileRules(
  profile: 'pelangi' | 'southern' | 'makan',
  overrides: Partial<ProfileSpecificRules> = {}
): ProfileSpecificRules {
  const defaults = DEFAULT_RULES[profile];
  if (!defaults) {
    throw new Error(`Unknown profile: ${profile}`);
  }
  return { ...defaults, ...overrides };
}
