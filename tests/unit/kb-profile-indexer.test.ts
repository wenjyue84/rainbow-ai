/**
 * kb-profile-indexer.test.ts
 *
 * Tests for the Knowledge Base Profile Isolation Index Builder
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  scanKBDirectory,
  readFileLines,
  detectCrossProfileReferences,
  buildProfileIndex,
} from '../../src/tools/kb-profile-indexer.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

// ── Test Setup ─────────────────────────────────────────────────────────

const TEST_DIR = join(process.cwd(), 'test-kb-indexer-temp');

function setupTestKBDirs() {
  // Clean up if exists
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }

  // Create test directories
  mkdirSync(join(TEST_DIR, '.rainbow-kb'), { recursive: true });
  mkdirSync(join(TEST_DIR, '.rainbow-kb-makan'), { recursive: true });
  mkdirSync(join(TEST_DIR, '.rainbow-kb-southern'), { recursive: true });

  // Create test files
  writeFileSync(
    join(TEST_DIR, '.rainbow-kb', 'pelangi-facts.md'),
    `# Pelangi Capsule Hostel

Pelangi Capsule Hostel is a capsule hostel in JB.
We offer affordable dorm room accommodations.
`
  );

  // This file should trigger a violation - contains "Pelangi Capsule"
  writeFileSync(
    join(TEST_DIR, '.rainbow-kb-makan', 'cafe-facts.md'),
    `# Makan Moments Cafe

Makan Moments Cafe is a Thai-Malaysian fusion restaurant.
Located in Taman Impian Emas, Skudai.

Note: NOT to be confused with Pelangi Capsule Hostel.
We are a cafe, not a hostel.
`
  );

  writeFileSync(
    join(TEST_DIR, '.rainbow-kb-southern', 'homestay-info.md'),
    `# Southern Homestay

Southern Homestay is a furnished room rental in Senai.
Perfect for factory workers and long-term stays.
`
  );
}

function cleanupTestKBDirs() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('kb-profile-indexer', () => {
  beforeAll(() => {
    // Save original cwd and change to test dir
    setupTestKBDirs();
  });

  afterAll(() => {
    cleanupTestKBDirs();
  });

  describe('scanKBDirectory', () => {
    it('should find markdown files in KB directory', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(TEST_DIR);
        const files = scanKBDirectory('.rainbow-kb');
        expect(files.length).toBeGreaterThan(0);
        expect(files.some((f) => f.includes('pelangi-facts.md'))).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return empty array for non-existent directory', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(TEST_DIR);
        const files = scanKBDirectory('.rainbow-kb-nonexistent');
        expect(files.length).toBe(0);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('readFileLines', () => {
    it('should read file and return lines with line numbers', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(TEST_DIR);
        const lines = readFileLines('.rainbow-kb/pelangi-facts.md');
        expect(lines.length).toBeGreaterThan(0);
        expect(lines[0]).toHaveProperty('lineNumber');
        expect(lines[0]).toHaveProperty('content');
        expect(lines[0].lineNumber).toBe(1);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('detectCrossProfileReferences', () => {
    it('should detect "Pelangi Capsule" keyword in Makan KB file', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(TEST_DIR);
        const violations = detectCrossProfileReferences(
          '.rainbow-kb-makan/cafe-facts.md',
          'makan-moments'
        );

        expect(violations.length).toBeGreaterThan(0);

        // Find the violation with "Pelangi Capsule"
        const pelangiViolation = violations.find((v) =>
          v.detectedKeywords.some((k) => k.includes('Pelangi'))
        );

        expect(pelangiViolation).toBeDefined();
        expect(pelangiViolation?.sourceProfile).toBe('pelangi');
        expect(pelangiViolation?.profileId).toBe('makan-moments');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should not report violations in own profile KB files', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(TEST_DIR);
        const violations = detectCrossProfileReferences(
          '.rainbow-kb/pelangi-facts.md',
          'pelangi'
        );

        // Should not detect "Pelangi Capsule" as a violation since it's the pelangi profile
        expect(
          violations.filter((v) => v.sourceProfile === 'pelangi')
        ).toHaveLength(0);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should handle non-existent files gracefully', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(TEST_DIR);
        const violations = detectCrossProfileReferences(
          '.rainbow-kb/nonexistent.md',
          'pelangi'
        );
        expect(violations).toEqual([]);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('buildProfileIndex', () => {
    it('should build complete index with summary', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(TEST_DIR);
        const index = buildProfileIndex();

        expect(index).toHaveProperty('timestamp');
        expect(index).toHaveProperty('profiles');
        expect(index).toHaveProperty('violations');
        expect(index).toHaveProperty('summary');

        expect(index.profiles.length).toBeGreaterThan(0);
        expect(index.summary.totalProfiles).toBe(3); // pelangi, southern, makan-moments
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should report violations in summary', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(TEST_DIR);
        const index = buildProfileIndex();

        // We have at least one violation: "Pelangi Capsule" in makan KB
        expect(index.summary.totalViolations).toBeGreaterThan(0);
        expect(index.summary.profilesWithViolations.length).toBeGreaterThan(0);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should include file paths and line numbers in violations', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(TEST_DIR);
        const index = buildProfileIndex();

        const violations = index.violations;
        if (violations.length > 0) {
          const violation = violations[0];
          expect(violation).toHaveProperty('profileId');
          expect(violation).toHaveProperty('filePath');
          expect(violation).toHaveProperty('lineNumber');
          expect(violation).toHaveProperty('content');
          expect(violation).toHaveProperty('detectedKeywords');
          expect(violation).toHaveProperty('sourceProfile');
        }
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
