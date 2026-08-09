/**
 * US-298: Profile Data File Integrity Validator Tests
 *
 * Verifies that:
 * 1. SHA256 hashes are correctly generated for profile data files
 * 2. Validator detects file modifications (e.g., contaminated keyword added)
 * 3. Startup enforcement blocks with actionable error on hash mismatch
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  computeFileHash,
  generateProfileHashes,
  writeProfileHashes,
  validateProfileIntegrity,
  enforceProfileIntegrity,
  formatIntegrityErrors,
} from '../lib/profile-integrity.js';

// ─── Test fixtures ──────────────────────────────────────────────────────────

function createTestProfile(rootDir: string, dataDir: string, files: Record<string, object>): void {
  const dirPath = join(rootDir, 'src', 'assistant', dataDir);
  mkdirSync(dirPath, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dirPath, name), JSON.stringify(content, null, 2), 'utf-8');
  }
}

const SAMPLE_ROUTING = { schema_version: '1.0', greeting: { action: 'reply', template: 'hi' } };
const SAMPLE_KEYWORDS = { intents: [{ intent: 'booking', keywords: { en: ['book', 'reserve'] } }] };
const SAMPLE_KNOWLEDGE = { entries: [{ q: 'wifi?', a: 'password is abc123' }] };
const SAMPLE_WORKFLOWS = { workflows: [{ id: 'check_in', steps: ['greet', 'collect_id'] }] };

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('US-298: Profile Data File Integrity Validator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'profile-integrity-'));
    // Create pelangi profile (uses "data" dir)
    createTestProfile(tempDir, 'data', {
      'routing.json': SAMPLE_ROUTING,
      'intent-keywords.json': SAMPLE_KEYWORDS,
      'knowledge.json': SAMPLE_KNOWLEDGE,
      'workflows.json': SAMPLE_WORKFLOWS,
    });
    // Create makan profile
    createTestProfile(tempDir, 'data-makan', {
      'routing.json': { schema_version: '1.0', menu: { action: 'show_menu' } },
      'intent-keywords.json': { intents: [{ intent: 'menu', keywords: { en: ['menu', 'food'] } }] },
      'knowledge.json': { entries: [{ q: 'hours?', a: '8am-10pm' }] },
      'workflows.json': { workflows: [{ id: 'order', steps: ['choose', 'pay'] }] },
    });
    // Create southern profile
    createTestProfile(tempDir, 'data-southern', {
      'routing.json': { schema_version: '1.0', checkin: { action: 'workflow' } },
      'intent-keywords.json': { intents: [{ intent: 'checkin', keywords: { en: ['check in'] } }] },
      'knowledge.json': { entries: [{ q: 'address?', a: '123 Southern St' }] },
      'workflows.json': { workflows: [{ id: 'southern_checkin', steps: ['verify'] }] },
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates SHA256 hashes for all profile data files', () => {
    const hashes = generateProfileHashes(tempDir);

    expect(hashes.generatedAt).toBeTruthy();
    expect(hashes.profiles).toHaveLength(3);

    const pelangi = hashes.profiles.find((p) => p.profile === 'pelangi');
    expect(pelangi).toBeDefined();
    expect(pelangi!.files).toHaveLength(4);

    // Each file hash should be a 64-char hex string (SHA256)
    for (const profile of hashes.profiles) {
      for (const file of profile.files) {
        expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  it('detects modification when a contaminated keyword is added to intent-keywords.json', () => {
    // Step 1: Generate baseline hashes
    const hashes = generateProfileHashes(tempDir);
    writeProfileHashes(tempDir, hashes);

    // Step 2: Contaminate pelangi's intent-keywords.json (add a makan keyword)
    const contaminatedKeywords = {
      intents: [
        { intent: 'booking', keywords: { en: ['book', 'reserve'] } },
        { intent: 'menu', keywords: { en: ['nasi lemak', 'roti canai'] } }, // contaminated!
      ],
    };
    writeFileSync(
      join(tempDir, 'src', 'assistant', 'data', 'intent-keywords.json'),
      JSON.stringify(contaminatedKeywords, null, 2),
      'utf-8',
    );

    // Step 3: Validate — should detect the change
    const result = validateProfileIntegrity(tempDir);

    expect(result.valid).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].profile).toBe('pelangi');
    expect(result.mismatches[0].file).toBe('intent-keywords.json');
    expect(result.mismatches[0].expected).not.toBe(result.mismatches[0].actual);
  });

  it('enforceProfileIntegrity throws with actionable error on mismatch', () => {
    // Generate baseline
    const hashes = generateProfileHashes(tempDir);
    writeProfileHashes(tempDir, hashes);

    // Modify a file
    writeFileSync(
      join(tempDir, 'src', 'assistant', 'data', 'routing.json'),
      JSON.stringify({ schema_version: '2.0', tampered: true }),
      'utf-8',
    );

    // Should throw with descriptive error
    expect(() => enforceProfileIntegrity(tempDir)).toThrow(/Profile data integrity check failed/);
    expect(() => enforceProfileIntegrity(tempDir)).toThrow(/hash mismatch/);
    expect(() => enforceProfileIntegrity(tempDir)).toThrow(/validate:profile-integrity/);
  });

  it('passes validation when files match stored hashes', () => {
    const hashes = generateProfileHashes(tempDir);
    writeProfileHashes(tempDir, hashes);

    const result = validateProfileIntegrity(tempDir);

    expect(result.valid).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    expect(result.missingFiles).toHaveLength(0);
  });

  it('enforceProfileIntegrity skips silently when no baseline exists', () => {
    // No profile-hashes.json written — should not throw
    expect(() => enforceProfileIntegrity(tempDir)).not.toThrow();
  });

  it('detects missing files referenced in baseline', () => {
    const hashes = generateProfileHashes(tempDir);
    writeProfileHashes(tempDir, hashes);

    // Delete a file
    rmSync(join(tempDir, 'src', 'assistant', 'data-makan', 'workflows.json'));

    const result = validateProfileIntegrity(tempDir);

    expect(result.valid).toBe(false);
    expect(result.missingFiles).toHaveLength(1);
    expect(result.missingFiles[0].profile).toBe('makan');
    expect(result.missingFiles[0].file).toBe('workflows.json');
  });

  it('computeFileHash produces consistent SHA256 output', () => {
    const filePath = join(tempDir, 'src', 'assistant', 'data', 'routing.json');
    const hash1 = computeFileHash(filePath);
    const hash2 = computeFileHash(filePath);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('formatIntegrityErrors includes file name, expected, and actual hash', () => {
    const result = {
      valid: false,
      mismatches: [
        {
          profile: 'pelangi',
          file: 'intent-keywords.json',
          expected: 'aaa111',
          actual: 'bbb222',
        },
      ],
      missingFiles: [],
    };

    const output = formatIntegrityErrors(result);

    expect(output).toContain('intent-keywords.json');
    expect(output).toContain('aaa111');
    expect(output).toContain('bbb222');
    expect(output).toContain('pelangi');
  });

  it('writeProfileHashes creates valid JSON file', () => {
    const hashes = generateProfileHashes(tempDir);
    writeProfileHashes(tempDir, hashes);

    const hashesPath = join(tempDir, 'profile-hashes.json');
    expect(existsSync(hashesPath)).toBe(true);

    const parsed = JSON.parse(readFileSync(hashesPath, 'utf-8'));
    expect(parsed.generatedAt).toBeTruthy();
    expect(parsed.profiles).toBeInstanceOf(Array);
    expect(parsed.profiles.length).toBeGreaterThan(0);
  });
});
