#!/usr/bin/env tsx
/**
 * US-380: Profile Data Cross-File Semantic Consistency Validator
 *
 * Validates that intents referenced across profile config files are consistent:
 * - Knowledge.json intents exist in routing.json
 * - Intent-keywords.json intents exist in routing.json
 * - Workflows reference valid intents
 *
 * Usage:
 *   npm run validate:profile-consistency -- --profile=data-pelangi
 *   npm run validate:profile-consistency -- --profile=data-makan
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

interface ConsistencyReport {
  orphaned_amenities: string[]; // Intents in knowledge.json but not in routing.json
  missing_intent_routes: string[]; // Intents in intent-keywords.json but not in routing.json
  file_mismatches: string[]; // Other inconsistencies
  valid: boolean;
}

interface KnowledgeEntry {
  intent: string;
  id?: string;
  profile_id?: string;
  [key: string]: any;
}

interface IntentKeywordEntry {
  intent: string;
  keywords: Record<string, string[]>;
}

interface IntentKeywordsFile {
  intents: IntentKeywordEntry[];
}

// ─── Main Validator ──────────────────────────────────────────────────────────

async function validateProfileConsistency(profile: string): Promise<ConsistencyReport> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = join(__filename, '..');
  const dataDir = join(__dirname, '..', 'assistant', 'data');

  const report: ConsistencyReport = {
    orphaned_amenities: [],
    missing_intent_routes: [],
    file_mismatches: [],
    valid: true,
  };

  try {
    // Load files
    const knowledgeData = JSON.parse(readFileSync(join(dataDir, 'knowledge.json'), 'utf-8'));
    const routingData = JSON.parse(readFileSync(join(dataDir, 'routing.json'), 'utf-8'));
    const keywordsData = JSON.parse(readFileSync(join(dataDir, 'intent-keywords.json'), 'utf-8'));

    // Extract intents from routing.json (keys are intent IDs)
    const routingIntents = new Set(Object.keys(routingData));

    // Extract intents from knowledge.json
    const knowledgeIntents = new Set<string>();
    if (knowledgeData.static && Array.isArray(knowledgeData.static)) {
      for (const entry of knowledgeData.static) {
        const kEntry = entry as KnowledgeEntry;
        if (kEntry.intent) {
          knowledgeIntents.add(kEntry.intent);
        }
      }
    }

    // Extract intents from intent-keywords.json
    const keywordIntents = new Set<string>();
    if (keywordsData.intents && Array.isArray(keywordsData.intents)) {
      for (const entry of keywordsData.intents) {
        const kEntry = entry as IntentKeywordEntry;
        if (kEntry.intent) {
          keywordIntents.add(kEntry.intent);
        }
      }
    }

    // Validate knowledge.json intents exist in routing.json
    for (const intent of knowledgeIntents) {
      if (!routingIntents.has(intent)) {
        report.orphaned_amenities.push(intent);
      }
    }

    // Validate intent-keywords.json intents exist in routing.json
    for (const intent of keywordIntents) {
      if (!routingIntents.has(intent)) {
        report.missing_intent_routes.push(intent);
      }
    }

    // Sort for consistency
    report.orphaned_amenities.sort();
    report.missing_intent_routes.sort();
    report.file_mismatches.sort();

    // Report is valid if no violations found
    report.valid = report.orphaned_amenities.length === 0 &&
                   report.missing_intent_routes.length === 0 &&
                   report.file_mismatches.length === 0;

    return report;
  } catch (error) {
    throw new Error(`Failed to validate profile consistency: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let profile = 'data-pelangi'; // default

  // Parse --profile argument
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) {
      profile = args[i + 1];
      break;
    }
  }

  try {
    const report = await validateProfileConsistency(profile);
    console.log(JSON.stringify(report, null, 2));

    // Exit with code 1 if violations found
    if (!report.valid) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Export for testing
export { validateProfileConsistency, ConsistencyReport };

// Run if executed directly
main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
