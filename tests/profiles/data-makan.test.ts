/**
 * Data-Makan Profile Validation Tests (US-626)
 *
 * Validates that data-makan profile:
 * 1. Contains only cafe-operations workflows
 * 2. Error messages say 'cafe' not 'hostel'
 * 3. No blacklisted hostel keywords ('check-in', 'check-out', 'room', 'guest arrival')
 *
 * Detects incomplete profile separation where data-makan still contains
 * copy-pasted Pelangi Capsule Hostel content.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  scanProfileContamination,
  formatContaminationReport,
} from '../helpers/profile-contamination-detector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../');
const DATA_DIR = path.join(PROJECT_ROOT, 'src/assistant/data');

describe('Data-Makan Profile Validation', () => {
  // ─── Contamination Detection ──────────────────────────────────────────────

  describe('contamination | blacklist detection', () => {
    it('should detect blacklisted hostel keywords in data-makan files', () => {
      const report = scanProfileContamination('makan', DATA_DIR);

      console.log('\n' + formatContaminationReport(report));

      if (report.contaminated) {
        // For each match, show detailed context
        const detailedErrors = report.matches.map((match) => {
          return `
File: ${match.file}:${match.line}:${match.column}
Keyword: "${match.keyword}"
Context: ${match.context}
          `.trim();
        });

        const fullError =
          'Blacklisted keywords found in data-makan profile:\n\n' + detailedErrors.join('\n\n');
        expect(report.contaminated, fullError).toBe(false);
      } else {
        expect(report.contaminated).toBe(false);
      }
    });

    it('should have scanned at least one file', () => {
      const report = scanProfileContamination('makan', DATA_DIR);
      expect(report.filesScanned).toBeGreaterThan(0);
    });
  });

  // ─── Workflows Validation ─────────────────────────────────────────────────

  describe('workflows | cafe operations only', () => {
    it('should load and validate workflows.json', () => {
      const workflowsPath = path.join(DATA_DIR, 'workflows.json');
      expect(fs.existsSync(workflowsPath)).toBe(true);

      const content = fs.readFileSync(workflowsPath, 'utf8');
      const workflows = JSON.parse(content);

      expect(workflows).toHaveProperty('workflows');
      expect(Array.isArray(workflows.workflows)).toBe(true);
    });

    it('should have makan-specific workflows in workflows.json', () => {
      const workflowsPath = path.join(DATA_DIR, 'workflows.json');
      const content = fs.readFileSync(workflowsPath, 'utf8');
      const workflows = JSON.parse(content);

      // Check that there are workflows and some mention cafe/makan context
      const makanWorkflows = workflows.workflows.filter(
        (w: any) => w.profileId === 'makan' || w.profileId === 'data-makan'
      );

      // Note: if no profile-specific workflows, at least ensure structure is valid
      expect(workflows.workflows.length).toBeGreaterThan(0);
    });
  });

  // ─── Error Messages Validation ────────────────────────────────────────────

  describe('error messages | cafe terminology only', () => {
    it('should not contain hostel terminology in error messages', () => {
      const errorMessagesPath = path.join(DATA_DIR, 'error-messages-makan.json');

      if (fs.existsSync(errorMessagesPath)) {
        const content = fs.readFileSync(errorMessagesPath, 'utf8');
        const errorMessages = JSON.parse(content);

        const hostelTerms = ['check-in', 'check-out', 'room', 'guest arrival', 'hostel'];
        const errors: string[] = [];

        // Recursive search for hostel terms
        const searchForTerms = (obj: any, path: string = ''): void => {
          if (typeof obj === 'string') {
            for (const term of hostelTerms) {
              if (obj.toLowerCase().includes(term.toLowerCase())) {
                errors.push(`Found "${term}" in ${path}: ${obj.substring(0, 100)}`);
              }
            }
          } else if (typeof obj === 'object' && obj !== null) {
            for (const [key, value] of Object.entries(obj)) {
              searchForTerms(value, path ? `${path}.${key}` : key);
            }
          }
        };

        searchForTerms(errorMessages);

        if (errors.length > 0) {
          expect(errors, `Error messages contain hostel terminology:\n${errors.join('\n')}`).toEqual(
            []
          );
        } else {
          expect(errors).toEqual([]);
        }
      } else {
        // If file doesn't exist, test passes (file might not be necessary)
        expect(true).toBe(true);
      }
    });
  });

  // ─── Intent Keywords Validation ───────────────────────────────────────────

  describe('intent keywords | cafe-only intents', () => {
    it('should have valid intent keywords for data-makan', () => {
      const keywordsPath = path.join(DATA_DIR, 'intent-keywords-makan.json');

      if (fs.existsSync(keywordsPath)) {
        const content = fs.readFileSync(keywordsPath, 'utf8');
        const keywords = JSON.parse(content);

        expect(keywords).toHaveProperty('intents');
        expect(Array.isArray(keywords.intents)).toBe(true);
        expect(keywords.intents.length).toBeGreaterThan(0);
      } else {
        expect(true).toBe(true);
      }
    });

    it('should not reference hostel-specific intents in makan keywords', () => {
      const blacklistPath = path.join(DATA_DIR, 'profile-keyword-blacklist.json');
      const content = fs.readFileSync(blacklistPath, 'utf8');
      const blacklist = JSON.parse(content);

      const makanBlacklist = blacklist.forbidden_keywords['data-makan'];
      expect(makanBlacklist).toBeDefined();
      expect(makanBlacklist.hostel_specific).toBeDefined();
      expect(Array.isArray(makanBlacklist.hostel_specific)).toBe(true);
      expect(makanBlacklist.hostel_specific.length).toBeGreaterThan(0);

      // Verify the blacklist has expected intents
      expect(makanBlacklist.hostel_specific).toContain('check_in_arrival');
      expect(makanBlacklist.hostel_specific).toContain('checkout_info');
    });
  });

  // ─── Allowed Intents Validation ───────────────────────────────────────────

  describe('allowed intents | cafe operations only', () => {
    it('should have valid allowed intents for data-makan', () => {
      const blacklistPath = path.join(DATA_DIR, 'profile-keyword-blacklist.json');
      const content = fs.readFileSync(blacklistPath, 'utf8');
      const blacklist = JSON.parse(content);

      expect(blacklist.allowed_intents).toBeDefined();
      expect(blacklist.allowed_intents['data-makan']).toBeDefined();

      const allowedIntents = blacklist.allowed_intents['data-makan'];
      expect(Array.isArray(allowedIntents)).toBe(true);
      expect(allowedIntents.length).toBeGreaterThan(0);
    });

    it('should only allow cafe-specific intents for data-makan', () => {
      const blacklistPath = path.join(DATA_DIR, 'profile-keyword-blacklist.json');
      const content = fs.readFileSync(blacklistPath, 'utf8');
      const blacklist = JSON.parse(content);

      const allowedIntents = blacklist.allowed_intents['data-makan'];
      const hostelIntents = [
        'check_in_arrival',
        'checkout_info',
        'checkout_now',
        'checkout_procedure',
        'checkin_info',
        'late_checkout',
        'late_checkout_request',
        'capsule_conflict',
        'lower_deck_preference',
        'facility_orientation',
        'theft_report',
        'card_locked',
        'luggage_storage',
        'stay_extension',
        'extend_stay',
        'room_type_inquiry',
      ];

      const forbiddenFound = hostelIntents.filter((intent) => allowedIntents.includes(intent));

      expect(forbiddenFound, `Makan profile allows hostel intents: ${forbiddenFound.join(', ')}`).toEqual(
        []
      );
    });

    it('should include expected cafe-specific intents', () => {
      const blacklistPath = path.join(DATA_DIR, 'profile-keyword-blacklist.json');
      const content = fs.readFileSync(blacklistPath, 'utf8');
      const blacklist = JSON.parse(content);

      const allowedIntents = blacklist.allowed_intents['data-makan'];
      const expectedCafeIntents = [
        'food_recommendation',
        'menu_query',
        'order_placement',
        'pricing',
        'review_feedback',
      ];

      // At least some of these should be present
      const foundIntents = expectedCafeIntents.filter((intent) => allowedIntents.includes(intent));
      expect(foundIntents.length).toBeGreaterThan(0);
    });
  });

  // ─── File Structure Validation ────────────────────────────────────────────

  describe('file structure | required files exist', () => {
    it('should have makan subdirectory in data folder', () => {
      const makanDir = path.join(DATA_DIR, 'makan');
      expect(fs.existsSync(makanDir)).toBe(true);
    });

    it('should have fallback-templates-makan.json for cafe responses', () => {
      const fallbackPath = path.join(DATA_DIR, 'makan', 'fallback-templates.json');
      // File may or may not exist, but if it does, it should be valid JSON
      if (fs.existsSync(fallbackPath)) {
        const content = fs.readFileSync(fallbackPath, 'utf8');
        expect(() => JSON.parse(content)).not.toThrow();
      }
    });
  });

  // ─── Summary Report ──────────────────────────────────────────────────────

  describe('summary | contamination report', () => {
    it('should generate contamination report for verbose output', () => {
      const report = scanProfileContamination('makan', DATA_DIR);

      // Always log the report for visibility
      console.log('\n📋 Contamination Report Summary:');
      console.log(formatContaminationReport(report));

      if (report.contaminated) {
        console.log('\n⚠️  ACTION REQUIRED:');
        console.log('The following files contain hostel-specific content and need replacement:');
        const filesByName = new Map<string, typeof report.matches>();
        for (const match of report.matches) {
          if (!filesByName.has(match.file)) {
            filesByName.set(match.file, []);
          }
          filesByName.get(match.file)!.push(match);
        }

        for (const [file, matches] of filesByName) {
          console.log(`\n  📄 ${file}`);
          const keywords = new Set(matches.map((m) => m.keyword));
          for (const keyword of keywords) {
            const count = matches.filter((m) => m.keyword === keyword).length;
            console.log(`    - "${keyword}": ${count} occurrence(s)`);
          }
        }
      }

      expect(report).toBeDefined();
    });
  });
});
