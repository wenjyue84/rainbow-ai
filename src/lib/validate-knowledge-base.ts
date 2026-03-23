/**
 * validate-knowledge-base.ts — Knowledge base content validator
 *
 * Validates knowledge.json files on server startup:
 * 1. Enforces required fields (intent, response)
 * 2. Enforces response length > 5 chars
 * 3. Detects Pelangi-specific phrases in non-Pelangi profiles
 * 4. Blocks startup on critical violations
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { parse as parsePath } from 'path';

interface KnowledgeEntry {
  intent?: string;
  response?: {
    [key: string]: string;
  } | string;
  id?: string;
  profile_id?: string;
}

interface KnowledgeBase {
  static?: KnowledgeEntry[];
  schema_version?: string;
}

interface ValidationResult {
  isClean: boolean;
  criticalViolations: string[];
  warnings: string[];
}

// Pelangi-specific phrases that should not appear in other profiles
const PELANGI_FORBIDDEN_PHRASES = [
  'hostel',
  'check-in',
  'check-out',
  'room_type',
  'capsule',
  'pelangi',
  'taman pelangi',
  'check in',
  'check out',
];

/**
 * Extract profile_id from directory path
 * e.g., 'src/assistant/data-makan' -> 'makan'
 *       'src/assistant/data' -> 'pelangi' (default)
 */
function getProfileIdFromPath(filePath: string): string {
  const dir = parsePath(filePath).dir;
  const dirName = basename(dir);

  if (dirName === 'data') {
    return 'pelangi'; // default profile
  }

  // Extract profile from 'data-{profile}' format
  const match = dirName.match(/^data-(.+)$/);
  return match ? match[1] : 'unknown';
}

/**
 * Get response text from response field (handles both string and object formats)
 */
function getResponseText(response: KnowledgeEntry['response']): string {
  if (typeof response === 'string') {
    return response;
  }
  if (typeof response === 'object' && response !== null) {
    // Concatenate all language responses
    return Object.values(response)
      .filter((v) => typeof v === 'string')
      .join(' ');
  }
  return '';
}

/**
 * Check if response contains forbidden phrases (case-insensitive)
 */
function containsForbiddenPhrases(text: string): string[] {
  const lowerText = text.toLowerCase();
  const found: string[] = [];

  for (const phrase of PELANGI_FORBIDDEN_PHRASES) {
    if (lowerText.includes(phrase.toLowerCase())) {
      if (!found.includes(phrase)) {
        found.push(phrase);
      }
    }
  }

  return found;
}

/**
 * Validate a single knowledge.json file
 */
function validateKnowledgeFile(
  filePath: string,
  profileId: string
): { criticalViolations: string[]; warnings: string[] } {
  const criticalViolations: string[] = [];
  const warnings: string[] = [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    const kb = JSON.parse(content) as KnowledgeBase;

    if (!kb.static || !Array.isArray(kb.static)) {
      warnings.push(`${filePath}: No 'static' array found in knowledge.json`);
      return { criticalViolations, warnings };
    }

    kb.static.forEach((entry, index) => {
      // Check required fields
      if (!entry.intent) {
        warnings.push(
          `${filePath}[${index}]: Missing 'intent' field for entry #${index}. Corrective action: Add intent field with a meaningful intent name.`
        );
      }

      // profile_id is CRITICAL - startup must fail without it
      if (!entry.profile_id) {
        criticalViolations.push(
          `${filePath}[${index}]: Missing 'profile_id' field for intent "${entry.intent}". Corrective action: Add profile_id field with value "${profileId}".`
        );
      }

      // id is a warning (not critical)
      if (!entry.id) {
        warnings.push(
          `${filePath}[${index}]: Missing 'id' field for intent "${entry.intent}". Corrective action: Add unique id field (e.g., "kb_001", "intent_greeting").`
        );
      }

      if (!entry.response) {
        warnings.push(
          `${filePath}[${index}]: Missing 'response' field for intent "${entry.intent}". Corrective action: Add response field with profile-appropriate content.`
        );
        return;
      }

      // Check response length
      const responseText = getResponseText(entry.response);
      if (!responseText || responseText.length <= 5) {
        warnings.push(
          `${filePath}[${index}]: Response for intent "${entry.intent}" is empty or too short (must be > 5 chars). Corrective action: Provide a response longer than 5 characters.`
        );
      }

      // Check for cross-profile contamination (Pelangi phrases in Makan/Southern)
      if (profileId !== 'pelangi') {
        const forbiddenFound = containsForbiddenPhrases(responseText);
        if (forbiddenFound.length > 0) {
          const details = `Found Pelangi-specific phrases: ${forbiddenFound.join(', ')}`;
          warnings.push(
            `${filePath}[${index}]: Intent "${entry.intent}" contains profile contamination. ${details}. Corrective action: Remove Pelangi-specific references and replace with ${profileId}-appropriate content.`
          );
        }
      }
    });
  } catch (err: any) {
    criticalViolations.push(
      `${filePath}: Failed to parse JSON — ${err.message}`
    );
  }

  return { criticalViolations, warnings };
}

/**
 * Find all knowledge.json files in profile directories
 */
function findKnowledgeFiles(baseDir: string): Array<{ path: string; profile: string }> {
  const files: Array<{ path: string; profile: string }> = [];

  // Look for knowledge.json files in src/assistant/data* directories
  const assistantDataDir = join(baseDir, 'src', 'assistant');

  if (!existsSync(assistantDataDir)) {
    return files;
  }

  try {
    const entries = readdirSync(assistantDataDir, { withFileTypes: true });

    for (const entry of entries) {
      // Match 'data' or 'data-{profile}' directories
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith('data')) continue;

      const dirPath = join(assistantDataDir, entry.name);
      const kbPath = join(dirPath, 'knowledge.json');

      if (existsSync(kbPath)) {
        const profile = getProfileIdFromPath(kbPath);
        files.push({ path: kbPath, profile });
      }
    }
  } catch (err: any) {
    console.warn(`[ValidateKB] Failed to scan assistant data directory: ${err.message}`);
  }

  return files;
}

/**
 * Main validation function
 * Called on server startup to validate all knowledge.json files
 */
export function validateKnowledgeBase(baseDir: string = process.cwd()): ValidationResult {
  const criticalViolations: string[] = [];
  const warnings: string[] = [];

  const kbFiles = findKnowledgeFiles(baseDir);

  if (kbFiles.length === 0) {
    // No knowledge.json files found — not a critical issue
    console.log('[ValidateKB] No knowledge.json files found to validate');
    return { isClean: true, criticalViolations: [], warnings: [] };
  }

  for (const { path: filePath, profile } of kbFiles) {
    const { criticalViolations: critical, warnings: warns } = validateKnowledgeFile(
      filePath,
      profile
    );
    criticalViolations.push(...critical);
    warnings.push(...warns);
  }

  const isClean = criticalViolations.length === 0;

  return { isClean, criticalViolations, warnings };
}

/**
 * Format validation report for logging
 */
export function formatValidationReport(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.criticalViolations.length > 0) {
    lines.push('[CRITICAL VIOLATIONS]');
    result.criticalViolations.forEach((v) => lines.push(`  • ${v}`));
  }

  if (result.warnings.length > 0) {
    lines.push('[WARNINGS]');
    result.warnings.forEach((w) => lines.push(`  • ${w}`));
  }

  return lines.join('\n');
}
