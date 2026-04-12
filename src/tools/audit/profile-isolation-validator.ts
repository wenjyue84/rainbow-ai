/**
 * profile-isolation-validator.ts — Profile Data Isolation Validator
 *
 * Scans knowledge base files for each profile to detect cross-profile business content.
 * Returns contamination percentage per profile and identifies which profile is contaminating.
 *
 * US-536: Implement Profile Data Isolation Validator with Automated Daily Audit
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve, extname } from 'path';
import { stringSimilarity } from '../../lib/content-similarity.js';
import profileKeywordsData from '../../assistant/data/profile-keywords.json' assert { type: 'json' };

// ─── Types ────────────────────────────────────────────────────────────

export interface ContaminationEntry {
  profileName: string;
  contaminatingProfile: string;
  contaminationPercentage: number;
  affectedFiles: string[];
  matchedKeywords: string[];
  sampleMatches: Array<{ file: string; text: string; similarity: number }>;
}

export interface AuditReport {
  timestamp: Date;
  profileName: string;
  profileId: string;
  kbPath: string;
  totalFiles: number;
  contaminatedFiles: number;
  contaminationPercentage: number;
  contaminationDetails: ContaminationEntry[];
  overallStatus: 'clean' | 'warning' | 'error';
}

// ─── Profile Keywords ──────────────────────────────────────────────────

interface ProfileKeywords {
  [profileId: string]: {
    name: string;
    keywords: string[];
  };
}

const keywords = profileKeywordsData as ProfileKeywords;

/**
 * Get all keywords for a specific profile
 */
function getProfileKeywords(profileId: string): string[] {
  const profile = keywords[profileId];
  if (!profile) {
    console.warn(`[profile-isolation] Profile "${profileId}" not found in keywords`);
    return [];
  }
  return profile.keywords;
}

/**
 * Get all profile IDs except the one being checked
 */
function getOtherProfileIds(currentProfileId: string): string[] {
  return Object.keys(keywords).filter(id => id !== currentProfileId);
}

// ─── File Scanning ────────────────────────────────────────────────────

/**
 * Read all markdown files from KB directory
 */
function readKBFiles(kbPath: string): Map<string, string> {
  const files = new Map<string, string>();

  if (!existsSync(kbPath)) {
    console.warn(`[profile-isolation] KB path does not exist: ${kbPath}`);
    return files;
  }

  function walkDir(dir: string, prefix: string = ''): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          // Skip hidden directories like .git, .next, node_modules
          if (!entry.name.startsWith('.')) {
            walkDir(fullPath, relativePath);
          }
        } else if (entry.isFile() && extname(entry.name) === '.md') {
          try {
            const content = readFileSync(fullPath, 'utf-8');
            files.set(relativePath, content);
          } catch (err: any) {
            console.error(
              `[profile-isolation] Failed to read ${relativePath}: ${err.message}`
            );
          }
        }
      }
    } catch (err: any) {
      console.error(
        `[profile-isolation] Failed to walk directory ${dir}: ${err.message}`
      );
    }
  }

  walkDir(kbPath);
  return files;
}

/**
 * Check if content contains keywords (case-insensitive, word boundary aware)
 */
