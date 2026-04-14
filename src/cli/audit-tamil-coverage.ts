#!/usr/bin/env node

/**
 * audit-tamil-coverage CLI — Comprehensive Tamil translation coverage audit.
 *
 * Usage:
 *   npm run audit:tamil-coverage
 *
 * Scans all JSON configuration files and markdown knowledge base files,
 * reporting Tamil translation completeness with:
 * - % Tamil coverage per file
 * - List of untranslated sections
 * - Overall coverage statistics
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, relative, extname } from 'path';

interface FileAudit {
  filePath: string;
  fileType: 'json' | 'markdown';
  totalStrings: number;
  tamilStrings: number;
  coverage: number;
  untranslated: string[];
}

interface AuditReport {
  files: FileAudit[];
  overallCoverage: number;
  totalFiles: number;
  totalStrings: number;
  totalTamilStrings: number;
}

/**
 * Recursively find all JSON files in a directory
 */
function findJsonFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(current: string) {
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = resolve(current, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (extname(entry.name) === '.json') {
          files.push(fullPath);
        }
      }
    } catch (err) {
      // Skip inaccessible directories
    }
  }

  walk(dir);
  return files;
}

/**
 * Recursively find all Markdown files in a directory (excluding backup files)
 */
function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(current: string) {
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = resolve(current, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (extname(entry.name) === '.md' && !entry.name.endsWith('.backup')) {
          files.push(fullPath);
        }
      }
    } catch (err) {
      // Skip inaccessible directories
    }
  }

  walk(dir);
  return files;
}

/**
 * Count translation coverage in a JSON file
 * Looks for:
 * 1. Language-tagged objects: { "en": [...], "ta": [...] }
 * 2. Property pairs: en_* and ta_* keys
 */
function auditJsonFile(filePath: string): FileAudit {
  let totalStrings = 0;
  let tamilStrings = 0;
  const untranslated: string[] = [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);

    // Recursively scan the JSON structure
    function scanValue(value: unknown, path: string = ''): void {
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((item, idx) => {
            scanValue(item, `${path}[${idx}]`);
          });
        } else {
          const obj = value as Record<string, unknown>;
          const keys = Object.keys(obj);

          // Check for language-tagged structure: { "en": ..., "ta": ..., "ms": ..., etc }
          const hasEnKey = 'en' in obj;
          const hasTaKey = 'ta' in obj;

          if (hasEnKey && (hasTaKey || 'ms' in obj || 'zh' in obj)) {
            // This is a language-tagged object
            totalStrings++;
            if (hasTaKey) {
              tamilStrings++;
            } else {
              untranslated.push(`${path} (missing ta key)`);
            }
          } else {
            // Scan all properties
            keys.forEach((key) => {
              // Check for en_* and ta_* property pairs
              if (key.startsWith('en_')) {
                const taKey = key.replace(/^en_/, 'ta_');
                totalStrings++;
                if (taKey in obj) {
                  tamilStrings++;
                } else {
                  untranslated.push(`${path}.${taKey} (missing)`);
                }
              }
              scanValue(obj[key], `${path}.${key}`);
            });
          }
        }
      } else if (typeof value === 'string') {
        // Skip individual strings; we track at higher levels
      }
    }

    scanValue(json);
  } catch (err) {
    console.error(`Error reading ${filePath}: ${err}`);
  }

  const coverage = totalStrings > 0 ? Math.round((tamilStrings / totalStrings) * 100) : 100;

  return {
    filePath,
    fileType: 'json',
    totalStrings,
    tamilStrings,
    coverage,
    untranslated,
  };
}

/**
 * Count translation coverage in a Markdown file
 * Looks for: {{en:...}} and {{ta:...}} template placeholders
 */
function auditMarkdownFile(filePath: string): FileAudit {
  let totalStrings = 0;
  let tamilStrings = 0;
  const untranslated: string[] = [];

  try {
    const content = readFileSync(filePath, 'utf-8');

    // Find all {{en:...}} and {{ta:...}} placeholders
    const enPattern = /\{\{en:([^}]+)\}\}/g;
    const taPattern = /\{\{ta:([^}]+)\}\}/g;

    // Track which en: patterns have corresponding ta: patterns
    const enMatches = new Map<string, number>();
    const taMatches = new Set<string>();

    let match;

    // Count all en: placeholders
    while ((match = enPattern.exec(content)) !== null) {
      const key = match[1].trim();
      const current = enMatches.get(key) || 0;
      enMatches.set(key, current + 1);
      totalStrings++;
    }

    // Count all ta: placeholders
    while ((match = taPattern.exec(content)) !== null) {
      const key = match[1].trim();
      taMatches.add(key);
      tamilStrings++;
    }

    // Find untranslated sections
    for (const [key] of enMatches) {
      if (!taMatches.has(key)) {
        untranslated.push(key);
      }
    }
  } catch (err) {
    console.error(`Error reading ${filePath}: ${err}`);
  }

  const coverage = totalStrings > 0 ? Math.round((tamilStrings / totalStrings) * 100) : 100;

  return {
    filePath,
    fileType: 'markdown',
    totalStrings,
    tamilStrings,
    coverage,
    untranslated,
  };
}

