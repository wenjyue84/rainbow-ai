/**
 * kb-profile-indexer.ts
 *
 * Knowledge Base Profile Isolation Index Builder
 * Scans KB directories and detects cross-profile keyword violations
 *
 * Usage:
 *   npm run index:kb-profiles > kb-isolation-report.json
 *   npm run index:kb-profiles -- --format=json
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, extname } from 'path';

// ── Types ─────────────────────────────────────────────────────────────

export interface ProfileKeywordConfig {
  id: string;
  name: string;
  kbDir: string;
  keywords: string[];
}

export interface CrossProfileViolation {
  profileId: string;
  filePath: string;
  lineNumber: number;
  content: string;
  detectedKeywords: string[];
  sourceProfile: string;
}

export interface KBProfileIndex {
  timestamp: string;
  profiles: Array<{
    id: string;
    name: string;
    kbDir: string;
    fileCount: number;
    totalLines: number;
  }>;
  violations: CrossProfileViolation[];
  summary: {
    totalProfiles: number;
    totalFiles: number;
    totalViolations: number;
    profilesWithViolations: string[];
  };
}

// ── Configuration ──────────────────────────────────────────────────────

/**
 * Define profile-specific keywords that should be isolated.
 * Keywords are case-insensitive and used for cross-profile detection.
 */
const PROFILE_KEYWORDS: ProfileKeywordConfig[] = [
  {
    id: 'pelangi',
    name: 'Pelangi Capsule Hostel',
    kbDir: '.rainbow-kb',
    keywords: [
      'Pelangi Capsule',
      'Pelangi Hostel',
      'Pelangi',
      'capsule hostel',
      'capsule bed',
      'dorm room',
      'bunk bed',
      'JB Hostel',
      'Jalan Ibrahim Sultan',
    ],
  },
  {
    id: 'southern',
    name: 'Southern Homestay',
    kbDir: '.rainbow-kb-southern',
    keywords: [
      'Southern Homestay',
      'Southern',
      'homestay',
      'Senai',
      'Johor Bahru',
      'JB factory workers',
      'furnished room',
    ],
  },
  {
    id: 'makan-moments',
    name: 'Makan Moments Cafe',
    kbDir: '.rainbow-kb-makan',
    keywords: [
      'Makan Moments',
      'Makan Moments Cafe',
      'Thai-Malaysian fusion',
      'Taman Impian Emas',
      'cafe',
      'restaurant',
      'menu',
      'food ordering',
      'Skudai',
    ],
  },
];

// ── Core Logic ──────────────────────────────────────────────────────────

/**
 * Recursively scan a directory and return all markdown files.
 */
export function scanKBDirectory(kbDir: string): string[] {
  const absolutePath = resolve(process.cwd(), kbDir);
  const files: string[] = [];

  try {
    const entries = readdirSync(absolutePath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(absolutePath, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        files.push(
          ...scanKBDirectory(
            join(kbDir, entry.name)
          ).map((f) => f)
        );
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        // Add markdown files
        files.push(join(kbDir, entry.name));
      }
    }
  } catch (err: any) {
    if (typeof process !== 'undefined' && process.stderr) {
      process.stderr.write(`Warning: Could not scan ${absolutePath}: ${err.message}\n`);
    }
  }

  return files;
}

/**
 * Read file content and return lines with their line numbers.
 */
export function readFileLines(
  filePath: string
): Array<{ lineNumber: number; content: string }> {
  try {
    const absolutePath = resolve(process.cwd(), filePath);
    const content = readFileSync(absolutePath, 'utf-8');
    const lines = content.split('\n');

    return lines.map((content, index) => ({
      lineNumber: index + 1,
      content,
    }));
  } catch (err: any) {
    if (typeof process !== 'undefined' && process.stderr) {
      process.stderr.write(`Warning: Could not read ${filePath}: ${err.message}\n`);
    }
    return [];
  }
}

/**
 * Detect cross-profile keyword violations in a file.
 * Returns violations where keywords from OTHER profiles are found.
 */
