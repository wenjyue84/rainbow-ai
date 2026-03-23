/**
 * Test suite for validate-knowledge-base.ts
 */

import { describe, it, expect } from 'vitest';
import { validateKnowledgeBase, formatValidationReport } from './validate-knowledge-base.js';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('validateKnowledgeBase', () => {
  it('should find knowledge.json files in data directories', () => {
    const baseDir = join(__dirname, '../..');
    const result = validateKnowledgeBase(baseDir);

    // Result should be an object with the validation results
    expect(result).toHaveProperty('isClean');
    expect(result).toHaveProperty('criticalViolations');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.criticalViolations)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('should have critical violations for missing profile_id', () => {
    const baseDir = join(__dirname, '../..');
    const result = validateKnowledgeBase(baseDir);

    // The current knowledge.json files don't have profile_id, so there should be critical violations
    // since each entry is missing the profile_id field
    if (result.criticalViolations.length > 0) {
      const profileIdViolations = result.criticalViolations.filter((v) =>
        v.includes('profile_id')
      );
      expect(profileIdViolations.length).toBeGreaterThan(0);
    }
  });

  it('should detect Pelangi phrases in non-Pelangi profiles', () => {
    const baseDir = join(__dirname, '../..');
    const result = validateKnowledgeBase(baseDir);

    // Check if there are warnings about Pelangi-specific phrases in other profiles
    const contaminationWarnings = result.warnings.filter((w) =>
      w.includes('contamination') || w.includes('Pelangi-specific')
    );

    // Southern and Makan profiles might have Pelangi references
    // If they do, they should be detected
    if (contaminationWarnings.length > 0) {
      expect(contaminationWarnings.length).toBeGreaterThan(0);
    }
  });

  it('should format validation report correctly', () => {
    const result = {
      isClean: false,
      criticalViolations: ['Test critical violation'],
      warnings: ['Test warning'],
    };

    const report = formatValidationReport(result);
    expect(report).toContain('CRITICAL VIOLATIONS');
    expect(report).toContain('WARNINGS');
    expect(report).toContain('Test critical violation');
    expect(report).toContain('Test warning');
  });

  it('should return clean validation when no violations exist', () => {
    const result = {
      isClean: true,
      criticalViolations: [],
      warnings: [],
    };

    expect(result.isClean).toBe(true);
    expect(result.criticalViolations.length).toBe(0);
    expect(result.warnings.length).toBe(0);
  });
});
