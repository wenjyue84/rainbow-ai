/**
 * US-653: Knowledge Base Schema Validator Tests
 *
 * Tests for src/lib/kb-validator.ts — pure logic module that detects
 * cross-profile content contamination in KB markdown files.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import {
  scoreFile,
  detectContamination,
  buildSummary,
  CONTAMINATION_BLACKLISTS,
  type ProfileType,
  type FileValidationResult,
} from '../../src/lib/kb-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kb-validator-test-'));
}

function writeFile(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// scoreFile — unit tests
// ---------------------------------------------------------------------------

describe('scoreFile', () => {
  const makanBlacklist = CONTAMINATION_BLACKLISTS.makan;
  const southernBlacklist = CONTAMINATION_BLACKLISTS.southern;

  it('returns zero score for clean makan content', () => {
    const content = `# FAQ\n\nWe serve Thai food. Ask for the daily special.\n\nWiFi password: ilovemakan`;
    const { score, flagged } = scoreFile(content, makanBlacklist);
    expect(score).toBe(0);
    expect(flagged).toHaveLength(0);
  });

  it('flags "hostel" in makan profile as high contamination', () => {
    const content = `# About Us\n\nWe are a hostel near Skudai.`;
    const { score, flagged } = scoreFile(content, makanBlacklist);
    expect(score).toBeGreaterThan(0);
    expect(flagged.some(f => f.phrase === 'hostel')).toBe(true);
    expect(flagged.find(f => f.phrase === 'hostel')?.severity).toBe('high');
  });

  it('flags "check-in" in makan profile as high contamination', () => {
    const content = `Check-in is at 3 PM. Check-out is at noon.`;
    const { score, flagged } = scoreFile(content, makanBlacklist);
    expect(score).toBeGreaterThan(0);
    expect(flagged.some(f => f.phrase === 'check-in')).toBe(true);
  });

  it('flags "room availability" in makan profile as high contamination', () => {
    const content = `Please ask us about room availability for tonight.`;
    const { score, flagged } = scoreFile(content, makanBlacklist);
    expect(score).toBeGreaterThan(0);
    expect(flagged.some(f => f.phrase === 'room availability')).toBe(true);
  });

  it('flags "cafe" in southern profile as high contamination', () => {
    const content = `Visit our cafe for a nice meal. We have a full menu.`;
    const { score, flagged } = scoreFile(content, southernBlacklist);
    expect(score).toBeGreaterThan(0);
    expect(flagged.some(f => f.phrase === 'cafe')).toBe(true);
    expect(flagged.find(f => f.phrase === 'cafe')?.severity).toBe('high');
  });

  it('flags "menu" in southern profile as high contamination', () => {
    const content = `See our menu for today's specials.`;
    const { score, flagged } = scoreFile(content, southernBlacklist);
    expect(score).toBeGreaterThan(0);
    expect(flagged.some(f => f.phrase === 'menu')).toBe(true);
  });

  it('flags "table reservation" in southern profile as high contamination', () => {
    const content = `For groups, please make a table reservation in advance.`;
    const { score, flagged } = scoreFile(content, southernBlacklist);
    expect(score).toBeGreaterThan(0);
    expect(flagged.some(f => f.phrase === 'table reservation')).toBe(true);
  });

  it('caps score at 100 regardless of match count', () => {
    // Multiple high-severity matches in a heavily contaminated file
    const content = [
      'hostel hostel hostel hostel hostel',
      'check-in check-in check-in check-in',
      'room availability room availability room availability',
      'capsule dorm bunk overnight stay room rate',
    ].join('\n');
    const { score } = scoreFile(content, makanBlacklist);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('records occurrences count correctly', () => {
    const content = `hostel hostel hostel`;
    const { flagged } = scoreFile(content, makanBlacklist);
    const hostel = flagged.find(f => f.phrase === 'hostel');
    expect(hostel?.occurrences).toBe(3);
  });

  it('captures context snippets for flagged phrases', () => {
    const content = `Welcome to our cozy hostel in Skudai.`;
    const { flagged } = scoreFile(content, makanBlacklist);
    const hostel = flagged.find(f => f.phrase === 'hostel');
    expect(hostel?.context.length).toBeGreaterThan(0);
    expect(hostel?.context[0]).toContain('hostel');
  });

  it('is case-insensitive for phrase matching', () => {
    const content = `HOSTEL HOSTEL. Check-In is at 3pm. ROOM AVAILABILITY is limited.`;
    const { score, flagged } = scoreFile(content, makanBlacklist);
    expect(score).toBeGreaterThan(0);
    expect(flagged.some(f => f.phrase === 'hostel')).toBe(true);
    expect(flagged.some(f => f.phrase === 'check-in')).toBe(true);
    expect(flagged.some(f => f.phrase === 'room availability')).toBe(true);
  });

  it('returns zero score for southern clean content (homestay without cafe terms)', () => {
    const content = `# Check-In Guide\n\nCheck-in is at 4 PM. Park at Level 3/4.\nWiFi details will be provided on arrival.`;
    const { score } = scoreFile(content, southernBlacklist);
    // homestay check-in content should not have cafe contamination
    expect(score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// detectContamination — integration tests using temp dirs
// ---------------------------------------------------------------------------

describe('detectContamination', () => {
  it('returns empty array for non-existent directory', () => {
    const results = detectContamination('/nonexistent/dir', 'makan');
    expect(results).toHaveLength(0);
  });

  it('returns empty array for directory with no .md files', () => {
    const dir = makeTempDir();
    writeFile(dir, 'data.json', '{"key": "value"}');
    const results = detectContamination(dir, 'makan');
    expect(results).toHaveLength(0);
  });

  it('scans .md files and returns results for each', () => {
    const dir = makeTempDir();
    writeFile(dir, 'faq.md', '# FAQ\n\nWe serve Thai food.');
    writeFile(dir, 'ordering.md', '# Ordering\n\nWalk-in only.');
    const results = detectContamination(dir, 'makan');
    expect(results).toHaveLength(2);
  });

  it('assigns correct profile type to results', () => {
    const dir = makeTempDir();
    writeFile(dir, 'faq.md', '# FAQ\n\nClean content.');
    const results = detectContamination(dir, 'makan');
    expect(results[0].profile).toBe('makan');
  });

  it('detects hostel contamination in makan profile files', () => {
    const dir = makeTempDir();
    writeFile(dir, 'faq.md', '# FAQ\n\nWe are a hostel near Skudai.\ncheck-in is at 3pm.');
    const results = detectContamination(dir, 'makan');
    expect(results[0].contamination_score).toBeGreaterThan(0);
    expect(results[0].flagged_phrases.length).toBeGreaterThan(0);
  });

  it('detects cafe contamination in southern profile files', () => {
    const dir = makeTempDir();
    writeFile(dir, 'info.md', '# Info\n\nVisit our cafe. See the menu for today.');
    const results = detectContamination(dir, 'southern');
    expect(results[0].contamination_score).toBeGreaterThan(0);
    expect(results[0].flagged_phrases.some(f => f.phrase === 'cafe')).toBe(true);
    expect(results[0].flagged_phrases.some(f => f.phrase === 'menu')).toBe(true);
  });

  it('marks profile_type_valid as true when score < 30', () => {
    const dir = makeTempDir();
    writeFile(dir, 'clean.md', '# About\n\nWe serve halal food.');
    const results = detectContamination(dir, 'makan');
    // 'halal' is not in makan blacklist, score = 0
    expect(results[0].contamination_score).toBe(0);
    expect(results[0].profile_type_valid).toBe(true);
  });

  it('marks profile_type_valid as false when score >= 30', () => {
    const dir = makeTempDir();
    writeFile(dir, 'bad.md', '# About\n\nWe are a hostel. Check-in at 3pm.');
    const results = detectContamination(dir, 'makan');
    expect(results[0].contamination_score).toBeGreaterThanOrEqual(30);
    expect(results[0].profile_type_valid).toBe(false);
  });

  it('scans subdirectories recursively', () => {
    const dir = makeTempDir();
    const subDir = path.join(dir, 'subdir');
    fs.mkdirSync(subDir);
    writeFile(subDir, 'nested.md', '# Nested\n\nClean content.');
    const results = detectContamination(dir, 'makan');
    expect(results).toHaveLength(1);
    expect(results[0].file).toContain('nested.md');
  });
});

// ---------------------------------------------------------------------------
// buildSummary — unit tests
// ---------------------------------------------------------------------------

describe('buildSummary', () => {
  it('returns zero contaminated_files for clean profile', () => {
    const results: FileValidationResult[] = [
      { file: 'a.md', profile: 'makan', contamination_score: 0, flagged_phrases: [], profile_type_valid: true },
      { file: 'b.md', profile: 'makan', contamination_score: 0, flagged_phrases: [], profile_type_valid: true },
    ];
    const summary = buildSummary(results, 'makan');
    expect(summary.contaminated_files).toBe(0);
    expect(summary.total_files).toBe(2);
    expect(summary.avg_contamination_score).toBe(0);
  });

  it('includes recommendation when profile is clean', () => {
    const results: FileValidationResult[] = [
      { file: 'a.md', profile: 'makan', contamination_score: 0, flagged_phrases: [], profile_type_valid: true },
    ];
    const summary = buildSummary(results, 'makan');
    expect(summary.recommendations.some(r => r.includes('clean'))).toBe(true);
  });

  it('counts contaminated files correctly', () => {
    const results: FileValidationResult[] = [
      {
        file: 'a.md',
        profile: 'makan',
        contamination_score: 30,
        flagged_phrases: [{ phrase: 'hostel', severity: 'high', category: 'hostel', occurrences: 1, context: [] }],
        profile_type_valid: false,
      },
      { file: 'b.md', profile: 'makan', contamination_score: 0, flagged_phrases: [], profile_type_valid: true },
    ];
    const summary = buildSummary(results, 'makan');
    expect(summary.contaminated_files).toBe(1);
    expect(summary.total_files).toBe(2);
  });

  it('calculates avg_contamination_score correctly', () => {
    const results: FileValidationResult[] = [
      {
        file: 'a.md',
        profile: 'makan',
        contamination_score: 60,
        flagged_phrases: [],
        profile_type_valid: false,
      },
      {
        file: 'b.md',
        profile: 'makan',
        contamination_score: 40,
        flagged_phrases: [],
        profile_type_valid: false,
      },
    ];
    const summary = buildSummary(results, 'makan');
    expect(summary.avg_contamination_score).toBe(50);
  });

  it('includes critical contamination warning when score >= 60', () => {
    const results: FileValidationResult[] = [
      {
        file: 'a.md',
        profile: 'makan',
        contamination_score: 75,
        flagged_phrases: [{ phrase: 'hostel', severity: 'high', category: 'hostel', occurrences: 3, context: [] }],
        profile_type_valid: false,
      },
    ];
    const summary = buildSummary(results, 'makan');
    expect(summary.recommendations.some(r => r.includes('critical'))).toBe(true);
  });

  it('recommends removing specific category content', () => {
    const results: FileValidationResult[] = [
      {
        file: 'a.md',
        profile: 'makan',
        contamination_score: 30,
        flagged_phrases: [{ phrase: 'hostel', severity: 'high', category: 'hostel', occurrences: 1, context: [] }],
        profile_type_valid: false,
      },
    ];
    const summary = buildSummary(results, 'makan');
    expect(summary.recommendations.some(r => r.includes('hostel'))).toBe(true);
  });

  it('returns correct profile field', () => {
    const summary = buildSummary([], 'southern');
    expect(summary.profile).toBe('southern');
  });

  it('handles empty results gracefully', () => {
    const summary = buildSummary([], 'pelangi');
    expect(summary.total_files).toBe(0);
    expect(summary.contaminated_files).toBe(0);
    expect(summary.avg_contamination_score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: scan real project KB directories (if they exist)
// ---------------------------------------------------------------------------

describe('real KB directories (smoke test)', () => {
  const kbDirs: Array<{ dir: string; profile: ProfileType }> = [
    { dir: path.join(PROJECT_ROOT, '.rainbow-kb'), profile: 'pelangi' },
    { dir: path.join(PROJECT_ROOT, '.rainbow-kb-makan'), profile: 'makan' },
    { dir: path.join(PROJECT_ROOT, '.rainbow-kb-southern'), profile: 'southern' },
  ];

  for (const { dir, profile } of kbDirs) {
    it(`scans ${profile} KB directory without crashing`, () => {
      if (!fs.existsSync(dir)) return; // skip if not present
      const results = detectContamination(dir, profile);
      expect(Array.isArray(results)).toBe(true);
      for (const r of results) {
        expect(r.contamination_score).toBeGreaterThanOrEqual(0);
        expect(r.contamination_score).toBeLessThanOrEqual(100);
        expect(r.profile).toBe(profile);
        expect(Array.isArray(r.flagged_phrases)).toBe(true);
      }
    });

    it(`builds valid summary for ${profile} KB directory`, () => {
      if (!fs.existsSync(dir)) return; // skip if not present
      const results = detectContamination(dir, profile);
      const summary = buildSummary(results, profile);
      expect(summary.profile).toBe(profile);
      expect(summary.total_files).toBe(results.length);
      expect(summary.contaminated_files).toBeLessThanOrEqual(summary.total_files);
      expect(summary.recommendations.length).toBeGreaterThan(0);
    });
  }
});
