#!/usr/bin/env tsx
/**
 * US-161: Audit and report orphaned intent-keywords.json entries
 *
 * Cross-references intent-keywords.json against intents.json and outputs
 * orphaned keywords (those mapped to intents that don't exist in the profile).
 *
 * Usage:
 *   npm run audit:keywords -- --profile=makan
 *   npx tsx src/tools/intent-keyword-audit-cli.ts --profile=makan
 *   npx tsx src/tools/intent-keyword-audit-cli.ts --profile=pelangi --json
 *
 * Exit codes:
 *   0 — No orphaned keywords found
 *   1 — Orphaned keywords found (or in production mode)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

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

interface IntentCategory {
  category: string;
  [key: string]: unknown;
}

interface PhaseIntents {
  phase: string;
  intents: IntentCategory[];
}

interface IntentsFile {
  categories: PhaseIntents[];
}

interface OrphanedKeyword {
  intent_id: string;
  keyword_count: number;
  sample_keywords: string[];
  suggested_cleanup_action: string;
}

interface AuditReport {
  timestamp: string;
  profile: string;
  data_path: string;
  total_intents_in_keywords: number;
  total_intents_in_profile: number;
  orphaned_count: number;
  orphaned_keywords: OrphanedKeyword[];
  summary: {
    is_clean: boolean;
    status_message: string;
  };
}

// ---------------------------------------------------------------------------
// Profile configuration
// ---------------------------------------------------------------------------

const PROFILE_CONFIG: Record<string, { keywordsDir: string; intentsFile: string }> = {
  pelangi: {
    keywordsDir: 'src/assistant/data',
    intentsFile: 'src/assistant/data/intents.json',
  },
  makan: {
    keywordsDir: 'src/assistant/data-makan',
    intentsFile: 'src/assistant/data-makan/intents.json',
  },
  southern: {
    keywordsDir: 'src/assistant/data-southern',
    intentsFile: 'src/assistant/data-southern/intents.json',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadKeywordsFile(profileDir: string): KeywordsFile | null {
  const filePath = path.join(rootDir, profileDir, 'intent-keywords.json');
  if (!fs.existsSync(filePath)) {
    console.error(`[ERROR] Keywords file not found: ${filePath}`);
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as KeywordsFile;
  } catch (error) {
    console.error(`[ERROR] Failed to parse keywords file: ${error}`);
    return null;
  }
}

function loadIntentsFile(intentsPath: string): IntentsFile | null {
  const filePath = path.join(rootDir, intentsPath);
  if (!fs.existsSync(filePath)) {
    console.error(`[ERROR] Intents file not found: ${filePath}`);
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as IntentsFile;
  } catch (error) {
    console.error(`[ERROR] Failed to parse intents file: ${error}`);
    return null;
  }
}

/**
 * Extract all intent category names from intents.json
 */
function extractIntentCategories(intentsData: IntentsFile): Set<string> {
  const categories = new Set<string>();

  if (Array.isArray(intentsData.categories)) {
    for (const phase of intentsData.categories) {
      if (Array.isArray(phase.intents)) {
        for (const intent of phase.intents) {
          if (intent.category) {
            categories.add(intent.category);
          }
        }
      }
    }
  }

  return categories;
}

/**
 * Find orphaned intents: those in intent-keywords.json but not in intents.json
 */
function findOrphanedIntents(
  keywordsData: KeywordsFile,
  validCategories: Set<string>
): Map<string, string[]> {
  const orphanedIndex = new Map<string, string[]>();

  for (const item of keywordsData.intents) {
    if (!validCategories.has(item.intent)) {
      // Collect all keywords for this orphaned intent
      const allKeywords: string[] = [];
      for (const keywords of Object.values(item.keywords)) {
        allKeywords.push(...keywords);
      }
      orphanedIndex.set(item.intent, allKeywords);
    }
  }

  return orphanedIndex;
}

/**
 * Generate cleanup action suggestion
 */
function suggestCleanupAction(intentId: string, _keywordCount: number): string {
  // For most orphaned intents, suggest removal from keywords file
  // since the intent no longer exists in the profile
  return `Remove intent "${intentId}" from intent-keywords.json (orphaned — no longer exists in profile intents)`;
}

