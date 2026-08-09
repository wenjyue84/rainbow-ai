/**
 * US-298: Profile Data File Integrity Validator with Startup Enforcement
 *
 * Generates SHA256 checksums for each profile's critical JSON data files
 * (routing.json, intent-keywords.json, knowledge.json, workflows.json).
 * At startup, compares live hashes against stored baseline in profile-hashes.json.
 * Blocks startup with detailed error (file name, expected hash, actual hash)
 * if any mismatch is detected.
 */

import { createHash } from 'crypto';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FileHash {
  file: string;
  sha256: string;
}

export interface ProfileHashes {
  profile: string;
  files: FileHash[];
}

export interface ProfileHashesFile {
  generatedAt: string;
  profiles: ProfileHashes[];
}

export interface HashMismatch {
  profile: string;
  file: string;
  expected: string;
  actual: string;
}

export interface IntegrityResult {
  valid: boolean;
  mismatches: HashMismatch[];
  missingFiles: Array<{ profile: string; file: string }>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Files to hash per profile */
const PROFILE_FILES = [
  'routing.json',
  'intent-keywords.json',
  'knowledge.json',
  'workflows.json',
] as const;

/** Maps profile name to its data directory (relative to src/assistant/) */
const PROFILE_DIRS: Record<string, string> = {
  pelangi: 'data',
  makan: 'data-makan',
  southern: 'data-southern',
};

/** Default filename for stored hashes */
const HASHES_FILENAME = 'profile-hashes.json';

// ─── Core logic ─────────────────────────────────────────────────────────────

/**
 * Compute SHA256 hash of a file's contents.
 */
export function computeFileHash(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8');
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Generate hashes for all profile data files.
 *
 * @param rootDir - Project root directory
 * @returns ProfileHashesFile with hashes for each profile's files
 */
export function generateProfileHashes(rootDir: string): ProfileHashesFile {
  const profiles: ProfileHashes[] = [];

  for (const [profileName, dataDir] of Object.entries(PROFILE_DIRS)) {
    const files: FileHash[] = [];

    for (const fileName of PROFILE_FILES) {
      const filePath = join(rootDir, 'src', 'assistant', dataDir, fileName);
      if (!existsSync(filePath)) continue;

      files.push({
        file: fileName,
        sha256: computeFileHash(filePath),
      });
    }

    if (files.length > 0) {
      profiles.push({ profile: profileName, files });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    profiles,
  };
}

/**
 * Write profile hashes to profile-hashes.json in the project root.
 *
 * @param rootDir - Project root directory
 * @param hashes - The hash data to persist
 */
export function writeProfileHashes(rootDir: string, hashes: ProfileHashesFile): void {
  const outputPath = join(rootDir, HASHES_FILENAME);
  writeFileSync(outputPath, JSON.stringify(hashes, null, 2) + '\n', 'utf-8');
}

/**
 * Validate live file hashes against stored baseline.
 *
 * @param rootDir - Project root directory
 * @returns IntegrityResult with validation outcome
 */
export function validateProfileIntegrity(rootDir: string): IntegrityResult {
  const hashesPath = join(rootDir, HASHES_FILENAME);

  if (!existsSync(hashesPath)) {
    return {
      valid: false,
      mismatches: [],
      missingFiles: [{ profile: 'system', file: HASHES_FILENAME }],
    };
  }

  const stored: ProfileHashesFile = JSON.parse(readFileSync(hashesPath, 'utf-8'));
  const mismatches: HashMismatch[] = [];
  const missingFiles: Array<{ profile: string; file: string }> = [];

  for (const profileEntry of stored.profiles) {
    const dataDir = PROFILE_DIRS[profileEntry.profile];
    if (!dataDir) continue;

    for (const fileEntry of profileEntry.files) {
      const filePath = join(rootDir, 'src', 'assistant', dataDir, fileEntry.file);

      if (!existsSync(filePath)) {
        missingFiles.push({ profile: profileEntry.profile, file: fileEntry.file });
        continue;
      }

      const actualHash = computeFileHash(filePath);
      if (actualHash !== fileEntry.sha256) {
        mismatches.push({
          profile: profileEntry.profile,
          file: fileEntry.file,
          expected: fileEntry.sha256,
          actual: actualHash,
        });
      }
    }
  }

  return {
    valid: mismatches.length === 0 && missingFiles.length === 0,
    mismatches,
    missingFiles,
  };
}

/**
 * Format integrity validation errors for logging.
 */
export function formatIntegrityErrors(result: IntegrityResult): string {
  const lines: string[] = [];

  if (result.mismatches.length > 0) {
    lines.push(`[STARTUP] Profile integrity check failed — ${result.mismatches.length} file(s) changed since last baseline:`);
    lines.push('');
    for (const m of result.mismatches) {
      lines.push(`  ${m.profile}/${m.file}:`);
      lines.push(`    expected: ${m.expected}`);
      lines.push(`    actual:   ${m.actual}`);
    }
  }

  if (result.missingFiles.length > 0) {
    lines.push('');
    lines.push(`[STARTUP] Missing files referenced in ${HASHES_FILENAME}:`);
    for (const f of result.missingFiles) {
      lines.push(`  ${f.profile}/${f.file}`);
    }
  }

  return lines.join('\n');
}

/**
 * Startup enforcement: validate profile data integrity and exit if
 * any hash mismatch is detected.
 *
 * Call this during server startup (in src/index.ts).
 *
 * @param rootDir - Project root directory
 * @throws Error with detailed mismatch info if validation fails
 */
export function enforceProfileIntegrity(rootDir: string): void {
  const hashesPath = join(rootDir, HASHES_FILENAME);

  // If no baseline exists yet, skip validation (first run / CI).
  if (!existsSync(hashesPath)) {
    return;
  }

  const result = validateProfileIntegrity(rootDir);

  if (!result.valid) {
    const report = formatIntegrityErrors(result);
    console.error(report);
    throw new Error(
      `Profile data integrity check failed: ${result.mismatches.length} hash mismatch(es), ` +
        `${result.missingFiles.length} missing file(s). ` +
        `Run 'npm run validate:profile-integrity' to regenerate baseline after intentional changes.`,
    );
  }
}
