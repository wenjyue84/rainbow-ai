/**
 * US-044: Profile data schema validator tests
 *
 * Tests that the validator correctly:
 * 1. Rejects profiles containing cross-profile contaminated terms
 * 2. Passes profiles with clean (profile-appropriate) data
 * 3. Reports correct file paths, line numbers, and offending terms
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Import after mocks are set up
import {
  scanFileForTerms,
  validateProfile,
  validateAllProfiles,
  formatReport,
  EXCLUSIVE_TERM_GROUPS,
  PROFILE_CONFIGS,
} from '../lib/profile-validator.js';

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── scanFileForTerms ────────────────────────────────────────────────────────

describe('scanFileForTerms', () => {
  it('returns empty array when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const result = scanFileForTerms('/fake/routing.json', ['ORDER_BROWSE'], 'southern', 'Cafe');
    expect(result).toEqual([]);
  });

  it('returns empty array when file has no matching terms', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"greeting": {"action": "static_reply"}}');
    const result = scanFileForTerms('/fake/routing.json', ['ORDER_BROWSE'], 'southern', 'Cafe');
    expect(result).toEqual([]);
  });

  it('detects a cafe term on the correct line', () => {
    mockExistsSync.mockReturnValue(true);
    const fileContent = [
      '{',
      '  "greeting": {"action": "static_reply"},',
      '  "ORDER_BROWSE": {"action": "llm_reply"}',
      '}',
    ].join('\n');
    mockReadFileSync.mockReturnValue(fileContent);

    const result = scanFileForTerms(
      '/fake/routing.json',
      ['ORDER_BROWSE'],
      'southern',
      'Cafe (Makan Moments)',
    );

    expect(result).toHaveLength(1);
    expect(result[0].term).toBe('ORDER_BROWSE');
    expect(result[0].lineNumber).toBe(3);
    expect(result[0].profileId).toBe('southern');
    expect(result[0].sourceProfile).toBe('Cafe (Makan Moments)');
    expect(result[0].filePath).toBe('/fake/routing.json');
  });

  it('detects multiple contaminated lines', () => {
    mockExistsSync.mockReturnValue(true);
    const fileContent = [
      '{"ORDER_BROWSE": "x",',
      ' "ORDER_ITEM_ADD": "y",',
      ' "greeting": "z"}',
    ].join('\n');
    mockReadFileSync.mockReturnValue(fileContent);

    const result = scanFileForTerms(
      '/fake/routing.json',
      ['ORDER_BROWSE', 'ORDER_ITEM_ADD'],
      'southern',
      'Cafe',
    );

    expect(result).toHaveLength(2);
    expect(result[0].lineNumber).toBe(1);
    expect(result[1].lineNumber).toBe(2);
  });

  it('reports only one match per line even when multiple terms match', () => {
    mockExistsSync.mockReturnValue(true);
    // Both terms on same line
    mockReadFileSync.mockReturnValue('{"ORDER_BROWSE": "x", "ORDER_ITEM_ADD": "y"}');

    const result = scanFileForTerms(
      '/fake/routing.json',
      ['ORDER_BROWSE', 'ORDER_ITEM_ADD'],
      'southern',
      'Cafe',
    );

    expect(result).toHaveLength(1);
  });
});

// ─── validateProfile ─────────────────────────────────────────────────────────

describe('validateProfile', () => {
  it('throws for unknown profileId', () => {
    expect(() => validateProfile('nonexistent-profile')).toThrow('Unknown profileId');
  });

  it('returns isClean=true when data files have no forbidden terms', () => {
    // All files exist but contain only clean content
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"greeting": {"action": "static_reply"}, "thanks": {"action": "static_reply"}}');

    const result = validateProfile('makan-moments', '/root');
    expect(result.isClean).toBe(true);
    expect(result.matches).toHaveLength(0);
    expect(result.profileId).toBe('makan-moments');
  });

  it('returns isClean=false when makan-moments data contains hostel terms', () => {
    mockExistsSync.mockReturnValue(true);
    // Simulate routing.json with a hostel-exclusive term
    mockReadFileSync.mockReturnValue(
      '{"capsule_conflict": {"action": "workflow"}, "menu_query": {"action": "llm_reply"}}',
    );

    const result = validateProfile('makan-moments', '/root');
    expect(result.isClean).toBe(false);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].term).toBe('capsule_conflict');
    expect(result.matches[0].profileId).toBe('makan-moments');
  });

  it('returns isClean=false when southern data contains cafe terms', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"ORDER_BROWSE": {"action": "llm_reply"}}');

    const result = validateProfile('southern', '/root');
    expect(result.isClean).toBe(false);
    expect(result.matches[0].term).toBe('ORDER_BROWSE');
    expect(result.matches[0].sourceProfile).toBe(EXCLUSIVE_TERM_GROUPS.cafe.label);
  });

  it('pelangi profile has no forbidden groups — always clean', () => {
    mockExistsSync.mockReturnValue(true);
    // Even if pelangi has cafe terms (it integrates food ordering), validator should pass
    mockReadFileSync.mockReturnValue('{"ORDER_BROWSE": {"action": "llm_reply"}, "capsule_conflict": {"action": "workflow"}}');

    const result = validateProfile('pelangi', '/root');
    expect(result.isClean).toBe(true);
    expect(PROFILE_CONFIGS.pelangi.forbiddenGroups).toHaveLength(0);
  });

  it('handles missing data files gracefully', () => {
    mockExistsSync.mockReturnValue(false); // all files "missing"

    const result = validateProfile('makan-moments', '/root');
    expect(result.isClean).toBe(true);
    expect(result.matches).toHaveLength(0);
  });
});

// ─── validateAllProfiles ─────────────────────────────────────────────────────

describe('validateAllProfiles', () => {
  it('returns isClean=true when all profiles are clean', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"greeting": {"action": "static_reply"}}');

    const report = validateAllProfiles('/root');
    expect(report.isClean).toBe(true);
    expect(report.profiles).toHaveLength(3); // pelangi, southern, makan-moments
  });

  it('returns isClean=false when any profile is contaminated', () => {
    mockExistsSync.mockReturnValue(true);
    // Return hostel-specific term for every file (will hit southern and makan-moments checks)
    mockReadFileSync.mockReturnValue('{"card_locked": {"action": "workflow"}}');

    const report = validateAllProfiles('/root');
    expect(report.isClean).toBe(false);
    // makan-moments should flag card_locked (hostel term)
    const makanResult = report.profiles.find((p) => p.profileId === 'makan-moments');
    expect(makanResult?.isClean).toBe(false);
  });

  it('includes all three profiles in report', () => {
    mockExistsSync.mockReturnValue(false);

    const report = validateAllProfiles('/root');
    const ids = report.profiles.map((p) => p.profileId);
    expect(ids).toContain('pelangi');
    expect(ids).toContain('southern');
    expect(ids).toContain('makan-moments');
  });
});

// ─── formatReport ────────────────────────────────────────────────────────────

describe('formatReport', () => {
  it('outputs CLEAN status for all-clean report', () => {
    mockExistsSync.mockReturnValue(false);
    const report = validateAllProfiles('/root');
    const text = formatReport(report);
    expect(text).toContain('✓ CLEAN');
    expect(text).toContain('0 contamination match');
  });

  it('outputs CONTAMINATED status and match details', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"capsule_conflict": {"action": "workflow"}}');

    const report = validateAllProfiles('/root');
    const text = formatReport(report);

    expect(text).toContain('✗ CONTAMINATED');
    expect(text).toContain('capsule_conflict');

    // Find a profile with matches
    const contaminatedProfile = report.profiles.find((p) => p.matches.length > 0);
    expect(contaminatedProfile).toBeDefined();
    expect(contaminatedProfile?.matches[0].lineNumber).toBe(1);
  });
});

// ─── Term group completeness ──────────────────────────────────────────────────

describe('EXCLUSIVE_TERM_GROUPS', () => {
  it('defines hostel group with at least 5 terms', () => {
    expect(EXCLUSIVE_TERM_GROUPS.hostel.terms.length).toBeGreaterThanOrEqual(5);
  });

  it('defines cafe group with at least 8 terms', () => {
    expect(EXCLUSIVE_TERM_GROUPS.cafe.terms.length).toBeGreaterThanOrEqual(8);
  });

  it('hostel and cafe term groups have no overlap', () => {
    const hostelTerms = new Set(EXCLUSIVE_TERM_GROUPS.hostel.terms);
    const overlap = EXCLUSIVE_TERM_GROUPS.cafe.terms.filter((t) => hostelTerms.has(t));
    expect(overlap).toHaveLength(0);
  });
});
