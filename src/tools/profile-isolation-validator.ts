/**
 * US-485: Profile Isolation Validation Test Suite
 *
 * Validates that profile data files maintain strict separation:
 * - intent-keywords.json contains no forbidden keywords from other profiles
 * - Knowledge base .md files contain no forbidden keywords from other profiles
 * - Generates detailed contamination reports with severity scores
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntentKeywordEntry {
  intent: string;
  keywords: Record<string, string[]>;
}

export interface KeywordsFile {
  intents: IntentKeywordEntry[];
}

export interface ContaminationViolation {
  file: string;
  violated_keywords: string[];
  line_numbers: number[];
  severity: 'error' | 'warning';
  keyword_category: string;
}

export interface ProfileContaminationReport {
  profile: string;
  timestamp: string;
  total_violations: number;
  contaminated_files: string[];
  violations: ContaminationViolation[];
  contamination_score: number; // 0-100, higher = more contamination
  is_clean: boolean;
}

export interface ForbiddenKeywordSet {
  category: string;
  keywords: string[];
}

// ---------------------------------------------------------------------------
// Profile Configuration
// ---------------------------------------------------------------------------

const PROFILE_CONFIG: Record<string, {
  dataDir: string;
  kbDir: string;
  forbiddenKeywords: ForbiddenKeywordSet[];
}> = {
  'makan': {
    dataDir: path.join(rootDir, 'src', 'assistant', 'data-makan'),
    kbDir: path.join(rootDir, '.rainbow-kb-makan'),
    forbiddenKeywords: [
      {
        category: 'hostel_specific',
        keywords: [
          'check_in_arrival', 'checkout_info', 'checkout_now', 'checkout_procedure',
          'checkin_info', 'late_checkout', 'late_checkout_request', 'capsule_conflict',
          'lower_deck_preference', 'facility_orientation', 'theft_report', 'card_locked',
          'luggage_storage', 'stay_extension', 'extend_stay', 'room_type_inquiry'
        ]
      },
      {
        category: 'homestay_specific',
        keywords: [
          'bag_storage', 'extra_amenity_request', 'facilities'
        ]
      }
    ]
  },
  'southern': {
    dataDir: path.join(rootDir, 'src', 'assistant', 'data-southern'),
    kbDir: path.join(rootDir, '.rainbow-kb-southern'),
    forbiddenKeywords: [
      {
        category: 'pelangi_capsule_specific',
        keywords: [
          'capsule_conflict', 'lower_deck_preference', 'card_locked', 'theft_report'
        ]
      }
    ]
  },
  'pelangi': {
    dataDir: path.join(rootDir, 'src', 'assistant', 'data'),
    kbDir: path.join(rootDir, '.rainbow-kb'),
    forbiddenKeywords: [
      {
        category: 'makan_specific',
        keywords: [
          'menu_inquiry', 'food_order', 'promotion_question', 'table_reservation',
          'order_cancellation', 'food_recommendation'
        ]
      }
    ]
  }
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Load intent-keywords.json from a profile directory
 */
function loadKeywordsFile(dataDir: string): KeywordsFile | null {
  const filePath = path.join(dataDir, 'intent-keywords.json');

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return null;
  }
}

/**
 * Find line numbers where a keyword appears in a file
 */
function findKeywordLineNumbers(fileContent: string, keywords: string[]): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  const lines = fileContent.split('\n');

  for (const keyword of keywords) {
    result[keyword] = [];
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        result[keyword].push(i + 1);
      }
    }
  }

  return result;
}

/**
 * Check a file content for forbidden keywords
 */
function checkFileForKeywords(filePath: string, forbiddenKeywords: string[]): {
  violations: string[];
  lineNumbers: Record<string, number[]>
} {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lineNumbers = findKeywordLineNumbers(content, forbiddenKeywords);

    const violations = forbiddenKeywords.filter(
      kw => lineNumbers[kw].length > 0
    );

    return { violations, lineNumbers };
  } catch (err) {
    return { violations: [], lineNumbers: {} };
  }
}

/**
 * Read all .md files from a directory
 */
function readKbFiles(kbDir: string): Record<string, string> {
  const files: Record<string, string> = {};

  if (!fs.existsSync(kbDir)) {
    return files;
  }

  const entries = fs.readdirSync(kbDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
      const filePath = path.join(kbDir, entry.name);
      try {
        files[entry.name] = fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        console.error(`Error reading ${filePath}:`, err);
      }
    }
  }

  return files;
}

/**
 * Validate intent-keywords.json for forbidden keywords
 */
function validateIntentKeywords(
  dataDir: string,
  forbiddenKeywordSets: ForbiddenKeywordSet[]
): ContaminationViolation[] {
  const violations: ContaminationViolation[] = [];
  const keywordsFile = loadKeywordsFile(dataDir);

  if (!keywordsFile) {
    return violations;
  }

  const filePath = path.join(dataDir, 'intent-keywords.json');
  const fileContent = fs.readFileSync(filePath, 'utf-8');

  for (const forbiddenSet of forbiddenKeywordSets) {
    const { violations: foundKeywords, lineNumbers } = checkFileForKeywords(
      filePath,
      forbiddenSet.keywords
    );

    if (foundKeywords.length > 0) {
      const allLineNumbers = foundKeywords.reduce((acc, kw) => {
        return acc.concat(lineNumbers[kw] || []);
      }, [] as number[]);

      violations.push({
        file: 'intent-keywords.json',
        violated_keywords: foundKeywords,
        line_numbers: allLineNumbers,
        severity: 'error',
        keyword_category: forbiddenSet.category
      });
    }
  }

  return violations;
}

