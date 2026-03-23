/**
 * US-044: Profile Data Schema Validator
 *
 * Checks each profile's data files for cross-profile contamination.
 * A contamination occurs when a profile's data file contains terms that
 * exclusively belong to a different business profile.
 *
 * Profiles:
 *   - pelangi       → Pelangi Capsule Hostel (src/assistant/data/)
 *   - southern      → Southern Homestay      (src/assistant/data-southern/)
 *   - makan-moments → Makan Moments Cafe     (src/assistant/data-makan/)
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

export interface ContaminationMatch {
  profileId: string;
  filePath: string;
  lineNumber: number;
  term: string;
  sourceProfile: string;
}

export interface ProfileValidationResult {
  profileId: string;
  dataDir: string;
  isClean: boolean;
  matches: ContaminationMatch[];
}

export interface ValidationReport {
  isClean: boolean;
  profiles: ProfileValidationResult[];
}

/** Terms that exclusively identify a business type — should NOT appear in the other type */
export const EXCLUSIVE_TERM_GROUPS: Record<string, { label: string; terms: string[] }> = {
  hostel: {
    label: 'Hostel (Pelangi/Southern)',
    terms: [
      'capsule_conflict',
      'lower_deck_preference',
      'card_locked',
      'check_in_arrival',
      'facility_orientation',
      'late_checkout_request',
      'luggage_storage',
      'theft_report',
      'EXTRA_TOWEL',
      'EXTRA_PILLOW',
    ],
  },
  cafe: {
    label: 'Cafe (Makan Moments)',
    terms: [
      'ORDER_BROWSE',
      'ORDER_ITEM_ADD',
      'ORDER_CONFIRM',
      'ORDER_DECLINE',
      'ORDER_CANCEL',
      'ORDER_STATUS',
      'MENU_FILTER_PRICE',
      'MENU_SPECIALS',
      'MENU_RECOMMEND',
      'allergen_query',
      'vegetarian_query',
      'table_reservation',
      'menu_query',
      'menu_browse_category',
      'order_placement',
      'order_feedback_rating',
      'menu_item_detail',
    ],
  },
};

/** Profile configuration: data directory and which term groups are forbidden */
export const PROFILE_CONFIGS: Record<
  string,
  { label: string; dataDir: string; forbiddenGroups: string[] }
> = {
  pelangi: {
    label: 'Pelangi Capsule Hostel',
    dataDir: 'src/assistant/data',
    forbiddenGroups: [], // Pelangi has integrated food ordering — no forbidden groups
  },
  southern: {
    label: 'Southern Homestay',
    dataDir: 'src/assistant/data-southern',
    forbiddenGroups: ['cafe'],
  },
  'makan-moments': {
    label: 'Makan Moments Cafe',
    dataDir: 'src/assistant/data-makan',
    forbiddenGroups: ['hostel'],
  },
};

/** JSON files within each data directory to scan */
const TARGET_FILES = ['routing.json', 'knowledge.json', 'intent-keywords.json', 'workflows.json'];

/**
 * Scan a single file for forbidden terms.
 * Returns one match per line (first term found per line wins).
 */
export function scanFileForTerms(
  filePath: string,
  terms: string[],
  profileId: string,
  sourceProfile: string,
): ContaminationMatch[] {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const matches: ContaminationMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const term of terms) {
      if (line.includes(term)) {
        matches.push({
          profileId,
          filePath,
          lineNumber: i + 1,
          term,
          sourceProfile,
        });
        break; // one match per line to avoid duplicate reports
      }
    }
  }

  return matches;
}

/**
 * Validate a single profile's data directory for contamination.
 *
 * @param profileId - One of the keys in PROFILE_CONFIGS
 * @param rootDir   - Project root directory (default: process.cwd())
 */
export function validateProfile(
  profileId: string,
  rootDir: string = process.cwd(),
): ProfileValidationResult {
  const config = PROFILE_CONFIGS[profileId];
  if (!config) {
    throw new Error(`Unknown profileId: "${profileId}". Valid profiles: ${Object.keys(PROFILE_CONFIGS).join(', ')}`);
  }

  const matches: ContaminationMatch[] = [];
  const resolvedDataDir = join(rootDir, config.dataDir);

  for (const fileName of TARGET_FILES) {
    const filePath = join(resolvedDataDir, fileName);

    for (const group of config.forbiddenGroups) {
      const termGroup = EXCLUSIVE_TERM_GROUPS[group];
      if (!termGroup) continue;

      const fileMatches = scanFileForTerms(filePath, termGroup.terms, profileId, termGroup.label);
      matches.push(...fileMatches);
    }
  }

  return {
    profileId,
    dataDir: resolvedDataDir,
    isClean: matches.length === 0,
    matches,
  };
}

