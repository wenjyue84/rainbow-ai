#!/usr/bin/env tsx
/**
 * US-583: Intent Keyword Frequency Analysis CLI Tool
 *
 * Analyzes keyword frequency across intent-keywords.json files and KB markdown
 * files. Identifies under/over-represented keywords to improve classification.
 *
 * Usage:
 *   npm run intent:analyze-keywords
 *   npm run intent:analyze-keywords -- --json
 *   npm run intent:analyze-keywords -- --profile pelangi
 *
 * Exit codes:
 *   0 — Analysis complete
 *   1 — Error (no files found, parse error)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(__dirname, '..', '..');

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

export interface KeywordFrequencyEntry {
  keyword: string;
  /** Total occurrences across all intents and all languages. */
  totalCount: number;
  /** Intents that contain this keyword (deduplicated). */
  intents: string[];
  /** Languages this keyword appears in. */
  languages: string[];
  /** KB files where this keyword string appears. */
  kbFiles: string[];
}

export interface GapEntry {
  keyword: string;
  /** Intents that define this keyword but it never appears in KB files. */
  intents: string[];
  languages: string[];
}

export interface FrequencyReport {
  timestamp: string;
  profilesScanned: string[];
  kbFilesScanned: number;
  totalUniqueKeywords: number;
  /** Keywords sorted descending by totalCount. */
  keywords: KeywordFrequencyEntry[];
  /** Keywords defined in intents but absent from KB content (gap analysis). */
  gaps: GapEntry[];
  /** Keywords appearing in more than 3 intents (over-represented). */
  overRepresented: KeywordFrequencyEntry[];
}

// ---------------------------------------------------------------------------
// Profile directory mapping (same convention as intent-keyword-lint.ts)
// ---------------------------------------------------------------------------

const PROFILE_DIRS: Record<string, { dataDir: string; kbDir: string }> = {
  pelangi: {
    dataDir: 'src/assistant/data',
    kbDir: '.rainbow-kb',
  },
  southern: {
    dataDir: 'src/assistant/data-southern',
    kbDir: '.rainbow-kb-southern',
  },
  makan: {
    dataDir: 'src/assistant/data-makan',
    kbDir: '.rainbow-kb-makan',
  },
};

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Collect all .md files recursively under a directory.
 */
function collectMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectMarkdownFiles(full));
    } else if (extname(entry) === '.md') {
      results.push(full);
    }
  }
  return results;
}

/**
 * Load an intent-keywords.json file, returning null on failure.
 */
function loadKeywordsFile(filePath: string): KeywordsFile | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as KeywordsFile;
  } catch {
    console.warn(`Warning: failed to parse ${filePath}`);
    return null;
  }
}

/**
 * Analyze keyword frequency across intent definitions and KB markdown files.
 *
 * @param rootDir - Absolute project root directory
 * @param profileFilter - Optional profile name to limit scope
 */