/**
 * Generate audit report
 */
function generateReport(
  profile: string,
  keywordsDir: string,
  intentsPath: string,
  keywordsData: KeywordsFile,
  intentsData: IntentsFile,
  orphanedIntents: Map<string, string[]>
): AuditReport {
  const validCategories = extractIntentCategories(intentsData);
  const orphanedEntries: OrphanedKeyword[] = [];

  for (const [intentId, keywords] of orphanedIntents.entries()) {
    orphanedEntries.push({
      intent_id: intentId,
      keyword_count: keywords.length,
      sample_keywords: keywords.slice(0, 5),
      suggested_cleanup_action: suggestCleanupAction(intentId, keywords.length),
    });
  }

  // Sort by keyword count (descending)
  orphanedEntries.sort((a, b) => b.keyword_count - a.keyword_count);

  const isClean = orphanedEntries.length === 0;
  const statusMessage = isClean
    ? `✓ No orphaned keywords found in ${profile}`
    : `✗ Found ${orphanedEntries.length} orphaned intent(s) in ${profile}`;

  return {
    timestamp: new Date().toISOString(),
    profile,
    data_path: path.join(keywordsDir, 'intent-keywords.json'),
    total_intents_in_keywords: keywordsData.intents.length,
    total_intents_in_profile: validCategories.size,
    orphaned_count: orphanedEntries.length,
    orphaned_keywords: orphanedEntries,
    summary: {
      is_clean: isClean,
      status_message: statusMessage,
    },
  };
}

function formatHumanReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push('=== Intent Keyword Audit Report ===');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push(`Profile: ${report.profile}`);
  lines.push(`Data path: ${report.data_path}`);
  lines.push('');
  lines.push(`Total intents in intent-keywords.json: ${report.total_intents_in_keywords}`);
  lines.push(`Total intents in profile's intents.json: ${report.total_intents_in_profile}`);
  lines.push('');

  if (report.orphaned_count === 0) {
    lines.push('✓ CLEAN: No orphaned keywords found');
  } else {
    lines.push(`✗ ISSUES FOUND: ${report.orphaned_count} orphaned intent(s)`);
    lines.push('');
    for (const orphan of report.orphaned_keywords) {
      lines.push(`Intent: "${orphan.intent_id}" (${orphan.keyword_count} keywords)`);
      lines.push(`  Sample keywords: ${orphan.sample_keywords.join(', ')}`);
      lines.push(`  Action: ${orphan.suggested_cleanup_action}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run(): number {
  const args = process.argv.slice(2);
  const profileArg = args.find((arg) => arg.startsWith('--profile='))?.split('=')[1] || 'pelangi';
  const jsonOnly = args.includes('--json');
  const nodeEnv = process.env.NODE_ENV || 'development';

  // Validate profile
  if (!PROFILE_CONFIG[profileArg]) {
    console.error(`[ERROR] Unknown profile: ${profileArg}`);
    console.error(`Valid profiles: ${Object.keys(PROFILE_CONFIG).join(', ')}`);
    return 1;
  }

  const config = PROFILE_CONFIG[profileArg];

  // Load files
  const keywordsData = loadKeywordsFile(config.keywordsDir);
  if (!keywordsData) {
    return 1;
  }

  const intentsData = loadIntentsFile(config.intentsFile);
  if (!intentsData) {
    return 1;
  }

  // Extract valid categories and find orphaned intents
  const validCategories = extractIntentCategories(intentsData);
  const orphanedIntents = findOrphanedIntents(keywordsData, validCategories);

  // Generate report
  const report = generateReport(
    profileArg,
    config.keywordsDir,
    config.intentsFile,
    keywordsData,
    intentsData,
    orphanedIntents
  );

  // Output
  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHumanReport(report));
  }

  // Exit with appropriate code
  if (report.orphaned_count > 0) {
    if (nodeEnv === 'production') {
      console.error('');
      console.error('[PRODUCTION] Aborting due to orphaned keywords. Fix before deploying.');
      return 1;
    }
    return 1;
  }

  return 0;
}

const exitCode = run();
process.exit(exitCode);