export function detectCrossProfileReferences(
  filePath: string,
  currentProfileId: string
): CrossProfileViolation[] {
  const violations: CrossProfileViolation[] = [];
  const lines = readFileLines(filePath);

  // Get keywords from ALL other profiles
  const otherProfileKeywords = PROFILE_KEYWORDS.filter(
    (p) => p.id !== currentProfileId
  );

  for (const { lineNumber, content } of lines) {
    const lowerContent = content.toLowerCase();

    for (const otherProfile of otherProfileKeywords) {
      const detectedKeywords: string[] = [];

      for (const keyword of otherProfile.keywords) {
        if (lowerContent.includes(keyword.toLowerCase())) {
          detectedKeywords.push(keyword);
        }
      }

      if (detectedKeywords.length > 0) {
        violations.push({
          profileId: currentProfileId,
          filePath,
          lineNumber,
          content: content.trim(),
          detectedKeywords,
          sourceProfile: otherProfile.id,
        });
      }
    }
  }

  return violations;
}

/**
 * Build a complete profile isolation index by scanning all KB directories.
 */
export function buildProfileIndex(): KBProfileIndex {
  const violations: CrossProfileViolation[] = [];
  const profileStats: Array<{
    id: string;
    name: string;
    kbDir: string;
    fileCount: number;
    totalLines: number;
  }> = [];
  const profilesWithViolations = new Set<string>();

  for (const profileConfig of PROFILE_KEYWORDS) {
    if (typeof process !== 'undefined' && process.stderr) {
      process.stderr.write(`Scanning profile: ${profileConfig.id} (${profileConfig.name})\n`);
    }

    // Scan all files in the KB directory
    const files = scanKBDirectory(profileConfig.kbDir);
    let totalLines = 0;

    if (typeof process !== 'undefined' && process.stderr) {
      process.stderr.write(`  Found ${files.length} markdown files\n`);
    }

    for (const filePath of files) {
      const fileViolations = detectCrossProfileReferences(
        filePath,
        profileConfig.id
      );

      if (fileViolations.length > 0) {
        profilesWithViolations.add(profileConfig.id);
        violations.push(...fileViolations);
        if (typeof process !== 'undefined' && process.stderr) {
          process.stderr.write(
            `  ${filePath}: ${fileViolations.length} violations detected\n`
          );
        }
      }

      // Count lines for stats
      const lines = readFileLines(filePath);
      totalLines += lines.length;
    }

    profileStats.push({
      id: profileConfig.id,
      name: profileConfig.name,
      kbDir: profileConfig.kbDir,
      fileCount: files.length,
      totalLines,
    });
  }

  return {
    timestamp: new Date().toISOString(),
    profiles: profileStats,
    violations,
    summary: {
      totalProfiles: PROFILE_KEYWORDS.length,
      totalFiles: profileStats.reduce((sum, p) => sum + p.fileCount, 0),
      totalViolations: violations.length,
      profilesWithViolations: Array.from(profilesWithViolations),
    },
  };
}

// ── CLI Entry Point ───────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const formatArg = args.find((a) => a.startsWith('--format='));
  const format = formatArg ? formatArg.split('=')[1] : 'json';

  process.stderr.write('Building KB profile isolation index...\n');
  const index = buildProfileIndex();

  if (format === 'json') {
    console.log(JSON.stringify(index, null, 2));
  } else {
    // Default human-readable format
    process.stderr.write('\n=== KB Profile Isolation Report ===\n\n');
    process.stderr.write(`Generated: ${index.timestamp}\n`);
    process.stderr.write(`\nProfiles Scanned:\n`);

    for (const profile of index.profiles) {
      process.stderr.write(`  - ${profile.name}: ${profile.fileCount} files, ${profile.totalLines} lines\n`);
    }

    process.stderr.write(`\nViolations Summary:\n`);
    process.stderr.write(`  Total Violations: ${index.summary.totalViolations}\n`);
    process.stderr.write(
      `  Profiles with Violations: ${index.summary.profilesWithViolations.join(', ') || 'None'}\n`
    );

    if (index.violations.length > 0) {
      process.stderr.write(`\nTop Violations (first 10):\n`);
      const topViolations = index.violations.slice(0, 10);
      for (const violation of topViolations) {
        process.stderr.write(
          `  [${violation.filePath}:${violation.lineNumber}] Cross-ref to ${violation.sourceProfile}: ${violation.detectedKeywords.join(', ')}\n`
        );
      }
    }

    // Always output JSON on stdout for piping
    console.log(JSON.stringify(index, null, 2));
  }

  process.stderr.write(`\nDone.\n`);
}

// Run CLI only when executed directly (not when imported in tests)
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] != null &&
  (process.argv[1].endsWith('kb-profile-indexer.ts') ||
    process.argv[1].endsWith('kb-profile-indexer.js'));

if (isMain) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

export { PROFILE_KEYWORDS };
