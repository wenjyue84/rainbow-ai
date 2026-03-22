#!/usr/bin/env tsx
/**
 * US-092: Intent Keyword Collision Detector CLI
 *
 * Scans intent-keywords.json across all profiles to detect:
 *   1. Within-profile collisions: keywords mapped to multiple intents in the same profile
 *   2. Cross-profile contamination: identical keywords appearing in different profiles
 *
 * Usage:
 *   npm run validate:keywords
 *   npx tsx scripts/validate-keywords.ts
 *   npx tsx scripts/validate-keywords.ts --json   (output JSON only)
 *
 * Exit codes:
 *   0 — All profiles clean
 *   1 — Collisions or cross-contamination detected
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IntentKeywords {
  intent: string;
  keywords: Record<string, string[]>;
}

interface KeywordsFile {
  intents: IntentKeywords[];
}

interface WithinProfileCollision {
  keyword: string;
  lang: string;
  intents: string[];
  severity: 'high' | 'medium';
}

interface CrossProfileDuplicate {
  keyword: string;
  lang: string;
  profiles: string[];
}

interface ProfileReport {
  profile: string;
  dataPath: string;
  totalIntents: number;
  totalKeywords: number;
  withinProfileCollisions: WithinProfileCollision[];
}

interface ValidationReport {
  timestamp: string;
  isClean: boolean;
  profiles: ProfileReport[];
  crossProfileDuplicates: CrossProfileDuplicate[];
  summary: {
    totalProfiles: number;
    totalCollisions: number;
    totalCrossProfileDuplicates: number;
  };
}

// ---------------------------------------------------------------------------
// Profile definitions
// ---------------------------------------------------------------------------

const PROFILES: Array<{ name: string; dir: string }> = [
  { name: 'pelangi', dir: 'src/assistant/data' },
  { name: 'makan', dir: 'src/assistant/data-makan' },
  { name: 'southern', dir: 'src/assistant/data-southern' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadKeywordsFile(profileDir: string): KeywordsFile | null {
  const filePath = path.join(rootDir, profileDir, 'intent-keywords.json');
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as KeywordsFile;
}

/**
 * Build a flat map of keyword -> [intents] within a single profile.
 * Keys are `"lang:keyword"` to keep language context.
 */
function buildKeywordIndex(data: KeywordsFile): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const item of data.intents) {
    for (const [lang, keywords] of Object.entries(item.keywords)) {
      for (const kw of keywords) {
        const key = `${lang}:${kw.toLowerCase().trim()}`;
        const existing = index.get(key) ?? [];
        if (!existing.includes(item.intent)) {
          existing.push(item.intent);
        }
        index.set(key, existing);
      }
    }
  }
  return index;
}

/**
 * Detect within-profile collisions from a keyword index.
 * Severity: high if keyword maps to 3+ intents, medium if 2.
 */
function detectWithinProfileCollisions(index: Map<string, string[]>): WithinProfileCollision[] {
  const collisions: WithinProfileCollision[] = [];
  for (const [key, intents] of index.entries()) {
    if (intents.length > 1) {
      const [lang, ...rest] = key.split(':');
      const keyword = rest.join(':'); // handle colons in keyword
      collisions.push({
        keyword,
        lang,
        intents,
        severity: intents.length >= 3 ? 'high' : 'medium',
      });
    }
  }
  // Sort by severity then keyword
  return collisions.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
    return a.keyword.localeCompare(b.keyword);
  });
}

/**
 * Detect cross-profile duplicates.
 * A keyword appearing in ANY intent across 2+ different profiles counts.
 */
