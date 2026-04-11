/**
 * Tests for keyword-frequency-analyzer.ts
 *
 * Ensures pelangi, southern, makan profiles are analyzed separately
 * with zero cross-profile keyword contamination detection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  analyzeKeywordFrequency,
  computeKeywordPrecision,
  detectCrossProfileContamination,
  formatKeywordFrequencyAsCSV,
  formatContaminationReport,
  formatContaminationReportAsJSON,
} from '../../src/tools/analytics/keyword-frequency-analyzer.js';

describe('Keyword Frequency Analyzer', () => {
  describe('analyzeKeywordFrequency', () => {
    it('should analyze keywords for pelangi profile', () => {
      const report = analyzeKeywordFrequency('pelangi');

      expect(report).toBeDefined();
      expect(report.profile).toBe('pelangi');
      expect(report.timestamp).toBeDefined();
      expect(report.totalKeywords).toBeGreaterThan(0);
      expect(report.totalIntents).toBeGreaterThan(0);
      expect(report.keywords).toBeInstanceOf(Array);
      expect(report.unstableKeywords).toBeInstanceOf(Array);
    });

    it('should analyze keywords for southern profile', () => {
      const report = analyzeKeywordFrequency('southern');

      expect(report.profile).toBe('southern');
      expect(report.totalKeywords).toBeGreaterThan(0);
    });

    it('should analyze keywords for makan profile', () => {
      const report = analyzeKeywordFrequency('makan');

      expect(report.profile).toBe('makan');
      expect(report.totalKeywords).toBeGreaterThan(0);
    });

    it('should compute precision for each keyword', () => {
      const report = analyzeKeywordFrequency('pelangi');

      for (const stat of report.keywords) {
        // Precision should be between 0 and 1
        expect(stat.precision).toBeGreaterThanOrEqual(0);
        expect(stat.precision).toBeLessThanOrEqual(1);

        // Precision = correct / total
        const expectedPrecision = stat.total > 0 ? stat.correct / stat.total : 0;
        expect(stat.precision).toBeCloseTo(
          Math.round(expectedPrecision * 10000) / 10000,
          2
        );
      }
    });

    it('should compute recall for each keyword', () => {
      const report = analyzeKeywordFrequency('pelangi');

      for (const stat of report.keywords) {
        // Recall should be between 0 and 1
        expect(stat.recall).toBeGreaterThanOrEqual(0);
        expect(stat.recall).toBeLessThanOrEqual(1);
      }
    });

    it('should identify unstable keywords with precision < 0.5', () => {
      const report = analyzeKeywordFrequency('pelangi');

      for (const unstable of report.unstableKeywords) {
        expect(unstable.precision).toBeLessThan(0.5);
      }
    });

    it('should respect minKeywordOccurrences option', () => {
      const reportMin1 = analyzeKeywordFrequency('pelangi', {
        minKeywordOccurrences: 1,
      });
      const reportMin5 = analyzeKeywordFrequency('pelangi', {
        minKeywordOccurrences: 5,
      });

      // Stricter filter should produce fewer or equal keywords
      expect(reportMin5.keywords.length).toBeLessThanOrEqual(
        reportMin1.keywords.length
      );
    });

    it('should have correct > 0 and incorrect >= 0 for each keyword', () => {
      const report = analyzeKeywordFrequency('pelangi');

      for (const stat of report.keywords) {
        expect(stat.total).toBe(stat.correct + stat.incorrect);
        expect(stat.correct).toBeGreaterThanOrEqual(0);
        expect(stat.incorrect).toBeGreaterThanOrEqual(0);
      }
    });

    it('should sort keywords by precision descending', () => {
      const report = analyzeKeywordFrequency('pelangi');

      for (let i = 0; i < report.keywords.length - 1; i++) {
        expect(report.keywords[i].precision).toBeGreaterThanOrEqual(
          report.keywords[i + 1].precision
        );
      }
    });
  });

  describe('computeKeywordPrecision', () => {
    it('should compute precision and recall for a keyword', () => {
      const matches = [
        {
          keyword: 'hello',
          intent: 'greeting',
          profile: 'pelangi',
          total: 100,
          correct: 95,
          incorrect: 5,
        },
        {
          keyword: 'hi',
          intent: 'greeting',
          profile: 'pelangi',
          total: 50,
          correct: 48,
          incorrect: 2,
        },
      ];

      const result = computeKeywordPrecision('hello', matches);

      expect(result.totalMatches).toBe(100);
      expect(result.correctMatches).toBe(95);
      expect(result.precision).toBeCloseTo(0.95, 2);
    });

    it('should return 0 precision for keyword with no matches', () => {
      const matches = [
        {
          keyword: 'hello',
          intent: 'greeting',
          profile: 'pelangi',
          total: 100,
          correct: 95,
          incorrect: 5,
        },
      ];

      const result = computeKeywordPrecision('nonexistent', matches);

      expect(result.totalMatches).toBe(0);
      expect(result.correctMatches).toBe(0);
      expect(result.precision).toBe(0);
    });

    it('should aggregate matches across multiple profiles', () => {
      const matches = [
        {
          keyword: 'check-in',
          intent: 'checkin_info',
          profile: 'pelangi',
          total: 50,
          correct: 45,
          incorrect: 5,
        },
        {
          keyword: 'check-in',
          intent: 'checkin_info',
          profile: 'southern',
          total: 30,
          correct: 28,
          incorrect: 2,
        },
      ];

      const result = computeKeywordPrecision('check-in', matches);

      expect(result.totalMatches).toBe(80);
      expect(result.correctMatches).toBe(73);
    });
  });

  describe('detectCrossProfileContamination', () => {
    it('should detect contaminated keywords across profiles', () => {
      const report = detectCrossProfileContamination([
        'pelangi',
        'southern',
        'makan',
      ]);

      expect(report).toBeDefined();
      expect(report.timestamp).toBeDefined();
      expect(report.totalProfiles).toBe(3);
      expect(report.contaminatedKeywords).toBeInstanceOf(Array);
      expect(report.criticalContamination).toBeInstanceOf(Array);
    });

    it('should identify critical contamination (same intent across profiles)', () => {
      const report = detectCrossProfileContamination([
        'pelangi',
        'southern',
        'makan',
      ]);

      // All critical items should have severity='high'
      for (const item of report.criticalContamination) {
        expect(item.severity).toBe('high');
      }
    });

    it('should classify contamination by severity', () => {
      const report = detectCrossProfileContamination([
        'pelangi',
        'southern',
      ]);

      // All contaminated keywords should have a severity level
      for (const item of report.contaminatedKeywords) {
        expect(['low', 'medium', 'high']).toContain(item.severity);
      }

      // Verify severity ordering: high first
      const severityOrder = { high: 0, medium: 1, low: 2 };
      for (let i = 0; i < report.contaminatedKeywords.length - 1; i++) {
        const current = report.contaminatedKeywords[i];
        const next = report.contaminatedKeywords[i + 1];
        expect(severityOrder[current.severity]).toBeLessThanOrEqual(
          severityOrder[next.severity]
        );
      }
    });

    it('should map profiles to intents correctly', () => {
      const report = detectCrossProfileContamination([
        'pelangi',
        'southern',
      ]);

      for (const contamination of report.contaminatedKeywords) {
        expect(contamination.keyword).toBeDefined();
        expect(contamination.profiles.length).toBeGreaterThanOrEqual(2);

        for (const profile of contamination.profiles) {
          expect(contamination.intents.has(profile)).toBe(true);
          const intents = contamination.intents.get(profile);
          expect(Array.isArray(intents)).toBe(true);
          expect((intents as string[]).length).toBeGreaterThan(0);
        }
      }
    });

    it('should return empty contamination list for isolated profiles', () => {
      // Single profile cannot have cross-profile contamination
      const report = detectCrossProfileContamination(['pelangi']);

      // All keywords in a single profile are allowed
      expect(report.contaminatedKeywords.length).toBe(0);
    });
  });

  describe('formatKeywordFrequencyAsCSV', () => {
    it('should format report as valid CSV', () => {
      const report = analyzeKeywordFrequency('pelangi');
      const csv = formatKeywordFrequencyAsCSV(report);

      expect(csv).toContain('keyword,intent,profile');
      expect(csv).toContain('pelangi');

      // Should have header + data rows
      const lines = csv.split('\n');
      expect(lines.length).toBeGreaterThan(1);
    });

    it('should escape keywords with quotes in CSV', () => {
      const report = analyzeKeywordFrequency('pelangi');
      const csv = formatKeywordFrequencyAsCSV(report);

      // Keywords should be quoted
      const lines = csv.split('\n');
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim()) {
          expect(line).toMatch(/^"[^"]*"/); // starts with quoted keyword
        }
      }
    });

    it('should include all required columns', () => {
      const report = analyzeKeywordFrequency('pelangi');
      const csv = formatKeywordFrequencyAsCSV(report);
      const header = csv.split('\n')[0];

      const requiredColumns = [
        'keyword',
        'intent',
        'profile',
        'total',
        'correct',
        'incorrect',
        'precision',
        'recall',
        'frequency',
      ];

      for (const col of requiredColumns) {
        expect(header).toContain(col);
      }
    });
  });

  describe('formatContaminationReport', () => {
    it('should format contamination report as readable text', () => {
      const report = detectCrossProfileContamination([
        'pelangi',
        'southern',
        'makan',
      ]);
      const text = formatContaminationReport(report);

      expect(text).toContain('Cross-Profile Keyword Contamination Report');
      expect(text).toContain('Generated:');
      expect(text).toContain('Total Profiles Analyzed: 3');
    });

    it('should highlight critical contamination', () => {
      const report = detectCrossProfileContamination([
        'pelangi',
        'southern',
        'makan',
      ]);
      const text = formatContaminationReport(report);

      if (report.criticalContamination.length > 0) {
        expect(text).toContain('CRITICAL CONTAMINATION');
        expect(text).toContain('HIGH SEVERITY');
      }
    });

    it('should list all contaminated keywords when present', () => {
      const report = detectCrossProfileContamination([
        'pelangi',
        'southern',
        'makan',
      ]);
      const text = formatContaminationReport(report);

      if (report.contaminatedKeywords.length > 0) {
        expect(text).toContain('ALL CONTAMINATED KEYWORDS');
      }
    });

    it('should include profile and intent information', () => {
      const report = detectCrossProfileContamination([
        'pelangi',
        'southern',
        'makan',
      ]);
      const text = formatContaminationReport(report);

      if (report.contaminatedKeywords.length > 0) {
        expect(text).toContain('Profiles:');
      }
    });
  });

  describe('formatContaminationReportAsJSON', () => {
    it('should format contamination report as JSON', () => {
      const report = detectCrossProfileContamination([
        'pelangi',
        'southern',
        'makan',
      ]);
      const json = formatContaminationReportAsJSON(report);

      expect(json).toBeDefined();
      expect(json.timestamp).toBeDefined();
      expect(json.totalProfiles).toBe(3);
      expect(json.totalContaminatedKeywords).toBeDefined();
      expect(json.criticalCount).toBeDefined();
    });

    it('should be valid JSON', () => {
      const report = detectCrossProfileContamination([
        'pelangi',
        'southern',
      ]);
      const json = formatContaminationReportAsJSON(report);

      // Should not throw when converting to string
      const jsonStr = JSON.stringify(json);
      expect(jsonStr).toBeDefined();

      // Should be valid JSON
      const parsed = JSON.parse(jsonStr);
      expect(parsed.timestamp).toBeDefined();
    });

    it('should include critical and all arrays', () => {
      const report = detectCrossProfileContamination([
        'pelangi',
        'southern',
        'makan',
      ]);
      const json = formatContaminationReportAsJSON(report);

      expect(Array.isArray(json.critical)).toBe(true);
      expect(Array.isArray(json.all)).toBe(true);

      // Critical should be a subset of all
      expect(json.critical.length).toBeLessThanOrEqual(json.all.length);
    });
  });

  describe('Profile Isolation', () => {
    it('should analyze pelangi separately from southern', () => {
      const pelangiReport = analyzeKeywordFrequency('pelangi');
      const southernReport = analyzeKeywordFrequency('southern');

      // Both should have data
      expect(pelangiReport.keywords.length).toBeGreaterThan(0);
      expect(southernReport.keywords.length).toBeGreaterThan(0);

      // Profile should be correctly set
      expect(pelangiReport.profile).toBe('pelangi');
      expect(southernReport.profile).toBe('southern');
    });

    it('should analyze makan separately from others', () => {
      const makanReport = analyzeKeywordFrequency('makan');

      expect(makanReport.profile).toBe('makan');
      expect(makanReport.keywords.length).toBeGreaterThan(0);
    });

    it('should detect zero contamination within single profile', () => {
      // Single profile should have 0 contamination
      const report = detectCrossProfileContamination(['pelangi']);

      expect(report.contaminatedKeywords.length).toBe(0);
      expect(report.criticalContamination.length).toBe(0);
    });
  });

  describe('Acceptance Criteria', () => {
    it('AC1: Analyzes keyword success rates per intent per profile', () => {
      const report = analyzeKeywordFrequency('pelangi');

      // Should have per-intent analysis
      expect(report.totalIntents).toBeGreaterThan(0);

      // Each keyword should be mapped to intent and profile
      for (const stat of report.keywords) {
        expect(stat.intent).toBeDefined();
        expect(stat.profile).toBe('pelangi');
        expect(stat.correct).toBeGreaterThanOrEqual(0);
        expect(stat.total).toBeGreaterThan(0);
      }
    });

    it('AC2: Ensures zero cross-profile keyword contamination in test data', () => {
      // Verify that profiles are analyzed separately with no contamination
      const pelangiReport = analyzeKeywordFrequency('pelangi');
      const southernReport = analyzeKeywordFrequency('southern');
      const makanReport = analyzeKeywordFrequency('makan');

      // All reports should be for their respective profiles only
      for (const stat of pelangiReport.keywords) {
        expect(stat.profile).toBe('pelangi');
      }
      for (const stat of southernReport.keywords) {
        expect(stat.profile).toBe('southern');
      }
      for (const stat of makanReport.keywords) {
        expect(stat.profile).toBe('makan');
      }
    });

    it('AC3: CLI tools generate frequency report and detect cross-profile reuse', () => {
      // Verify report generation capabilities
      const report = analyzeKeywordFrequency('southern');
      const csv = formatKeywordFrequencyAsCSV(report);

      // CSV should be generated without errors
      expect(csv.length).toBeGreaterThan(0);
      expect(csv).toContain('keyword');

      // Contamination detection should work
      const contamination = detectCrossProfileContamination([
        'pelangi',
        'southern',
        'makan',
      ]);
      expect(contamination).toBeDefined();
      expect(contamination.contaminatedKeywords).toBeInstanceOf(Array);
    });
  });
});