/**
 * Validate knowledge base .md files for forbidden keywords
 */
function validateKnowledgeBase(
  kbDir: string,
  forbiddenKeywordSets: ForbiddenKeywordSet[]
): ContaminationViolation[] {
  const violations: ContaminationViolation[] = [];
  const kbFiles = readKbFiles(kbDir);

  for (const forbiddenSet of forbiddenKeywordSets) {
    for (const [fileName, content] of Object.entries(kbFiles)) {
      const lineNumbers = findKeywordLineNumbers(content, forbiddenSet.keywords);
      const foundKeywords = forbiddenSet.keywords.filter(
        kw => lineNumbers[kw].length > 0
      );

      if (foundKeywords.length > 0) {
        const allLineNumbers = foundKeywords.reduce((acc, kw) => {
          return acc.concat(lineNumbers[kw] || []);
        }, [] as number[]);

        violations.push({
          file: fileName,
          violated_keywords: foundKeywords,
          line_numbers: allLineNumbers,
          severity: 'warning',
          keyword_category: forbiddenSet.category
        });
      }
    }
  }

  return violations;
}

/**
 * Calculate contamination score (0-100)
 * Based on number of violations and their severity
 */
function calculateContaminationScore(violations: ContaminationViolation[]): number {
  if (violations.length === 0) return 0;

  const errorViolations = violations.filter(v => v.severity === 'error').length;
  const warningViolations = violations.filter(v => v.severity === 'warning').length;

  // Simple scoring: errors are weighted 10x more than warnings
  const score = Math.min(100, (errorViolations * 20 + warningViolations * 2));
  return score;
}

// ---------------------------------------------------------------------------
// Main Validation Function
// ---------------------------------------------------------------------------

/**
 * US-485: Main profile isolation validation function
 *
 * Validates that a profile's data files maintain strict isolation from other profiles.
 * Checks both intent-keywords.json and knowledge base .md files.
 */
export function validateProfileIsolation(profile: string): ProfileContaminationReport {
  const config = PROFILE_CONFIG[profile];

  if (!config) {
    throw new Error(`Unknown profile: ${profile}`);
  }

  const intentsViolations = validateIntentKeywords(config.dataDir, config.forbiddenKeywords);
  const kbViolations = validateKnowledgeBase(config.kbDir, config.forbiddenKeywords);

  const allViolations = [...intentsViolations, ...kbViolations];
  const contaminatedFiles = Array.from(new Set(allViolations.map(v => v.file)));
  const contaminationScore = calculateContaminationScore(allViolations);

  const report: ProfileContaminationReport = {
    profile,
    timestamp: new Date().toISOString(),
    total_violations: allViolations.length,
    contaminated_files: contaminatedFiles,
    violations: allViolations,
    contamination_score: contaminationScore,
    is_clean: allViolations.length === 0
  };

  return report;
}

/**
 * Validate multiple profiles
 */
export function validateAllProfiles(profiles?: string[]): ProfileContaminationReport[] {
  const profilesToCheck = profiles || Object.keys(PROFILE_CONFIG);
  return profilesToCheck.map(profile => validateProfileIsolation(profile));
}

/**
 * Generate a detailed text report
 */
export function generateReport(report: ProfileContaminationReport): string {
  let output = `\n${'='.repeat(80)}\n`;
  output += `Profile Isolation Validation Report: ${report.profile}\n`;
  output += `Generated: ${report.timestamp}\n`;
  output += `${'='.repeat(80)}\n\n`;

  if (report.is_clean) {
    output += `✓ CLEAN — No contamination detected\n`;
    output += `Contamination Score: ${report.contamination_score}/100\n`;
  } else {
    output += `✗ CONTAMINATED — ${report.total_violations} violations found\n`;
    output += `Contamination Score: ${report.contamination_score}/100\n\n`;

    output += `Contaminated Files (${report.contaminated_files.length}):\n`;
    output += `${'─'.repeat(80)}\n`;
    for (const file of report.contaminated_files) {
      output += `  • ${file}\n`;
    }

    output += `\n\nDetailed Violations:\n`;
    output += `${'─'.repeat(80)}\n`;

    for (const violation of report.violations) {
      output += `\n[${violation.severity.toUpperCase()}] File: ${violation.file}\n`;
      output += `  Category: ${violation.keyword_category}\n`;
      output += `  Keywords: ${violation.violated_keywords.join(', ')}\n`;
      output += `  Lines: ${violation.line_numbers.join(', ')}\n`;
    }
  }

  output += `\n${'='.repeat(80)}\n`;
  return output;
}

export default {
  validateProfileIsolation,
  validateAllProfiles,
  generateReport
};
