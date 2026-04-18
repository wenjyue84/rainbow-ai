/**
 * Normalize top-level `schema_version` across profile data JSON files to "1.0.0".
 *
 * Rules:
 *  - Skip array-shaped JSON files (they carry no metadata).
 *  - Skip files where `schema_version` is already an OBJECT — those have
 *    their own structured version schema (templates.json, etc.) enforced
 *    at app level; the startup validator tolerates them via
 *    `src/lib/profile-validator.ts` (undefined-or-object = skip).
 *  - For files with schema_version as a string or missing — set to "1.0.0".
 *    BUT do not add the field to files that never had it AND whose
 *    app-level Zod schema defines schema_version as a structured object
 *    (templates.json is the known case).
 *
 * Idempotent.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const DATA_DIRS = [
  'src/assistant/data',
  'src/assistant/data-southern',
  'src/assistant/data-makan',
];

const TARGET_VERSION = '1.0.0';

// Files whose app-level Zod schema treats schema_version as a
// structured OBJECT, not a string. Never write a string version
// to these — leave them alone so the object-shape check is clean.
const STRUCTURED_VERSION_FILES = new Set(['templates.json']);

let totalFiles = 0;
let changed = 0;
let alreadyCorrect = 0;
let skipped = 0;

for (const relDir of DATA_DIRS) {
  const dir = join(root, relDir);
  const entries = readdirSync(dir, { withFileTypes: true });
  const jsonFiles = entries.filter(e => e.isFile() && e.name.endsWith('.json'));

  console.log(`\n[${relDir}] ${jsonFiles.length} json files`);

  for (const entry of jsonFiles) {
    const filePath = join(dir, entry.name);
    totalFiles++;
    const raw = readFileSync(filePath, 'utf-8');
    let json;
    try { json = JSON.parse(raw); }
    catch (e) {
      console.error(`  [SKIP] ${entry.name} — invalid JSON: ${e.message}`);
      skipped++;
      continue;
    }
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      skipped++;
      continue;
    }
    if (STRUCTURED_VERSION_FILES.has(entry.name)) {
      skipped++;
      continue;
    }
    // If schema_version is already an object, leave it alone — another
    // validator governs its shape.
    if (json.schema_version !== undefined && typeof json.schema_version === 'object') {
      skipped++;
      continue;
    }
    const existing = json.schema_version;
    if (existing === TARGET_VERSION) {
      alreadyCorrect++;
      continue;
    }

    // Reconstruct with schema_version first for readability
    const normalized = { schema_version: TARGET_VERSION };
    for (const [k, v] of Object.entries(json)) {
      if (k === 'schema_version') continue;
      normalized[k] = v;
    }

    const trailingNewline = raw.endsWith('\n') ? '\n' : '';
    writeFileSync(filePath, JSON.stringify(normalized, null, 2) + trailingNewline, 'utf-8');
    changed++;
    console.log(`  [FIX]  ${entry.name} (was ${existing === undefined ? 'undefined' : JSON.stringify(existing)})`);
  }
}

console.log(`\nDone. ${totalFiles} scanned, ${changed} changed, ${alreadyCorrect} already correct, ${skipped} skipped.`);
