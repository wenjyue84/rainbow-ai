/**
 * Profile Contamination Detector
 *
 * Scans profile data directories for blacklisted keywords.
 * Detects incomplete profile separation where content from other profiles
 * (e.g., hostel-specific content in cafe-only data-makan profile).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ContaminationMatch {
  file: string;
  line: number;
  column: number;
  keyword: string;
  context: string;
}

export interface ContaminationReport {
  profile: string;
  timestamp: string;
  filesScanned: number;
  contaminated: boolean;
  matches: ContaminationMatch[];
  summary: string;
}

const BLACKLIST: Record<string, string[]> = {
  'data-makan': [
    'check-in',
    'check-out',
    'room',
    'guest arrival',
    'checkin',
    'checkout',
    'hostel',
    'capsule',
    'dorm',
    'bed number',
    'locker',
    'key card',
  ],
  'data-southern': [
    'capsule conflict',
    'lower deck',
    'card locked',
    'theft report',
  ],
  'data-pelangi': [],
};

/**
 * Scans profile directory for blacklisted keywords
 */
export function scanProfileContamination(
  profile: string,
  dataDir?: string
): ContaminationReport {
  const profileKey = profile.startsWith('data-') ? profile : `data-${profile}`;
  const blacklist = BLACKLIST[profileKey] || [];

  if (blacklist.length === 0) {
    return {
      profile: profileKey,
      timestamp: new Date().toISOString(),
      filesScanned: 0,
      contaminated: false,
      matches: [],
      summary: `No blacklist defined for ${profileKey}`,
    };
  }

  const baseDir = dataDir || path.join(__dirname, '../../src/assistant/data');
  const profileDir = path.join(baseDir, profile.replace('data-', ''));

  if (!fs.existsSync(profileDir)) {
    return {
      profile: profileKey,
      timestamp: new Date().toISOString(),
      filesScanned: 0,
      contaminated: false,
      matches: [],
      summary: `Profile directory not found: ${profileDir}`,
    };
  }

  const matches: ContaminationMatch[] = [];
  let filesScanned = 0;

  // Recursively scan all files
  const scanDir = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.ts'))) {
        filesScanned++;
        const content = fs.readFileSync(fullPath, 'utf8');
        const relativePath = path.relative(baseDir, fullPath);

        // Scan each line for blacklisted keywords
        const lines = content.split('\n');
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx];
          const lineNum = lineIdx + 1;

          for (const keyword of blacklist) {
            // Case-insensitive search with word boundary awareness
            const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
            const match = regex.exec(line);

            if (match) {
              const column = match.index + 1;
              // Get context: 50 chars before and after
              const start = Math.max(0, match.index - 30);
              const end = Math.min(line.length, match.index + keyword.length + 30);
              const context = line.substring(start, end).trim();

              matches.push({
                file: relativePath,
                line: lineNum,
                column,
                keyword: match[0],
                context,
              });
            }
          }
        }
      }
    }
  };

  scanDir(profileDir);

  return {
    profile: profileKey,
    timestamp: new Date().toISOString(),
    filesScanned,
    contaminated: matches.length > 0,
    matches,
    summary:
      matches.length === 0
        ? `✓ No contamination detected in ${profileKey} (${filesScanned} files scanned)`
        : `✗ Found ${matches.length} contamination match(es) in ${profileKey} across multiple files`,
  };
}

/**
 * Returns formatted report for display
 */
export function formatContaminationReport(report: ContaminationReport): string {
  const lines: string[] = [
    `\n=== Contamination Report: ${report.profile} ===`,
    `Timestamp: ${report.timestamp}`,
    `Files scanned: ${report.filesScanned}`,
    `Status: ${report.contaminated ? '⚠️  CONTAMINATED' : '✅ CLEAN'}`,
    `\n${report.summary}`,
  ];

  if (report.matches.length > 0) {
    lines.push('\nDetailed matches:');
    for (const match of report.matches) {
      lines.push(`  ${match.file}:${match.line}:${match.column}`);
      lines.push(`    Keyword: "${match.keyword}"`);
      lines.push(`    Context: ${match.context}`);
    }
  }

  return lines.join('\n');
}
