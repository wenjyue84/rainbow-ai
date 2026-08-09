#!/usr/bin/env tsx
/**
 * US-363: Profile-Specific Intent Whitelist Validator CLI
 *
 * Validates that each profile's routing.json only contains intents owned by
 * that profile. Prevents cross-profile contamination (e.g., pelangi hostel
 * intents appearing in makan cafe routing).
 *
 * Usage:
 *   npm run validate:profile-intents
 *   npx tsx src/tools/validate-profile-intents-cli.ts
 *   npx tsx src/tools/validate-profile-intents-cli.ts --profile makan
 *   npx tsx src/tools/validate-profile-intents-cli.ts --json
 *
 * Exit codes:
 *   0 — All profiles pass (no violations)
 *   1 — One or more violations found
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileWhitelist {
  schema_version: string;
  description: string;
  shared_intents: string[];
  profiles: {
    [profile: string]: {
      description: string;
      owned_intents: string[];
    };
  };
}

export interface Violation {
  profile: string;
  routingFile: string;
  intent: string;
  lineNumber: number;
  contaminatingProfile: string | null;
  message: string;
}

export interface ValidationResult {
  profile: string;
  routingFile: string;
  violations: Violation[];
  checked: number;
}

// ---------------------------------------------------------------------------
// Core logic (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Load and parse the profile-intent whitelist JSON file.
 */
export function loadWhitelist(whitelistPath?: string): ProfileWhitelist {
  const resolved =
    whitelistPath ?? path.join(rootDir, 'src', 'data', 'profile-intent-whitelist.json');
  const content = fs.readFileSync(resolved, 'utf-8');
  return JSON.parse(content) as ProfileWhitelist;
}

/**
 * Find the approximate line number of an intent key in a JSON string.
 * Searches for `"<intent>"` as a JSON key pattern.
 */
export function findIntentLineNumber(jsonText: string, intent: string): number {
  const lines = jsonText.split('\n');
  // Match the intent as a JSON key: "intent": or "intent" :
  const pattern = new RegExp(`^\\s*"${escapeRegex(intent)}"\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i + 1; // 1-based line number
    }
  }
  return -1;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Determine which profile "owns" an intent (i.e., it's in their owned_intents).
 * Returns null if the intent is shared or not found in any profile.
 */
export function findOwningProfile(
  intent: string,
  whitelist: ProfileWhitelist,
): string | null {
  for (const [profile, data] of Object.entries(whitelist.profiles)) {
    if (data.owned_intents.includes(intent)) {
      return profile;
    }
  }
  return null;
}

/**
 * Validate a single routing.json content against the whitelist for a given profile.
 * Returns an array of violations.
 */
export function validateRoutingContent(
  profile: string,
  routingFile: string,
  routingText: string,
  whitelist: ProfileWhitelist,
): Violation[] {
  const routing = JSON.parse(routingText) as Record<string, unknown>;
  const profileData = whitelist.profiles[profile];

  if (!profileData) {
    throw new Error(`No whitelist entry found for profile '${profile}'`);
  }

  const allowedSet = new Set([
    ...whitelist.shared_intents,
    ...profileData.owned_intents,
  ]);

  const violations: Violation[] = [];

  for (const intent of Object.keys(routing)) {
    // Skip the schema_version meta key
    if (intent === 'schema_version') continue;

    if (!allowedSet.has(intent)) {
      const lineNumber = findIntentLineNumber(routingText, intent);
      const contaminatingProfile = findOwningProfile(intent, whitelist);

      let message: string;
      if (contaminatingProfile) {
        message =
          `${routingFile}:${lineNumber} — intent '${intent}' belongs to profile ` +
          `'${contaminatingProfile}' but found in '${profile}' routing`;
      } else {
        message =
          `${routingFile}:${lineNumber} — intent '${intent}' is not in the whitelist ` +
          `for profile '${profile}'`;
      }

      violations.push({
        profile,
        routingFile,
        intent,
        lineNumber,
        contaminatingProfile,
        message,
      });
    }
  }

  return violations;
}

/**
 * Resolve the routing.json file path for a given profile.
 */
export function resolveRoutingPath(profile: string, assistantDir?: string): string {
  const baseDir = assistantDir ?? path.join(rootDir, 'src', 'assistant');

  const profileDirMap: Record<string, string> = {
    makan: 'data-makan',
    southern: 'data-southern',
    pelangi: 'data',
    pms_capsule: 'data-pms-capsule',
    pms_southern: 'data-pms-southern',
  };

  const dir = profileDirMap[profile] ?? profile;
  return path.join(baseDir, dir, 'routing.json');
}

/**
 * Validate all profiles defined in the whitelist.
 */
export function validateAllProfiles(
  whitelist: ProfileWhitelist,
  assistantDir?: string,
): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (const profile of Object.keys(whitelist.profiles)) {
    const routingPath = resolveRoutingPath(profile, assistantDir);

    if (!fs.existsSync(routingPath)) {
      // Skip profiles with no routing.json (not an error)
      continue;
    }

    const routingText = fs.readFileSync(routingPath, 'utf-8');
    const violations = validateRoutingContent(
      profile,
      routingPath,
      routingText,
      whitelist,
    );

    const routing = JSON.parse(routingText) as Record<string, unknown>;
    const checked = Object.keys(routing).filter(k => k !== 'schema_version').length;

    results.push({ profile, routingFile: routingPath, violations, checked });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function formatHumanReport(results: ValidationResult[]): string {
  const lines: string[] = [];
  let totalViolations = 0;
  let totalChecked = 0;

  lines.push('=== Profile Intent Whitelist Validator ===');
  lines.push('');

  for (const result of results) {
    totalChecked += result.checked;
    totalViolations += result.violations.length;

    const status = result.violations.length === 0 ? '✓ PASS' : '✗ FAIL';
    lines.push(`[${status}] Profile: ${result.profile} (${result.checked} intents checked)`);

    for (const v of result.violations) {
      lines.push(`       ${v.message}`);
    }
  }

  lines.push('');
  lines.push(`Total intents checked: ${totalChecked}`);
  lines.push(`Total violations: ${totalViolations}`);
  lines.push('');

  if (totalViolations > 0) {
    lines.push('RESULT: FAIL — cross-profile contamination detected');
  } else {
    lines.push('RESULT: PASS — all profiles are clean');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const singleProfile = args.includes('--profile')
    ? args[args.indexOf('--profile') + 1]
    : null;

  const whitelist = loadWhitelist();

  let results: ValidationResult[];

  if (singleProfile) {
    const routingPath = resolveRoutingPath(singleProfile);
    if (!fs.existsSync(routingPath)) {
      console.error(
        `ERROR: No routing.json found for profile '${singleProfile}' at ${routingPath}`,
      );
      process.exit(1);
    }
    const routingText = fs.readFileSync(routingPath, 'utf-8');
    const violations = validateRoutingContent(
      singleProfile,
      routingPath,
      routingText,
      whitelist,
    );
    const routing = JSON.parse(routingText) as Record<string, unknown>;
    const checked = Object.keys(routing).filter(k => k !== 'schema_version').length;
    results = [{ profile: singleProfile, routingFile: routingPath, violations, checked }];
  } else {
    results = validateAllProfiles(whitelist);
  }

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatHumanReport(results));
  }

  const totalViolations = results.reduce((sum, r) => sum + r.violations.length, 0);
  process.exit(totalViolations > 0 ? 1 : 0);
}

// Only run when executed directly (not imported by tests)
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url).replace(/\\/g, '/') ===
    process.argv[1].replace(/\\/g, '/');

if (isMain) {
  main();
}