/**
 * Generate and print the audit report
 */
function reportAudit(report: AuditReport): void {
  console.log('\n📊 Tamil Translation Coverage Audit Report');
  console.log('═'.repeat(70));

  // Print per-file coverage
  console.log('\n📁 Coverage by File:');
  console.log('─'.repeat(70));

  const sorted = report.files.sort((a, b) => {
    if (a.coverage !== b.coverage) {
      return a.coverage - b.coverage; // Sort by coverage ascending
    }
    return a.filePath.localeCompare(b.filePath);
  });

  for (const file of sorted) {
    const icon = file.coverage === 100 ? '✅' : file.coverage >= 80 ? '⚠️ ' : '❌';
    const filename = relative(process.cwd(), file.filePath);
    const coverage = `${file.coverage}%`.padStart(4);
    const stats = `(${file.tamilStrings}/${file.totalStrings})`.padStart(12);
    console.log(`${icon} ${coverage} ${stats.padEnd(15)} ${filename}`);
  }

  // Print untranslated sections for files with <100% coverage
  const filesWithGaps = report.files.filter((f) => f.coverage < 100 && f.untranslated.length > 0);
  if (filesWithGaps.length > 0) {
    console.log('\n❌ Untranslated Sections:');
    console.log('─'.repeat(70));
    for (const file of filesWithGaps) {
      const filename = relative(process.cwd(), file.filePath);
      console.log(`\n  📄 ${filename}:`);
      file.untranslated.slice(0, 5).forEach((section) => {
        console.log(`     • ${section}`);
      });
      if (file.untranslated.length > 5) {
        console.log(`     • ... and ${file.untranslated.length - 5} more`);
      }
    }
  }

  // Print overall summary
  console.log('\n' + '═'.repeat(70));
  const overallIcon = report.overallCoverage >= 80 ? '✅' : '⚠️ ';
  console.log(
    `${overallIcon} Overall Tamil Coverage: ${report.overallCoverage}% (${report.totalTamilStrings}/${report.totalStrings})`
  );
  console.log(`   Files scanned: ${report.totalFiles}`);
  console.log(`   Files at 100%: ${report.files.filter((f) => f.coverage === 100).length}`);
  console.log(`   Files at 80%+: ${report.files.filter((f) => f.coverage >= 80).length}`);
  console.log(`   Files below 80%: ${report.files.filter((f) => f.coverage < 80).length}`);

  if (report.overallCoverage < 80) {
    console.log(`\n⚠️  WARNING: Overall Tamil coverage (${report.overallCoverage}%) is below 80% threshold!`);
  }

  console.log();
}

/**
 * Main audit function
 */
async function main(): Promise<void> {
  const cwd = process.cwd();
  const dataDir = resolve(cwd, 'src/assistant/data');
  const kbDir = resolve(cwd, '.rainbow-kb');

  const files: FileAudit[] = [];

  // Audit JSON files in src/assistant/data/
  console.log('🔍 Scanning configuration files...');
  const jsonFiles = findJsonFiles(dataDir);
  for (const jsonFile of jsonFiles) {
    files.push(auditJsonFile(jsonFile));
  }

  // Audit Markdown files in .rainbow-kb/
  console.log('🔍 Scanning knowledge base files...');
  const mdFiles = findMarkdownFiles(kbDir);
  for (const mdFile of mdFiles) {
    files.push(auditMarkdownFile(mdFile));
  }

  // Calculate overall coverage
  const totalStrings = files.reduce((sum, f) => sum + f.totalStrings, 0);
  const totalTamilStrings = files.reduce((sum, f) => sum + f.tamilStrings, 0);
  const overallCoverage = totalStrings > 0 ? Math.round((totalTamilStrings / totalStrings) * 100) : 100;

  const report: AuditReport = {
    files,
    overallCoverage,
    totalFiles: files.length,
    totalStrings,
    totalTamilStrings,
  };

  reportAudit(report);

  // Exit with appropriate code
  const exitCode = report.overallCoverage >= 80 ? 0 : 1;
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