/**
 * Validate all known profiles and return a combined report.
 *
 * @param rootDir - Project root directory (default: process.cwd())
 */
export function validateAllProfiles(rootDir: string = process.cwd()): ValidationReport {
  const profileIds = Object.keys(PROFILE_CONFIGS);
  const profiles = profileIds.map((id) => validateProfile(id, rootDir));

  return {
    isClean: profiles.every((p) => p.isClean),
    profiles,
  };
}

/**
 * Format a validation report as a human-readable string.
 */
export function formatReport(report: ValidationReport): string {
  const lines: string[] = ['=== Profile Data Contamination Report ===', ''];

  for (const profile of report.profiles) {
    const status = profile.isClean ? '✓ CLEAN' : '✗ CONTAMINATED';
    lines.push(`Profile: ${profile.profileId} — ${status}`);

    if (!profile.isClean) {
      for (const match of profile.matches) {
        lines.push(`  ${match.filePath}:${match.lineNumber}`);
        lines.push(`  Term: "${match.term}" (belongs to: ${match.sourceProfile})`);
      }
    }
  }

  const totalMatches = report.profiles.reduce((sum, p) => sum + p.matches.length, 0);
  lines.push('');
  lines.push(`=== Summary: ${totalMatches} contamination match(es) — ${report.isClean ? 'CLEAN' : 'CONTAMINATED'} ===`);

  return lines.join('\n');
}

/**
 * US-114: Profile Data Schema Version Compatibility Enforcement
 *
 * Custom error thrown when profile data files have mismatched schema versions.
 */
export class ProfileVersionMismatchError extends Error {
  constructor(
    public profileId: string,
    public fileVersions: Record<string, string | undefined>,
  ) {
    const versionEntries = Object.entries(fileVersions)
      .map(([file, version]) => `${file}: ${version || 'undefined'}`)
      .join('\n  ');

    super(
      `Profile "${profileId}" has mismatched schema versions:\n  ${versionEntries}\n` +
        `All data files must have the same schema_version`,
    );
    this.name = 'ProfileVersionMismatchError';
  }
}

/**
 * US-114: Enforce schema version compatibility across all data files for a profile.
 *
 * Loads all JSON files from the profile's data directory, extracts the schema_version
 * field from each, and ensures they all match. Throws ProfileVersionMismatchError if
 * versions differ.
 *
 * @param profileName - Profile ID (pelangi, southern, makan-moments)
 * @param rootDir - Project root directory (default: process.cwd())
 * @throws ProfileVersionMismatchError if versions mismatch or files are missing/invalid
 */
export function enforceProfileDataVersionCompatibility(
  profileName: string,
  rootDir: string = process.cwd(),
): void {
  const config = PROFILE_CONFIGS[profileName];
  if (!config) {
    throw new Error(
      `Unknown profile: "${profileName}". Valid profiles: ${Object.keys(PROFILE_CONFIGS).join(', ')}`,
    );
  }

  const dataDir = join(rootDir, config.dataDir);

  // Ensure directory exists
  if (!existsSync(dataDir)) {
    throw new Error(`Data directory not found for profile "${profileName}": ${dataDir}`);
  }

  // Read all JSON files from the data directory
  const jsonFiles: string[] = [];
  const dirEntries = readdirSync(dataDir, { withFileTypes: true });
  for (const entry of dirEntries) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      jsonFiles.push(entry.name);
    }
  }

  if (jsonFiles.length === 0) {
    throw new Error(`No JSON files found in profile data directory: ${dataDir}`);
  }

  // Extract schema versions from each file
  const fileVersions: Record<string, string | undefined> = {};
  let firstVersion: string | undefined;
  const mismatchedFiles: string[] = [];

  for (const fileName of jsonFiles) {
    const filePath = join(dataDir, fileName);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const json = JSON.parse(content);
      const version = json.schema_version as string | undefined;

      fileVersions[fileName] = version;

      // Track first version and detect mismatches
      if (firstVersion === undefined) {
        firstVersion = version;
      } else if (version !== firstVersion) {
        mismatchedFiles.push(fileName);
      }
    } catch (err) {
      throw new Error(
        `Failed to parse schema_version from ${fileName} in profile "${profileName}": ${(err as any).message}`,
      );
    }
  }

  // Throw error if any mismatches detected
  if (mismatchedFiles.length > 0) {
    throw new ProfileVersionMismatchError(profileName, fileVersions);
  }
}
