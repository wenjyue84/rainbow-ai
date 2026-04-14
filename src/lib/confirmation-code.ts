/**
 * confirmation-code.ts — Booking confirmation code generation and validation
 *
 * Format: {PROFILE_PREFIX}-{TIMESTAMP_HASH}-{RANDOM_6}
 * Example: PEL-260414-K9X2M5
 */

// Profile to prefix mapping
const PROFILE_PREFIX_MAP: Record<string, string> = {
  'pelangi': 'PEL',
  'southern': 'SOU',
  'makan-moments': 'MAK',
  'pms-capsule': 'PMS',
  'pms-southern': 'PSO',
  'yoongmei': 'YOO'
};

/**
 * Generate a confirmation code with profile prefix, timestamp hash, and random suffix
 * @param profileId - Profile identifier (e.g., 'pelangi', 'southern', 'makan-moments')
 * @returns Confirmation code string or null if profile not found
 */
export function generateConfirmationCode(profileId: string): string | null {
  const prefix = PROFILE_PREFIX_MAP[profileId];
  if (!prefix) {
    console.warn(`[ConfirmationCode] Unknown profile: ${profileId}`);
    return null;
  }

  // Create timestamp hash: DDMMYY format
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  const timestampHash = `${day}${month}${year}`;

  // Generate 6-character random suffix (alphanumeric uppercase)
  const randomSuffix = generateRandomString(6);

  return `${prefix}-${timestampHash}-${randomSuffix}`;
}

/**
 * Validate a confirmation code and return profile if valid
 * @param code - Confirmation code to validate
 * @returns Object with {valid: boolean, profileId?: string, prefix?: string}
 */
export function validateConfirmationCode(code: string): {
  valid: boolean;
  profileId?: string;
  prefix?: string;
} {
  // Expected format: XXX-DDMMYY-AAAAAA
  const parts = code.toUpperCase().split('-');
  if (parts.length !== 3) {
    return { valid: false };
  }

  const [prefix, timestampHash, randomSuffix] = parts;

  // Validate prefix exists
  const profileId = Object.entries(PROFILE_PREFIX_MAP).find(
    ([, p]) => p === prefix
  )?.[0];

  if (!profileId) {
    return { valid: false };
  }

  // Validate timestamp hash format (DDMMYY)
  if (!/^\d{6}$/.test(timestampHash)) {
    return { valid: false };
  }

  // Validate random suffix (6 alphanumeric)
  if (!/^[A-Z0-9]{6}$/.test(randomSuffix)) {
    return { valid: false };
  }

  return {
    valid: true,
    profileId,
    prefix
  };
}

/**
 * Verify that a confirmation code belongs to a specific profile
 * @param code - Confirmation code to verify
 * @param expectedProfileId - Expected profile ID
 * @returns true if code is valid and matches profile, false otherwise
 */
export function verifyConfirmationCodeForProfile(
  code: string,
  expectedProfileId: string
): boolean {
  const validation = validateConfirmationCode(code);
  return validation.valid && validation.profileId === expectedProfileId;
}

/**
 * Generate a random alphanumeric string
 * @param length - Length of string to generate
 * @returns Random alphanumeric string (uppercase)
 */
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
