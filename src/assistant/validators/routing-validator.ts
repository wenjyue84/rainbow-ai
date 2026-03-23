/**
 * Routing validator: ensures routing.json routes reference only intents from same profile.
 * Prevents cross-contamination by validating that each route key in routing.json
 * exists in the profile's allowed intents list.
 *
 * Usage:
 *   const violations = validateRoutingForProfile('makan');
 *   if (violations.length > 0) { console.log(violations); }
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');

interface RoutingEntry {
  action: string;
  [key: string]: unknown;
}

type RoutingMap = Record<string, RoutingEntry>;
type IntentWhitelist = Record<string, string[]>;

/**
 * Loads routing.json from data directory
 */
function loadRouting(): RoutingMap {
  const routingPath = path.join(PROJECT_ROOT, 'src/assistant/data/routing.json');
  const content = fs.readFileSync(routingPath, 'utf-8');
  return JSON.parse(content) as RoutingMap;
}

/**
 * Loads intent-whitelists.json from data directory
 */
function loadIntentWhitelists(): IntentWhitelist {
  const whitelistPath = path.join(PROJECT_ROOT, 'src/assistant/data/intent-whitelists.json');
  const content = fs.readFileSync(whitelistPath, 'utf-8');
  return JSON.parse(content) as IntentWhitelist;
}

/**
 * Validates that all route keys in routing.json exist in the profile's intent whitelist.
 *
 * @param profileName - Profile to validate (e.g., 'makan', 'southern', 'pms_capsule')
 * @returns Array of violations in format "route 'intent_key' not in profile whitelist"
 */
export function validateRoutingForProfile(profileName: string): string[] {
  const routing = loadRouting();
  const whitelists = loadIntentWhitelists();

  const allowedIntents = whitelists[profileName];
  if (!allowedIntents) {
    return [`Profile '${profileName}' not found in intent-whitelists.json`];
  }

  const allowedSet = new Set(allowedIntents);
  const violations: string[] = [];

  for (const routeKey of Object.keys(routing)) {
    if (!allowedSet.has(routeKey)) {
      violations.push(
        `route '${routeKey}' references intent not in profile '${profileName}' whitelist`
      );
    }
  }

  return violations;
}

/**
 * Validates routing for all profiles.
 *
 * @returns Map of profile name to violations array
 */
export function validateRoutingForAllProfiles(): Map<string, string[]> {
  const routing = loadRouting();
  const whitelists = loadIntentWhitelists();
  const violations = new Map<string, string[]>();

  for (const [profileName, allowedIntents] of Object.entries(whitelists)) {
    const allowedSet = new Set(allowedIntents);
    const profileViolations: string[] = [];

    for (const routeKey of Object.keys(routing)) {
      if (!allowedSet.has(routeKey)) {
        profileViolations.push(
          `route '${routeKey}' references intent not in profile whitelist`
        );
      }
    }

    violations.set(profileName, profileViolations);
  }

  return violations;
}

/**
 * Gets summary text of all violations across profiles.
 */
export function getViolationsSummary(violations: Map<string, string[]>): string {
  const lines: string[] = [];

  let totalViolations = 0;
  for (const [profileName, profileViolations] of violations) {
    if (profileViolations.length > 0) {
      totalViolations += profileViolations.length;
      lines.push(`\n[${profileName}]`);
      profileViolations.forEach(v => lines.push(`  ${v}`));
    }
  }

  if (totalViolations === 0) {
    return 'All profiles: ✓ routing is consistent';
  }

  return `Found ${totalViolations} routing violation(s) across profiles:\n${lines.join('\n')}`;
}

/**
 * Validates routing consistency and exits if violations found.
 * Used at startup to catch contamination early.
 *
 * @param profileName - Profile to validate at startup
 * @throws Error with descriptive message if violations found
 */
export function validateRoutingAtStartup(profileName: string): void {
  const violations = validateRoutingForProfile(profileName);

  if (violations.length > 0) {
    throw new Error(
      `[Startup] Routing contamination detected in profile "${profileName}": ` +
      `${violations.length} route(s) reference intents not in profile whitelist. ` +
      `Routes: ${violations.map(v => v.split("'")[1]).join(', ')}`
    );
  }
}