function detectCrossProfileDuplicates(
  profileIndexes: Map<string, Map<string, string[]>>
): CrossProfileDuplicate[] {
  // Aggregate: key -> set of profile names that contain it
  const globalIndex = new Map<string, Set<string>>();
  for (const [profileName, index] of profileIndexes.entries()) {
    for (const key of index.keys()) {
      const profiles = globalIndex.get(key) ?? new Set();
      profiles.add(profileName);
      globalIndex.set(key, profiles);
    }
  }

  const duplicates: CrossProfileDuplicate[] = [];
  for (const [key, profiles] of globalIndex.entries()) {
    if (profiles.size > 1) {
      const [lang, ...rest] = key.split(':');
      const keyword = rest.join(':');
      duplicates.push({
        keyword,
        lang,
        profiles: Array.from(profiles).sort(),
      });
    }
  }

  return duplicates.sort((a, b) => a.keyword.localeCompare(b.keyword));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run(): ValidationReport {
  const profileReports: ProfileReport[] = [];
  const profileIndexes = new Map<string, Map<string, string[]>>();

  for (const { name, dir } of PROFILES) {
    const data = loadKeywordsFile(dir);
    if (!data) continue;

    const index = buildKeywordIndex(data);
    profileIndexes.set(name, index);

    const totalKeywords = Array.from(index.keys()).length;
    const collisions = detectWithinProfileCollisions(index);

    profileReports.push({
      profile: name,
      dataPath: path.join(dir, 'intent-keywords.json'),
      totalIntents: data.intents.length,
      totalKeywords,
      withinProfileCollisions: collisions,
    });
  }

  const crossProfileDuplicates = detectCrossProfileDuplicates(profileIndexes);

  const totalCollisions = profileReports.reduce(
    (sum, r) => sum + r.withinProfileCollisions.length,
    0
  );

  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    isClean: totalCollisions === 0 && crossProfileDuplicates.length === 0,
    profiles: profileReports,
    crossProfileDuplicates,
    summary: {
      totalProfiles: profileReports.length,
      totalCollisions,
      totalCrossProfileDuplicates: crossProfileDuplicates.length,
    },
  };

  return report;
}

function formatHumanReport(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push('=== Intent Keyword Collision Report ===');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push('');

  for (const pr of report.profiles) {
    lines.push(`Profile: ${pr.profile} (${pr.dataPath})`);
    lines.push(`  Intents: ${pr.totalIntents}  |  Unique keywords (by lang): ${pr.totalKeywords}`);

    if (pr.withinProfileCollisions.length === 0) {
      lines.push('  ✓ No within-profile collisions');
    } else {
      lines.push(`  ✗ Within-profile collisions: ${pr.withinProfileCollisions.length}`);
      for (const c of pr.withinProfileCollisions) {
        const flag = c.severity === 'high' ? '[HIGH]' : '[MED] ';
        lines.push(`    ${flag} [${c.lang}] "${c.keyword}" → ${c.intents.join(', ')}`);
      }
    }
    lines.push('');
  }

  lines.push(`Cross-profile duplicates: ${report.crossProfileDuplicates.length}`);
  if (report.crossProfileDuplicates.length > 0) {
    // Only show first 50 to avoid flooding terminal
    const shown = report.crossProfileDuplicates.slice(0, 50);
    for (const d of shown) {
      lines.push(`  [${d.lang}] "${d.keyword}" in profiles: ${d.profiles.join(', ')}`);
    }
    if (report.crossProfileDuplicates.length > 50) {
      lines.push(`  ... and ${report.crossProfileDuplicates.length - 50} more (use --json for full output)`);
    }
  }

  lines.push('');
  lines.push('--- Summary ---');
  lines.push(`  Profiles scanned:            ${report.summary.totalProfiles}`);
  lines.push(`  Within-profile collisions:   ${report.summary.totalCollisions}`);
  lines.push(`  Cross-profile duplicates:    ${report.summary.totalCrossProfileDuplicates}`);
  lines.push(`  Status: ${report.isClean ? '✓ CLEAN' : '✗ ISSUES FOUND'}`);

  return lines.join('\n');
}

const jsonOnly = process.argv.includes('--json');
const report = run();

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatHumanReport(report));
  console.log('');
  console.log('(Use --json flag for full machine-readable JSON output)');
}

if (!report.isClean) {
  process.exit(1);
}
process.exit(0);
