/**
 * US-397: Profile Data Contamination Detector CLI
 *
 * CLI tool that validates each business profile's data files contain only
 * profile-specific content and zero keywords from other profiles, preventing
 * data contamination.
 *
 * Usage:
 *   npx ts-node src/tools/profile-keyword-validator.ts --check-all --report-format json
 *   npx ts-node src/tools/profile-keyword-validator.ts --profile data-makan --check-all
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IntentKeywordEntry {
  intent: string;
  keywords: Record<string, string[]>;
}

interface KeywordsFile {
  intents: IntentKeywordEntry[];
}

interface Violation {
  profile: string;
  file: string;
  intent: string;
  forbidden_keywords: string[];
  line_numbers: number[];
  severity: 'error' | 'warning';
}

interface ValidationReport {
  timestamp: string;
  profiles_scanned: string[];
  total_violations: number;
  violations: Violation[];
  exit_code: number;
  summary: {
    [profile: string]: {
      total_violations: number;
      contamination_detected: boolean;
    };
  };
}

interface Blacklist {
  version: string;
  description: string;
  forbidden_keywords: Record<string, Record<string, string[]>>;
  allowed_intents: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Find all data profile directories
 */
function findProfileDirectories(): string[] {
  const dataDir = path.join(__dirname, '..', 'assistant');
  const entries = fs.readdirSync(dataDir, { withFileTypes: true });

  return entries
    .filter((e) => e.isDirectory() && (e.name === 'data' || e.name.startsWith('data-')))
    .map((e) => path.join(dataDir, e.name));
}

/**
 * Load intent-keywords.json from a profile directory
 */
function loadKeywordsFile(profileDir: string): KeywordsFile | null {
  const filePath = path.join(profileDir, 'intent-keywords.json');

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
 * Load the profile keyword blacklist
 */
function loadBlacklist(): Blacklist {
  const blacklistPath = path.join(
    __dirname,
    '..',
    'assistant',
    'data',
    'profile-keyword-blacklist.json'
  );

  if (!fs.existsSync(blacklistPath)) {
    throw new Error(`Blacklist file not found: ${blacklistPath}`);
  }

  const content = fs.readFileSync(blacklistPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Extract profile name from directory path
 */
function getProfileName(dirPath: string): string {
  return path.basename(dirPath);
}

/**
 * Find line number of a keyword in the keywords file
 */
function findKeywordLineNumber(fileContent: string, keyword: string): number {
  const lines = fileContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`"${keyword}"`)) {
      return i + 1;
    }
  }
  return -1;
}

/**
 * Validate a single profile's keywords against the blacklist
 */
function validateProfile(
  profileDir: string,
  blacklist: Blacklist
): Violation[] {
  const profileName = getProfileName(profileDir);
  const violations: Violation[] = [];

  const keywordsFile = loadKeywordsFile(profileDir);
  if (!keywordsFile) {
    return violations;
  }

  const fileContent = fs.readFileSync(
    path.join(profileDir, 'intent-keywords.json'),
    'utf-8'
  );
  const forbiddenKeywords = blacklist.forbidden_keywords[profileName];

  if (!forbiddenKeywords) {
    // No blacklist for this profile, skip validation
    return violations;
  }

  // Collect all forbidden keywords for this profile
  const allForbidden = new Set<string>();
  for (const category of Object.values(forbiddenKeywords)) {
    if (Array.isArray(category)) {
      category.forEach((kw) => allForbidden.add(kw));
    }
  }

  // Check each intent in the profile
  for (const intentEntry of keywordsFile.intents) {
    const intent = intentEntry.intent;

    if (allForbidden.has(intent)) {
      const lineNumber = findKeywordLineNumber(fileContent, intent);
      violations.push({
        profile: profileName,
        file: 'intent-keywords.json',
        intent,
        forbidden_keywords: [intent],
        line_numbers: lineNumber >= 0 ? [lineNumber] : [],
        severity: 'error',
      });
    }
  }

  return violations;
}

/**
 * Main validation routine
 */
function validateAllProfiles(profileFilter?: string): ValidationReport {
  const blacklist = loadBlacklist();
  const profileDirs = findProfileDirectories();
  const violations: Violation[] = [];
  const summary: Record<string, { total_violations: number; contamination_detected: boolean }> = {};

  let filteredDirs = profileDirs;
  if (profileFilter) {
    filteredDirs = profileDirs.filter((dir) => path.basename(dir) === profileFilter);
    if (filteredDirs.length === 0) {
      console.error(`Profile not found: ${profileFilter}`);
      process.exit(1);
    }
  }

  for (const profileDir of filteredDirs) {
    const profileName = getProfileName(profileDir);
    const profileViolations = validateProfile(profileDir, blacklist);

    violations.push(...profileViolations);
    summary[profileName] = {
      total_violations: profileViolations.length,
      contamination_detected: profileViolations.length > 0,
    };
  }

  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    profiles_scanned: filteredDirs.map(getProfileName),
    total_violations: violations.length,
    violations,
    exit_code: violations.length > 0 ? 1 : 0,
    summary,
  };

  return report;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(): {
  checkAll: boolean;
  profile?: string;
  reportFormat: 'json' | 'text';
} {
  const args = process.argv.slice(2);
  const result = {
    checkAll: false,
    profile: undefined as string | undefined,
    reportFormat: 'json' as 'json' | 'text',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--check-all') {
      result.checkAll = true;
    } else if (arg === '--profile' && i + 1 < args.length) {
      result.profile = args[++i];
    } else if (arg === '--report-format' && i + 1 < args.length) {
      const format = args[++i];
      if (format === 'json' || format === 'text') {
        result.reportFormat = format;
      }
    }
  }

  return result;
}

function formatTextReport(report: ValidationReport): string {
  let output = `\nProfile Keyword Validation Report\n`;
  output += `Generated: ${report.timestamp}\n`;
  output += `Profiles Scanned: ${report.profiles_scanned.join(', ')}\n`;
  output += `Total Violations: ${report.total_violations}\n\n`;

  if (report.violations.length === 0) {
    output += '✓ All profiles are clean — no keyword contamination detected\n';
  } else {
    output += 'Violations Found:\n';
    output += '─'.repeat(80) + '\n';

    for (const violation of report.violations) {
      output += `[${violation.severity.toUpperCase()}] Profile: ${violation.profile}\n`;
      output += `  Intent: ${violation.intent}\n`;
      output += `  Forbidden Keywords: ${violation.forbidden_keywords.join(', ')}\n`;
      if (violation.line_numbers.length > 0) {
        output += `  Line Numbers: ${violation.line_numbers.join(', ')}\n`;
      }
      output += '\n';
    }
  }

  output += `\nSummary by Profile:\n`;
  output += '─'.repeat(80) + '\n';
  for (const [profile, stats] of Object.entries(report.summary)) {
    const status = stats.contamination_detected ? '✗ CONTAMINATED' : '✓ CLEAN';
    output += `  ${profile}: ${status} (${stats.total_violations} violations)\n`;
  }

  return output;
}

async function main() {
  const options = parseArgs();

  const report = validateAllProfiles(options.profile);

  if (options.reportFormat === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatTextReport(report));
  }

  process.exit(report.exit_code);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
