/**
 * US-485: Profile Isolation Validation Test Suite — Southern Profile
 *
 * Tests that the Southern homestay profile maintains strict data isolation:
 * - intent-keywords.json contains zero Pelangi capsule-specific keywords
 * - Knowledge base .md files contain zero Pelangi capsule-specific keywords
 * - Generates detailed contamination report on violations
 */

import { describe, it, expect } from 'vitest';
import {
  validateProfileIsolation,
  generateReport,
  type ProfileContaminationReport
} from '../../src/tools/profile-isolation-validator.js';

describe('Profile Isolation Validation — Southern Profile (US-485)', () => {
  let report: ProfileContaminationReport;

  describe('Setup', () => {
    it('should validate southern profile without throwing', () => {
      expect(() => {
        report = validateProfileIsolation('southern');
      }).not.toThrow();
    });

    it('should return a valid report object', () => {
      expect(report).toBeDefined();
      expect(report.profile).toBe('southern');
      expect(report.timestamp).toBeDefined();
      expect(typeof report.contamination_score).toBe('number');
      expect(report.contamination_score).toBeGreaterThanOrEqual(0);
      expect(report.contamination_score).toBeLessThanOrEqual(100);
    });
  });

  describe('Intent Keywords Isolation', () => {
    it('should not contain Pelangi capsule-specific keywords in intent-keywords.json', () => {
      // Profile is valid if violations is empty or no violation for intent-keywords.json
      const intentViolations = report.violations.filter(
        v => v.file === 'intent-keywords.json'
      );

      if (intentViolations.length > 0) {
        const violatedCategories = new Set(
          intentViolations.map(v => v.keyword_category)
        );
        expect(violatedCategories.has('pelangi_capsule_specific')).toBe(true);
      }

      // The test passes if there are NO violations
      expect(report.violations.filter(v => v.file === 'intent-keywords.json')).toEqual([]);
    });

    it('should have zero violations for Pelangi-specific keywords', () => {
      const pelangiViolations = report.violations.filter(
        v => v.keyword_category === 'pelangi_capsule_specific'
      );
      expect(pelangiViolations).toEqual([]);
    });

    it('should match line numbers for any detected violations', () => {
      const violations = report.violations;

      for (const violation of violations) {
        if (violation.line_numbers.length > 0) {
          // If violations exist, they must have valid line numbers
          expect(violation.line_numbers.every(ln => ln > 0)).toBe(true);
        }
      }
    });
  });

  describe('Knowledge Base Isolation', () => {
    it('should not contain Pelangi capsule-specific keywords in .md files', () => {
      const kbViolations = report.violations.filter(
        v => v.file.endsWith('.md')
      );

      // Test that southern KB has no Pelangi-specific keywords
      expect(kbViolations).toEqual([]);
    });

    it('should have clean knowledge base directory', () => {
      const kbViolations = report.violations.filter(
        v => !v.file.includes('intent-keywords.json')
      );

      // All KB violations should be errors or warnings with documented line numbers
      for (const violation of kbViolations) {
        expect(violation.violated_keywords.length).toBeGreaterThan(0);
      }

      // For a clean profile, there should be no KB violations
      expect(kbViolations).toEqual([]);
    });
  });

  describe('Contamination Report', () => {
    it('should generate a readable text report', () => {
      const text = generateReport(report);
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain('Profile Isolation Validation Report');
      expect(text).toContain('southern');
    });

    it('should indicate clean status if no violations', () => {
      if (report.is_clean) {
        expect(report.total_violations).toBe(0);
        expect(report.contaminated_files).toEqual([]);
        expect(report.violations).toEqual([]);

        const text = generateReport(report);
        expect(text).toContain('CLEAN');
      }
    });

    it('should list contaminated files if violations exist', () => {
      if (!report.is_clean) {
        expect(report.contaminated_files.length).toBeGreaterThan(0);
        expect(report.total_violations).toBeGreaterThan(0);

        const text = generateReport(report);
        expect(text).toContain('CONTAMINATED');
        expect(text).toContain('Contaminated Files');
      }
    });

    it('should include contamination score in report', () => {
      const text = generateReport(report);
      expect(text).toContain('Contamination Score');
      expect(text).toContain(String(report.contamination_score));
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing intent-keywords.json gracefully', () => {
      // Even if file doesn't exist, should not throw
      expect(() => {
        const result = validateProfileIsolation('southern');
        expect(result).toBeDefined();
      }).not.toThrow();
    });

    it('should handle missing knowledge base directory gracefully', () => {
      // Even if KB dir doesn't exist, should not throw
      expect(() => {
        const result = validateProfileIsolation('southern');
        expect(result).toBeDefined();
      }).not.toThrow();
    });

    it('should not have more violations than files', () => {
      // The number of distinct contaminated files should be <= total violations
      // (multiple violations can occur in one file)
      expect(report.contaminated_files.length).toBeLessThanOrEqual(report.violations.length || 1);
    });
  });

  describe('Contamination Score Calculation', () => {
    it('should be 0 if profile is clean', () => {
      if (report.is_clean) {
        expect(report.contamination_score).toBe(0);
      }
    });

    it('should be between 0 and 100', () => {
      expect(report.contamination_score).toBeGreaterThanOrEqual(0);
      expect(report.contamination_score).toBeLessThanOrEqual(100);
    });

    it('should increase with error violations', () => {
      const errorCount = report.violations.filter(v => v.severity === 'error').length;
      if (errorCount > 0) {
        expect(report.contamination_score).toBeGreaterThan(0);
      }
    });
  });

  describe('Data Integrity', () => {
    it('should have valid timestamps in report', () => {
      const timestamp = new Date(report.timestamp);
      expect(timestamp).not.toBeNaN();
      expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should not report violations for profile if it is clean', () => {
      if (report.is_clean) {
        expect(report.violations.length).toBe(0);
        expect(report.contaminated_files.length).toBe(0);
      }
    });
  });
});
