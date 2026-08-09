/**
 * Email Template Profile Validator
 *
 * Scans email templates for hardcoded profile-specific content (business names,
 * amenities, policies). Ensures templates use {{PROFILE_NAME}} and {{PROFILE_AMENITIES}}
 * variables instead of hardcoded values.
 */

export interface TemplateViolation {
  lineNumber: number;
  content: string;
  detectedKeyword: string;
  suggestion: string;
}

export interface ValidationResult {
  profile: string;
  templatePath: string;
  isValid: boolean;
  violations: TemplateViolation[];
  summary: string;
}

// Profile-specific keywords that should NOT appear in templates
const PROFILE_KEYWORDS: Record<string, string[]> = {
  'pelangi-capsule': [
    'Pelangi Capsule Hostel',
    'Pelangi Capsule',
    'pelangi capsule',
    'Taman Pelangi',
    'capsule pod',
    'capsule facility',
    'capsule',
    'hostel',
    'ilovestaycapsule',
    '26A Jalan Perang',
    'Jalan Perang',
  ],
  'makan-moments': [
    'Makan Moments Cafe',
    'Makan Moments',
    'makan moments',
    'cozy cafe',
    'cafe',
  ],
  'southern-homestay': [
    'Southern Homestay',
    'southern homestay',
    'homestay',
  ],
};

/**
 * Parse HTML/text content and extract lines
 * Returns array of non-empty lines with their original line numbers
 */
function parseContent(
  content: string,
): Array<{ lineNumber: number; text: string }> {
  const lines = content.split('\n');
  return lines
    .map((text, index) => ({
      lineNumber: index + 1,
      text: text.trim(),
    }))
    .filter((line) => line.text.length > 0);
}

/**
 * Check if a line contains profile-specific keywords
 * Returns the matched keyword if found, null otherwise
 */
function findKeywordInLine(
  line: string,
  keywords: string[],
): string | null {
  // Sort by length (longest first) to match more specific keywords first
  const sorted = [...keywords].sort((a, b) => b.length - a.length);

  for (const keyword of sorted) {
    // Case-insensitive search
    if (line.toLowerCase().includes(keyword.toLowerCase())) {
      return keyword;
    }
  }

  return null;
}

/**
 * Validate an email template for hardcoded profile-specific content
 */
export function validateTemplate(
  content: string,
  profile: string,
  templatePath: string = 'unknown',
): ValidationResult {
  const normalizedProfile = normalizeProfileName(profile);
  const keywords = PROFILE_KEYWORDS[normalizedProfile];

  if (!keywords) {
    return {
      profile,
      templatePath,
      isValid: false,
      violations: [],
      summary: `Profile "${profile}" not recognized. Valid profiles: ${Object.keys(PROFILE_KEYWORDS).join(', ')}`,
    };
  }

  const lines = parseContent(content);
  const violations: TemplateViolation[] = [];

  for (const line of lines) {
    const keyword = findKeywordInLine(line.text, keywords);
    if (keyword) {
      violations.push({
        lineNumber: line.lineNumber,
        content: line.text,
        detectedKeyword: keyword,
        suggestion: `Use {{PROFILE_NAME}} instead of "${keyword}"`,
      });
    }
  }

  const isValid = violations.length === 0;
  const summary = isValid
    ? `✓ Template is valid for profile "${normalizedProfile}"`
    : `✗ Found ${violations.length} violation(s) in template for profile "${normalizedProfile}"`;

  return {
    profile: normalizedProfile,
    templatePath,
    isValid,
    violations,
    summary,
  };
}

/**
 * Normalize profile name to match internal format
 * Converts: "makan-moments" → "makan-moments", "makan_moments" → "makan-moments"
 */
export function normalizeProfileName(profile: string): string {
  return profile
    .toLowerCase()
    .replace(/_/g, '-')
    .trim();
}

/**
 * Format validation result as human-readable text
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];
  lines.push('=== Email Template Validation Report ===');
  lines.push(`Profile: ${result.profile}`);
  lines.push(`Template: ${result.templatePath}`);
  lines.push(`Status: ${result.isValid ? '✓ VALID' : '✗ INVALID'}`);
  lines.push('');

  if (result.violations.length === 0) {
    lines.push(result.summary);
  } else {
    lines.push(`Found ${result.violations.length} violation(s):\n`);
    for (const violation of result.violations) {
      lines.push(`Line ${violation.lineNumber}: ${violation.content}`);
      lines.push(
        `  ✗ Hardcoded: "${violation.detectedKeyword}"`,
      );
      lines.push(`  → ${violation.suggestion}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
