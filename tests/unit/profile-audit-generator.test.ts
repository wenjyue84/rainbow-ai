/**
 * Tests for US-493: Profile Data Content Audit Report Generator
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  generateAuditReport,
  generateMigrationChecklist,
  formatAuditReportMarkdown,
  formatMigrationChecklistMarkdown,
} from '../../src/tools/profile-audit-generator.js';

describe('Profile Audit Generator', () => {
  describe('generateAuditReport', () => {
    it('should generate audit report for all profiles', () => {
      const report = generateAuditReport();

      expect(report).toBeDefined();
      expect(report.timestamp).toBeDefined();
      expect(Array.isArray(report.profilesAnalyzed)).toBe(true);
      expect(report.totalIssues).toBeGreaterThanOrEqual(0);
      expect(report.issuesByProfile).toBeDefined();
      expect(report.issuesByFile).toBeDefined();
      expect(report.summary).toBeDefined();
    });

    it('should report summary statistics', () => {
      const report = generateAuditReport();

      expect(report.summary).toHaveProperty('totalFiles');
      expect(report.summary).toHaveProperty('affectedFiles');
      expect(report.summary).toHaveProperty('highConfidenceIssues');
      expect(typeof report.summary.totalFiles).toBe('number');
      expect(typeof report.summary.affectedFiles).toBe('number');
      expect(typeof report.summary.highConfidenceIssues).toBe('number');
    });

    it('should identify contamination issues with proper structure', () => {
      const report = generateAuditReport();

      if (report.totalIssues > 0) {
        const issues = Object.values(report.issuesByProfile).flat();
        expect(issues.length).toBeGreaterThan(0);

        for (const issue of issues) {
          expect(issue).toHaveProperty('profile');
          expect(issue).toHaveProperty('file');
          expect(issue).toHaveProperty('filePath');
          expect(issue).toHaveProperty('entry');
          expect(issue).toHaveProperty('entryType');
          expect(issue).toHaveProperty('contaminantKeywords');
          expect(issue).toHaveProperty('contaminantProfile');
          expect(issue).toHaveProperty('confidence');
          expect(issue).toHaveProperty('lineNumbers');
          expect(issue).toHaveProperty('occurrenceCount');
          expect(issue).toHaveProperty('description');

          // Validate types
          expect(typeof issue.profile).toBe('string');
          expect(typeof issue.file).toBe('string');
          expect(typeof issue.filePath).toBe('string');
          expect(typeof issue.entry).toBe('string');
          expect(Array.isArray(issue.lineNumbers)).toBe(true);
          expect(typeof issue.occurrenceCount).toBe('number');
        }
      }
    });
  });

  describe('generateMigrationChecklist', () => {
    it('should generate migration checklist from audit report', () => {
      const report = generateAuditReport();
      const checklist = generateMigrationChecklist(report);

      expect(checklist).toBeDefined();
      expect(checklist.generatedAt).toBeDefined();
      expect(checklist.totalSteps).toBe(report.totalIssues);
      expect(Array.isArray(checklist.steps)).toBe(true);
    });

    it('should include grep commands in each migration step', () => {
      const report = generateAuditReport();
      const checklist = generateMigrationChecklist(report);

      if (checklist.steps.length > 0) {
        for (const step of checklist.steps) {
          expect(step).toHaveProperty('stepNumber');
          expect(step).toHaveProperty('profile');
          expect(step).toHaveProperty('file');
          expect(step).toHaveProperty('filePath');
          expect(step).toHaveProperty('issue');
          expect(step).toHaveProperty('grepCommand');
          expect(step).toHaveProperty('removalInstructions');
          expect(step).toHaveProperty('verificationCommand');

          // Validate grep command format
          expect(step.grepCommand).toContain('grep');
          expect(step.grepCommand).toContain(step.entry || step.issue);

          // Validate verification command
          expect(step.verificationCommand).toContain('grep');

          // Validate removal instructions
          expect(Array.isArray(step.removalInstructions)).toBe(true);
          expect(step.removalInstructions.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('formatAuditReportMarkdown', () => {
    it('should format audit report as valid markdown', () => {
      const report = generateAuditReport();
      const markdown = formatAuditReportMarkdown(report);

      expect(markdown).toBeDefined();
      expect(typeof markdown).toBe('string');
      expect(markdown).toContain('# Profile Data Audit Report');
      expect(markdown).toContain('## Summary');
      expect(markdown).toContain('## Issues by Profile');
      expect(markdown).toContain('## Files Affected');
    });

    it('should include issue details in markdown', () => {
      const report = generateAuditReport();
      const markdown = formatAuditReportMarkdown(report);

      expect(markdown).toContain('Total Issues Found');
      expect(markdown).toContain('Profiles Analyzed');
      expect(markdown).toContain('High Confidence Issues');

      if (report.totalIssues > 0) {
        expect(markdown).toContain('routing.json');
        expect(markdown).toContain('intent-keywords.json');
      }
    });
  });

  describe('formatMigrationChecklistMarkdown', () => {
    it('should format migration checklist as valid markdown', () => {
      const report = generateAuditReport();
      const checklist = generateMigrationChecklist(report);
      const markdown = formatMigrationChecklistMarkdown(checklist);

      expect(markdown).toBeDefined();
      expect(typeof markdown).toBe('string');
      expect(markdown).toContain('# Profile Data Migration Checklist');
      expect(markdown).toContain('## Migration Steps');
      expect(markdown).toContain('## Verification Checklist');
    });

    it('should include step-by-step instructions', () => {
      const report = generateAuditReport();
      const checklist = generateMigrationChecklist(report);
      const markdown = formatMigrationChecklistMarkdown(checklist);

      if (checklist.steps.length > 0) {
        expect(markdown).toContain('Step 1:');
        expect(markdown).toContain('Removal Instructions:');
        expect(markdown).toContain('Grep Command');
        expect(markdown).toContain('Verification Command');
        expect(markdown).toContain('```bash');
      }
    });
  });

  describe('Integration tests', () => {
    it('should detect pelangi contamination in southern profile', () => {
      const report = generateAuditReport();

      // Check if southern profile has issues
      const southernIssues = report.issuesByProfile['southern'] || [];

      // These are expected contaminations based on the existing audit
      const expectedContaminants = ['checkout_procedure', 'late_checkout', 'forgot_item_post_checkout', 'post_checkout_complaint'];

      const foundContaminants = southernIssues
        .map(issue => issue.entry)
        .filter(entry => expectedContaminants.includes(entry));

      expect(foundContaminants.length).toBeGreaterThan(0);
    });

    it('should provide complete migration checklist for each issue', () => {
      const report = generateAuditReport();
      const checklist = generateMigrationChecklist(report);

      if (report.totalIssues > 0) {
        expect(checklist.steps.length).toBe(report.totalIssues);

        for (const step of checklist.steps) {
          expect(step.stepNumber).toBeGreaterThan(0);
          expect(step.removalInstructions.length).toBeGreaterThanOrEqual(3);
          expect(step.grepCommand.length).toBeGreaterThan(0);
          expect(step.verificationCommand.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