function findKeywordMatches(
  content: string,
  kbKeywords: string[]
): Array<{ keyword: string; matches: number }> {
  const matches: Array<{ keyword: string; matches: number }> = [];
  const lowerContent = content.toLowerCase();

  for (const keyword of kbKeywords) {
    const lowerKeyword = keyword.toLowerCase();
    // Word boundary: look for keyword surrounded by spaces or punctuation
    const regex = new RegExp(`\\b${lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const foundMatches = lowerContent.match(regex) || [];

    if (foundMatches.length > 0) {
      matches.push({
        keyword,
        matches: foundMatches.length,
      });
    }
  }

  return matches;
}

/**
 * Calculate contamination percentage for a file
 * - Files with 0 matches = 0% contamination
 * - Files with any matches get a percentage based on keyword density
 */
function calculateFileContamination(
  fileContent: string,
  matchedCount: number
): number {
  if (matchedCount === 0) return 0;

  // Simple heuristic: contamination = matched keywords / word count (capped at 100%)
  const words = fileContent.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return 0;

  // Each match counts as ~1% contamination (max 100%)
  return Math.min((matchedCount / words.length) * 100, 100);
}

// ─── Validator Class ──────────────────────────────────────────────────

export class ProfileIsolationValidator {
  /**
   * Audit a profile for contamination from other profiles
   *
   * @param profileId Profile ID (e.g., 'pelangi', 'southern', 'makan-moments')
   * @param kbPath Path to knowledge base directory
   * @returns Audit report with contamination details
   */
  static async audit(profileId: string, kbPath: string): Promise<AuditReport> {
    console.log(`[profile-isolation] Auditing profile "${profileId}" at ${kbPath}`);

    const kbFiles = readKBFiles(kbPath);
    const otherProfileIds = getOtherProfileIds(profileId);
    const contaminationDetails: ContaminationEntry[] = [];
    let contaminatedFileCount = 0;
    let totalContaminationPercentage = 0;

    // Check for contamination from each other profile
    for (const otherProfileId of otherProfileIds) {
      const otherKeywords = getProfileKeywords(otherProfileId);
      const otherProfileName = keywords[otherProfileId]?.name || otherProfileId;

      const affectedFiles: string[] = [];
      const matchedKeywords: string[] = [];
      const sampleMatches: Array<{ file: string; text: string; similarity: number }> = [];
      let filesTotalMatches = 0;

      // Scan each KB file for keywords from other profile
      for (const [fileName, fileContent] of kbFiles.entries()) {
        const keywordMatches = findKeywordMatches(fileContent, otherKeywords);

        if (keywordMatches.length > 0) {
          affectedFiles.push(fileName);
          const fileMatchCount = keywordMatches.reduce((sum, m) => sum + m.matches, 0);
          filesTotalMatches += fileMatchCount;

          // Collect unique matched keywords
          for (const match of keywordMatches) {
            if (!matchedKeywords.includes(match.keyword)) {
              matchedKeywords.push(match.keyword);
            }
          }

          // Collect sample matches (first 3 files)
          if (sampleMatches.length < 3) {
            // Extract context around first match
            const lowerContent = fileContent.toLowerCase();
            const firstMatch = keywordMatches[0];
            // Escape special regex characters
            const escapedKeyword = firstMatch.keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'gi');
            const matchPos = lowerContent.search(regex);
            if (matchPos !== -1) {
              const start = Math.max(0, matchPos - 30);
              const end = Math.min(fileContent.length, matchPos + 80);
              const context = fileContent.substring(start, end).replace(/\n/g, ' ');

              sampleMatches.push({
                file: fileName,
                text: context.trim(),
                similarity: 0.85, // Keyword match
              });
            }
          }

          if (affectedFiles.length === 1) {
            // First file with contamination from this profile
            contaminatedFileCount++;
          }
        }
      }

      // Only add to details if contamination found
      if (affectedFiles.length > 0) {
        const contaminationPercentage = kbFiles.size > 0
          ? (affectedFiles.length / kbFiles.size) * 100
          : 0;

        contaminationDetails.push({
          profileName: otherProfileName,
          contaminatingProfile: otherProfileId,
          contaminationPercentage,
          affectedFiles,
          matchedKeywords,
          sampleMatches,
        });

        totalContaminationPercentage += contaminationPercentage;
      }
    }

    // Calculate overall contamination percentage
    const overallContaminationPercentage = contaminationDetails.length > 0
      ? totalContaminationPercentage / contaminationDetails.length
      : 0;

    // Determine status
    let overallStatus: 'clean' | 'warning' | 'error' = 'clean';
    if (overallContaminationPercentage > 10) {
      overallStatus = 'error';
    } else if (overallContaminationPercentage > 5) {
      overallStatus = 'warning';
    }

    const report: AuditReport = {
      timestamp: new Date(),
      profileName: keywords[profileId]?.name || profileId,
      profileId,
      kbPath,
      totalFiles: kbFiles.size,
      contaminatedFiles: contaminatedFileCount,
      contaminationPercentage: overallContaminationPercentage,
      contaminationDetails,
      overallStatus,
    };

    return report;
  }

  /**
   * Audit all profiles
   * Returns array of reports, one per profile
   */
  static async auditAll(profileConfigs: Array<{ id: string; kbPath: string }>): Promise<AuditReport[]> {
    const reports: AuditReport[] = [];

    for (const config of profileConfigs) {
      try {
        const report = await this.audit(config.id, config.kbPath);
        reports.push(report);
      } catch (err: any) {
        console.error(
          `[profile-isolation] Failed to audit profile ${config.id}: ${err.message}`
        );
      }
    }

    return reports;
  }

  /**
   * Check if contamination exceeds thresholds
   * Returns true if any profile has >5% contamination
   */
  static checkThresholds(reports: AuditReport[]): {
    hasWarning: boolean;
    hasError: boolean;
  } {
    let hasWarning = false;
    let hasError = false;

    for (const report of reports) {
      if (report.overallStatus === 'error') {
        hasError = true;
      } else if (report.overallStatus === 'warning') {
        hasWarning = true;
      }
    }

    return { hasWarning, hasError };
  }
}
