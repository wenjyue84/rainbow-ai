#!/usr/bin/env tsx
/**
 * US-278: Remove Pelangi Hostel Keywords from Makan Moments Intent-Keywords File
 *
 * Scans src/assistant/data-makan/intent-keywords.json, identifies hostel-specific
 * keywords, removes them, validates the cleaned file against the Zod schema, and
 * checks all remaining intents resolve in routing.json.
 *
 * Usage:
 *   npm run clean:makan-keywords          # dry-run (default)
 *   npm run clean:makan-keywords -- --write   # write cleaned file
 *   npx tsx scripts/clean-makan-keywords.ts --write
 *
 * Exit codes:
 *   0 — Clean (or no hostel keywords found)
 *   1 — Hostel keywords found (dry-run) or validation failed
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { intentKeywordsDataSchema } from '../src/assistant/schemas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const TARGET_FILE = path.join(rootDir, 'src/assistant/data-makan/intent-keywords.json');
const ROUTING_FILE = path.join(rootDir, 'src/assistant/data-makan/routing.json');

// ---------------------------------------------------------------------------
// Hostel-specific keyword blocklist
// These terms are characteristic of hostel/hotel accommodation —
// they must not appear in a cafe-only profile.
// ---------------------------------------------------------------------------

const HOSTEL_KEYWORD_BLOCKLIST: string[] = [
  // Check-in / check-out
  'checkin',
  'checkout',
  'check-in',
  'check-out',
  'check in',
  'check out',
  // Room / accommodation
  'room',
  'rooms',
  'capsule',
  'dormitory',
  'dormitories',
  'nightly rate',
  'per night',
  'satu malam',          // "one night" in Malay
  'berapa harga satu malam', // "how much per night"
  '一晚',                 // "one night" in Chinese
  // Hostel amenities vocabulary
  'amenities',
  'ameniti',
  // Hostel house-rules vocabulary
  'house rules',
  'peraturan rumah',     // "house rules" in Malay
  'quiet hours',
  'jam senyap',          // "quiet hours" in Malay
  'boleh merokok',       // "allowed to smoke" in Malay
  'smoking allowed',
  'boleh bawa haiwan',   // "can bring pets" in Malay
  'are pets allowed',
  '安静时间',             // "quiet hours" in Chinese
  '房屋规则',             // "house rules" in Chinese
  '可以带宠物吗',          // "can bring pets" in Chinese
  '可以吸烟吗',            // "can smoke" in Chinese
  // Overnight-stay review language
  'menginap yang bagus', // "great overnight stay" in Malay
  // Laundry (traveler service, not cafe)
  'laundry nearby',
  'dobi berdekatan',     // "laundry nearby" in Malay
  'laundry',
  // Airport navigation (hostel guests arrive from airports; cafe customers don't)
  'airport',
  'lapangan terbang',    // "airport" in Malay
  '机场',                // "airport" in Chinese
  'senai',               // Senai Airport — local hostel context
];

// Cafe-safe keywords that might superficially match hostel terms
// but are legitimate for a cafe context.
const CAFE_SAFE_EXCEPTIONS: string[] = [
  'room temperature', // valid cafe context
  'dining room',      // valid cafe context
];

interface CleanResult {
  intent: string;
  lang: string;
  removed: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isHostelKeyword(kw: string): boolean {
  const lower = kw.toLowerCase().trim();

  // Check cafe-safe exceptions first
  for (const safe of CAFE_SAFE_EXCEPTIONS) {
    if (lower === safe.toLowerCase()) return false;
  }

  // Check blocklist — substring match (case-insensitive)
  for (const blocked of HOSTEL_KEYWORD_BLOCKLIST) {
    if (lower.includes(blocked.toLowerCase())) return true;
  }

  return false;
}

function loadRoutingIntents(): Set<string> | null {
  if (!fs.existsSync(ROUTING_FILE)) {
    console.warn(`[clean-makan-keywords] WARNING: routing.json not found at ${ROUTING_FILE}`);
    return null;
  }
  const routing = JSON.parse(fs.readFileSync(ROUTING_FILE, 'utf-8')) as Record<string, unknown>;
  return new Set(Object.keys(routing));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run(writeMode: boolean): void {
  if (!fs.existsSync(TARGET_FILE)) {
    console.error(`[clean-makan-keywords] ERROR: File not found: ${TARGET_FILE}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(TARGET_FILE, 'utf-8');
  let data: ReturnType<typeof intentKeywordsDataSchema.parse>;

  try {
    data = intentKeywordsDataSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.error('[clean-makan-keywords] ERROR: Invalid JSON or schema mismatch:', err);
    process.exit(1);
  }

  const routingIntents = loadRoutingIntents();

  const removedKeywords: CleanResult[] = [];
  let totalRemovedKeywords = 0;
  const orphanIntents: string[] = [];

  // Build cleaned intents — remove hostel keywords per entry
  const keywordCleanedIntents = data.intents.map((entry) => {
    const cleanedKeywords: Record<string, string[]> = {};

    for (const [lang, keywords] of Object.entries(entry.keywords)) {
      const kept: string[] = [];
      const removedFromLang: string[] = [];

      for (const kw of keywords) {
        if (isHostelKeyword(kw)) {
          removedFromLang.push(kw);
          totalRemovedKeywords++;
        } else {
          kept.push(kw);
        }
      }

      if (removedFromLang.length > 0) {
        removedKeywords.push({ intent: entry.intent, lang, removed: removedFromLang });
      }

      cleanedKeywords[lang] = kept;
    }

    return { ...entry, keywords: cleanedKeywords };
  });

  // Identify orphan intents (not in routing.json)
  if (routingIntents) {
    for (const entry of keywordCleanedIntents) {
      if (!routingIntents.has(entry.intent)) {
        orphanIntents.push(entry.intent);
      }
    }
  }

  const hasChanges = totalRemovedKeywords > 0 || orphanIntents.length > 0;

  // Report findings
  console.log('=== Makan Moments — Hostel Keyword Contamination Report ===');
  console.log(`File: ${path.relative(rootDir, TARGET_FILE)}`);
  console.log(`Intents scanned: ${data.intents.length}`);
  console.log('');

  if (!hasChanges) {
    console.log('✓ No hostel keywords found. File is clean.');
    process.exit(0);
  }

  if (totalRemovedKeywords > 0) {
    console.log(`✗ Found ${totalRemovedKeywords} hostel keyword(s) to remove:\n`);
    for (const r of removedKeywords) {
      console.log(`  Intent: ${r.intent}  [${r.lang}]`);
      for (const kw of r.removed) {
        console.log(`    - "${kw}"`);
      }
    }
    console.log('');
    console.log(`Total removed: ${totalRemovedKeywords} keyword(s) across ${removedKeywords.length} intent/lang pair(s)`);

    if (totalRemovedKeywords < 8) {
      console.warn(`[WARNING] AC requires 8+ hostel keywords to be identified; found ${totalRemovedKeywords}`);
    }
  }

  if (orphanIntents.length > 0) {
    console.log('');
    console.log(`✗ Found ${orphanIntents.length} intent(s) with no entry in routing.json (will be removed):`);
    for (const intent of orphanIntents) {
      console.log(`    - "${intent}"`);
    }
  }

  if (!writeMode) {
    console.log('\n[DRY RUN] Use --write flag to apply changes.');
    process.exit(1);
  }

  // Remove orphan intents from cleaned list
  const finalIntents = keywordCleanedIntents.filter(
    (entry) => !orphanIntents.includes(entry.intent)
  );

  // Validate cleaned data with Zod schema
  const cleanedData = { intents: finalIntents };
  const validation = intentKeywordsDataSchema.safeParse(cleanedData);
  if (!validation.success) {
    console.error('\n[clean-makan-keywords] ERROR: Cleaned data fails Zod schema validation:');
    console.error(validation.error.format());
    process.exit(1);
  }

  // Validate all remaining intents resolve in routing.json
  if (routingIntents) {
    const unresolved = finalIntents
      .map((e) => e.intent)
      .filter((intent) => !routingIntents.has(intent));

    if (unresolved.length > 0) {
      console.error('\n[clean-makan-keywords] ERROR: These intents still do not resolve in routing.json:');
      for (const intent of unresolved) {
        console.error(`    - "${intent}"`);
      }
      process.exit(1);
    }
  }

  // Write cleaned file
  fs.writeFileSync(TARGET_FILE, JSON.stringify(cleanedData, null, 2) + '\n', 'utf-8');

  console.log(`\n✓ Cleaned file written to: ${path.relative(rootDir, TARGET_FILE)}`);
  console.log('✓ Zod schema validation passed.');
  if (routingIntents) {
    console.log(`✓ All ${finalIntents.length} remaining intents resolve in routing.json.`);
  }
  process.exit(0);
}

const writeMode = process.argv.includes('--write');
run(writeMode);