export function analyzeKeywordFrequency(
  rootDir: string,
  profileFilter?: string,
): FrequencyReport {
  const profileNames = profileFilter
    ? [profileFilter]
    : Object.keys(PROFILE_DIRS);

  const profilesScanned: string[] = [];
  // keyword (normalized) -> aggregated data
  const kwMap = new Map<
    string,
    { totalCount: number; intents: Set<string>; languages: Set<string>; kbFiles: Set<string> }
  >();

  // Collect all KB content
  const kbTextMap = new Map<string, string>(); // filePath -> text
  let kbFilesScanned = 0;

  for (const profileName of profileNames) {
    const profileConfig = PROFILE_DIRS[profileName];
    if (!profileConfig) {
      console.warn(`Warning: unknown profile '${profileName}', skipping`);
      continue;
    }

    // --- Load intent-keywords.json ---
    const kwPath = join(rootDir, profileConfig.dataDir, 'intent-keywords.json');
    const kwFile = loadKeywordsFile(kwPath);
    if (!kwFile) {
      console.warn(`Warning: no intent-keywords.json for profile '${profileName}', skipping`);
      continue;
    }
    profilesScanned.push(profileName);

    if (!Array.isArray(kwFile.intents)) continue;

    for (const entry of kwFile.intents) {
      if (!entry.intent || !entry.keywords) continue;
      for (const [lang, words] of Object.entries(entry.keywords)) {
        if (!Array.isArray(words)) continue;
        for (const raw of words) {
          const kw = raw.trim().toLowerCase();
          if (!kw) continue;
          if (!kwMap.has(kw)) {
            kwMap.set(kw, { totalCount: 0, intents: new Set(), languages: new Set(), kbFiles: new Set() });
          }
          const rec = kwMap.get(kw)!;
          rec.totalCount += 1;
          rec.intents.add(entry.intent);
          rec.languages.add(lang);
        }
      }
    }

    // --- Collect KB files ---
    const kbDir = join(rootDir, profileConfig.kbDir);
    for (const mdPath of collectMarkdownFiles(kbDir)) {
      if (!kbTextMap.has(mdPath)) {
        kbTextMap.set(mdPath, readFileSync(mdPath, 'utf-8').toLowerCase());
        kbFilesScanned += 1;
      }
    }
  }

  // --- Match keywords against KB content ---
  for (const [kw, rec] of kwMap.entries()) {
    for (const [mdPath, text] of kbTextMap.entries()) {
      if (text.includes(kw)) {
        rec.kbFiles.add(mdPath);
      }
    }
  }

  // --- Build report entries ---
  const keywords: KeywordFrequencyEntry[] = Array.from(kwMap.entries())
    .map(([kw, rec]) => ({
      keyword: kw,
      totalCount: rec.totalCount,
      intents: Array.from(rec.intents).sort(),
      languages: Array.from(rec.languages).sort(),
      kbFiles: Array.from(rec.kbFiles).map((p) => p.replace(rootDir, '').replace(/\\/g, '/')),
    }))
    .sort((a, b) => b.totalCount - a.totalCount || a.keyword.localeCompare(b.keyword));

  const gaps: GapEntry[] = keywords
    .filter((k) => k.kbFiles.length === 0)
    .map(({ keyword, intents, languages }) => ({ keyword, intents, languages }));

  const overRepresented = keywords.filter((k) => k.intents.length > 3);

  return {
    timestamp: new Date().toISOString(),
    profilesScanned,
    kbFilesScanned,
    totalUniqueKeywords: kwMap.size,
    keywords,
    gaps,
    overRepresented,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatReport(report: FrequencyReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('╔════════════════════════════════════════════════════════╗');
  lines.push('║     Intent Keyword Frequency Analysis Report           ║');
  lines.push('╚════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`  Profiles scanned : ${report.profilesScanned.join(', ') || '(none)'}`);
  lines.push(`  KB files scanned : ${report.kbFilesScanned}`);
  lines.push(`  Unique keywords  : ${report.totalUniqueKeywords}`);
  lines.push(`  Gap count        : ${report.gaps.length}`);
  lines.push(`  Over-represented : ${report.overRepresented.length}`);
  lines.push('');

  // Top 20 keywords
  lines.push('── Top 20 Keywords by Frequency ─────────────────────────');
  const top20 = report.keywords.slice(0, 20);
  for (const k of top20) {
    const bar = '█'.repeat(Math.min(k.totalCount, 20));
    const inKB = k.kbFiles.length > 0 ? `✓ KB(${k.kbFiles.length})` : '✗ KB';
    lines.push(`  ${k.keyword.padEnd(30)} ${String(k.totalCount).padStart(3)}  ${bar.padEnd(20)}  ${inKB}`);
  }
  lines.push('');

  // Over-represented
  if (report.overRepresented.length > 0) {
    lines.push('── Over-Represented Keywords (>3 intents) ───────────────');
    for (const k of report.overRepresented) {
      lines.push(`  ${k.keyword.padEnd(30)} intents: ${k.intents.join(', ')}`);
    }
    lines.push('');
  }

  // Gap analysis (first 30)
  if (report.gaps.length > 0) {
    lines.push('── Gap Analysis (keywords absent from KB) ────────────────');
    lines.push(`  Showing first 30 of ${report.gaps.length} gaps`);
    for (const g of report.gaps.slice(0, 30)) {
      lines.push(`  ${g.keyword.padEnd(30)} intents: ${g.intents.join(', ')}`);
    }
    lines.push('');
  } else {
    lines.push('── Gap Analysis ──────────────────────────────────────────');
    lines.push('  ✓ All keywords have at least one KB file match');
    lines.push('');
  }

  lines.push(`  Generated: ${report.timestamp}`);
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const profileIdx = args.indexOf('--profile');
  const profileFilter = profileIdx >= 0 ? args[profileIdx + 1] : undefined;

  const report = analyzeKeywordFrequency(rootDir, profileFilter);

  if (report.profilesScanned.length === 0) {
    console.error('ERROR: No profiles found or no intent-keywords.json files accessible');
    process.exit(1);
  }

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }

  process.exit(0);
}

// Only run CLI when executed directly (not when imported by tests)
const isMain = process.argv[1]?.includes('intent-keyword-analyzer');
if (isMain) {
  main();
}
