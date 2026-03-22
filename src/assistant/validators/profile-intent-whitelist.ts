/**
 * Profile-specific intent whitelist validator.
 * Ensures each profile only contains intents from its curated whitelist.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface IntentWhitelists {
  [profile: string]: string[];
}

interface RoutingConfig {
  [intentId: string]: Record<string, unknown>;
}

/**
 * Load intent whitelists from the JSON file
 */
function loadWhitelists(): IntentWhitelists {
  const whitelistPath = path.join(__dirname, '../data/intent-whitelists.json');
  const content = fs.readFileSync(whitelistPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Load routing config for a profile
 */
function loadRoutingConfig(profile: string): RoutingConfig {
  // Map profile names to data directories
  const profileDirMap: Record<string, string> = {
    makan: 'data-makan',
    southern: 'data-southern',
    pms_capsule: 'data-pms-capsule',
    pms_southern: 'data-pms-southern'
  };

  const dirName = profileDirMap[profile] || profile;
  const routingPath = path.join(__dirname, `../${dirName}/routing.json`);

  if (!fs.existsSync(routingPath)) {
    throw new Error(`Routing config not found for profile '${profile}' at ${routingPath}`);
  }

  const content = fs.readFileSync(routingPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Validate a profile's intents against its whitelist
 * @returns Array of violations or empty if valid
 */
export function validateProfileIntents(profile: string): string[] {
  const whitelists = loadWhitelists();
  const whitelist = whitelists[profile];

  if (!whitelist) {
    throw new Error(`No whitelist found for profile '${profile}'`);
  }

  const routing = loadRoutingConfig(profile);
  const violations: string[] = [];

  const whitelistSet = new Set(whitelist);

  for (const intentId of Object.keys(routing)) {
    if (!whitelistSet.has(intentId)) {
      violations.push(`Profile '${profile}' contains non-whitelisted intent '${intentId}'`);
    }
  }

  return violations;
}

/**
 * Validate all profiles
 * @returns Map of profile -> violations array
 */
export function validateAllProfiles(): Map<string, string[]> {
  const whitelists = loadWhitelists();
  const results = new Map<string, string[]>();

  for (const profile of Object.keys(whitelists)) {
    const violations = validateProfileIntents(profile);
    results.set(profile, violations);
  }

  return results;
}

/**
 * Remove violating intents from a profile's routing config
 * This modifies the routing.json file
 */
export function fixProfileIntents(profile: string): { removed: string[]; message: string } {
  const whitelists = loadWhitelists();
  const whitelist = whitelists[profile];

  if (!whitelist) {
    throw new Error(`No whitelist found for profile '${profile}'`);
  }

  const routing = loadRoutingConfig(profile);
  const whitelistSet = new Set(whitelist);
  const removed: string[] = [];

  // Filter out non-whitelisted intents
  for (const intentId of Object.keys(routing)) {
    if (!whitelistSet.has(intentId)) {
      removed.push(intentId);
      delete routing[intentId];
    }
  }

  // Write back if any changes were made
  if (removed.length > 0) {
    const profileDirMap: Record<string, string> = {
      makan: 'data-makan',
      southern: 'data-southern',
      pms_capsule: 'data-pms-capsule',
      pms_southern: 'data-pms-southern'
    };

    const dirName = profileDirMap[profile] || profile;
    const routingPath = path.join(__dirname, `../${dirName}/routing.json`);

    fs.writeFileSync(routingPath, JSON.stringify(routing, null, 2) + '\n');
  }

  return {
    removed,
    message: removed.length > 0
      ? `Removed ${removed.length} non-whitelisted intents from profile '${profile}': ${removed.join(', ')}`
      : `No violations found in profile '${profile}'`
  };
}

/**
 * Get violations summary as formatted text
 */
export function getViolationsSummary(violations: Map<string, string[]>): string {
  let summary = '';
  let totalViolations = 0;

  for (const [profile, profileViolations] of violations) {
    if (profileViolations.length > 0) {
      summary += `\n${profile}:\n`;
      profileViolations.forEach(v => {
        summary += `  - ${v}\n`;
      });
      totalViolations += profileViolations.length;
    }
  }

  if (totalViolations === 0) {
    return 'All profiles are valid!';
  }

  return `Found ${totalViolations} violation(s):\n${summary}`;
}
