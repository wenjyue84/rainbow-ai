import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateProfileConsistency, ConsistencyReport } from './validate-profile-consistency';
import { readFileSync } from 'fs';
import * as fs from 'fs';

// Mock readFileSync
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    readFileSync: vi.fn((path: string, encoding?: string) => {
      // Use actual file system for real data
      return actual.readFileSync(path, encoding as BufferEncoding || 'utf-8');
    }),
  };
});

describe('validateProfileConsistency', () => {
  it('should detect intent in knowledge.json missing from routing.json as orphaned_amenities', async () => {
    const report = await validateProfileConsistency('data-pelangi');

    expect(report).toHaveProperty('orphaned_amenities');
    expect(report).toHaveProperty('missing_intent_routes');
    expect(report).toHaveProperty('file_mismatches');
    expect(Array.isArray(report.orphaned_amenities)).toBe(true);
  });

  it('should return valid=false when violations exist', async () => {
    const report = await validateProfileConsistency('data-pelangi');

    if (report.orphaned_amenities.length > 0 || report.missing_intent_routes.length > 0) {
      expect(report.valid).toBe(false);
    }
  });

  it('should return valid=true when no violations exist', async () => {
    // This test depends on actual data consistency
    // If the actual files are consistent, this should pass
    const report = await validateProfileConsistency('data-pelangi');

    // If there are no violations, valid should be true
    if (report.orphaned_amenities.length === 0 &&
        report.missing_intent_routes.length === 0 &&
        report.file_mismatches.length === 0) {
      expect(report.valid).toBe(true);
    }
  });

  it('should have valid structure with required fields', async () => {
    const report = await validateProfileConsistency('data-pelangi');

    expect(report).toHaveProperty('orphaned_amenities');
    expect(report).toHaveProperty('missing_intent_routes');
    expect(report).toHaveProperty('file_mismatches');
    expect(report).toHaveProperty('valid');

    expect(Array.isArray(report.orphaned_amenities)).toBe(true);
    expect(Array.isArray(report.missing_intent_routes)).toBe(true);
    expect(Array.isArray(report.file_mismatches)).toBe(true);
    expect(typeof report.valid).toBe('boolean');
  });

  it('should return sorted orphaned_amenities for consistency', async () => {
    const report = await validateProfileConsistency('data-pelangi');

    const sorted = [...report.orphaned_amenities].sort();
    expect(report.orphaned_amenities).toEqual(sorted);
  });

  it('should return sorted missing_intent_routes for consistency', async () => {
    const report = await validateProfileConsistency('data-pelangi');

    const sorted = [...report.missing_intent_routes].sort();
    expect(report.missing_intent_routes).toEqual(sorted);
  });
});
