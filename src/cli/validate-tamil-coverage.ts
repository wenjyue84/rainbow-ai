#!/usr/bin/env node

/**
 * validate-tamil-coverage CLI — Tamil translation coverage validator.
 *
 * Usage:
 *   npm run validate:tamil-coverage
 *
 * Reads src/assistant/data/intent-responses.json and reports:
 * - Coverage % per intent (e.g., 'booking: 95%, inquiry: 100%')
 * - Overall coverage %
 * - Warnings if any intent <100% Tamil or overall <80%
 * - Lists specific missing Tamil keys by intent_id
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

interface IntentResponses {
  [profileId: string]: {
    [intentId: string]: {
      en: string;
      ta?: string;
    };
  };
}

interface CoverageReport {
  profileId: string;
  intentId: string;
  hasTamil: boolean;
  coverage: number;
}

interface CoverageSummary {
  reports: CoverageReport[];
  overallCoverage: number;
  totalIntents: number;
  taamilCoveredIntents: number;
  missingTamil: Array<{ profileId: string; intentId: string }>;
}

function loadIntentResponses(): IntentResponses {
  const filePath = resolve(process.cwd(), 'src/assistant/data/intent-responses.json');
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Failed to load intent-responses.json: ${err}`);
    process.exit(1);
  }
}

function validateCoverage(intentResponses: IntentResponses): CoverageSummary {
  const reports: CoverageReport[] = [];
  const missingTamil: Array<{ profileId: string; intentId: string }> = [];
  let totalIntents = 0;
  let taamilCoveredIntents = 0;

  // Iterate through all profiles and intents
  for (const [profileId, intents] of Object.entries(intentResponses)) {
    for (const [intentId, content] of Object.entries(intents)) {
      totalIntents++;
      const hasTamil = !!content.ta && content.ta.trim().length > 0;
      if (hasTamil) {
        taamilCoveredIntents++;
      } else {
        missingTamil.push({ profileId, intentId });
      }

      reports.push({
        profileId,
        intentId,
        hasTamil,
        coverage: hasTamil ? 100 : 0,
      });
    }
  }

  const overallCoverage = totalIntents > 0 ? Math.round((taamilCoveredIntents / totalIntents) * 100) : 0;

  return {
    reports,
    overallCoverage,
    totalIntents,
    taamilCoveredIntents,
    missingTamil,
  };
}

function reportCoverage(summary: CoverageSummary): void {
  // Group by intent_id to show coverage per intent
  const intentCoverage: Map<string, { total: number; covered: number }> = new Map();

  for (const report of summary.reports) {
    const key = report.intentId;
    if (!intentCoverage.has(key)) {
      intentCoverage.set(key, { total: 0, covered: 0 });
    }
    const stats = intentCoverage.get(key)!;
    stats.total++;
    if (report.hasTamil) {
      stats.covered++;
    }
  }

  // Print coverage per intent
  console.log('\n📊 Tamil Translation Coverage by Intent:');
  console.log('─'.repeat(50));

  const sortedIntents = Array.from(intentCoverage.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [intentId, stats] of sortedIntents) {
    const pct = Math.round((stats.covered / stats.total) * 100);
    const icon = pct === 100 ? '✅' : '⚠️ ';
    console.log(`  ${icon} ${intentId.padEnd(20)}: ${pct}% (${stats.covered}/${stats.total} profiles)`);
  }

  // Print overall coverage
  console.log('─'.repeat(50));
  const overallIcon = summary.overallCoverage >= 80 ? '✅' : '⚠️ ';
  console.log(
    `${overallIcon} Overall Coverage: ${summary.overallCoverage}% (${summary.taamilCoveredIntents}/${summary.totalIntents})`
  );

  // Print warnings
  if (summary.overallCoverage < 80) {
    console.log(
      `\n⚠️  WARNING: Overall Tamil coverage (${summary.overallCoverage}%) is below 80% threshold!`
    );
  }

  // Print missing Tamil by intent
  if (summary.missingTamil.length > 0) {
    console.log('\n❌ Missing Tamil Translations:');
    console.log('─'.repeat(50));
    const missingByIntent: Map<string, string[]> = new Map();
    for (const { profileId, intentId } of summary.missingTamil) {
      if (!missingByIntent.has(intentId)) {
        missingByIntent.set(intentId, []);
      }
      missingByIntent.get(intentId)!.push(profileId);
    }

    for (const [intentId, profiles] of Array.from(missingByIntent.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      console.log(`  • ${intentId}: ${profiles.join(', ')}`);
    }
  }

  // Exit with appropriate code
  const exitCode = summary.overallCoverage >= 80 && summary.missingTamil.length === 0 ? 0 : 1;
  console.log();
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const intentResponses = loadIntentResponses();
  const summary = validateCoverage(intentResponses);
  reportCoverage(summary);
}

main().catch((err) => {
  console.error('Validation failed with error:', err);
  process.exit(1);
});
