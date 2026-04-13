/**
 * Tests for Profile Configuration Integrity Validator (US-592)
 *
 * Tests validation of:
 * - Missing intent references
 * - Orphaned workflow steps
 * - Broken workflow references
 * - Unused workflows
 * - Unused intent definitions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  generateAuditReport,
  formatAuditReportAsJson,
  ValidationReport,
} from '../src/lib/profile-config-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'profile-config-validator');

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function setupFixtureDir(profileId: string): string {
  const dir = path.join(FIXTURE_DIR, profileId);
  fs.mkdirSync(dir, { recursive: true });

  // Create profiles.json for this test
  // Note: dataDir is relative to FIXTURE_DIR (the projectRoot passed to generateAuditReport)
  const profilesJson = {
    profiles: [
      {
        id: profileId,
        dataDir: profileId,  // Just the profile name, relative to projectRoot
        enabled: true,
      },
    ],
    defaultProfileId: profileId,
  };
  fs.writeFileSync(path.join(FIXTURE_DIR, 'profiles.json'), JSON.stringify(profilesJson, null, 2));

  return dir;
}

function writeFixture(dir: string, filename: string, content: any) {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(content, null, 2), 'utf8');
}

function cleanupFixtureDir(profileId: string) {
  const dir = path.join(FIXTURE_DIR, profileId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Valid config fixtures ───────────────────────────────────────────────────

const VALID_INTENT_KEYWORDS = {
  intents: [
    {
      intent: 'greeting',
      keywords: { en: ['hello', 'hi'], ms: ['halo'] },
    },
    {
      intent: 'pricing',
      keywords: { en: ['price', 'cost'], ms: ['harga'] },
    },
    {
      intent: 'booking',
      keywords: { en: ['book', 'reserve'], ms: ['pesan'] },
    },
  ],
};

const VALID_WORKFLOWS = {
  workflows: [
    {
      id: 'booking_flow',
      steps: [
        {
          id: 'step_start',
          message: { en: 'Welcome', ms: 'Selamat datang' },
          next: 'step_end',
        },
        {
          id: 'step_end',
          message: { en: 'Done', ms: 'Selesai' },
        },
      ],
    },
    {
      id: 'pricing_flow',
      steps: [
        {
          id: 'step_info',
          message: { en: 'Here is pricing', ms: 'Ini adalah harga' },
        },
      ],
    },
  ],
};

const VALID_ROUTING = {
  greeting: { action: 'static_reply' },
  pricing: { action: 'workflow', workflow_id: 'pricing_flow' },
  booking: { action: 'workflow', workflow_id: 'booking_flow' },
};

const VALID_INTENTS = {
  categories: [
    {
      name: 'customer_service',
      intents: [
        { category: 'greeting' },
        { category: 'pricing' },
        { category: 'booking' },
      ],
    },
  ],
};

// ─── Test cases ──────────────────────────────────────────────────────────────

describe('Profile Configuration Validator', () => {
  afterEach(() => {
    // Clean up all test fixtures
    try {
      const testDirs = fs.readdirSync(FIXTURE_DIR);
      testDirs.forEach(dir => {
        cleanupFixtureDir(dir);
      });
    } catch (error) {
      // Fixture dir might not exist yet, ignore
    }
  });

  describe('AC1: Server startup validation', () => {
    it('should detect valid configuration and not report issues', () => {
      const profileId = 'test-valid-config';
      const dir = setupFixtureDir(profileId);

      // Create a profiles.json with test profile
      const profilesJson = {
        profiles: [{ id: profileId, dataDir: `tests/fixtures/profile-config-validator/${profileId}`, enabled: true }],
        defaultProfileId: profileId,
      };
      fs.writeFileSync(path.join(FIXTURE_DIR, 'profiles.json'), JSON.stringify(profilesJson, null, 2));

      writeFixture(dir, 'intent-keywords.json', VALID_INTENT_KEYWORDS);
      writeFixture(dir, 'workflows.json', VALID_WORKFLOWS);
      writeFixture(dir, 'routing.json', VALID_ROUTING);
      writeFixture(dir, 'intents.json', VALID_INTENTS);

      const reports = generateAuditReport(FIXTURE_DIR);
      const report = reports.find(r => r.profile === profileId);

      expect(report).toBeDefined();
      expect(report?.isValid).toBe(true);
      expect(report?.missingIntentRefs).toHaveLength(0);
      expect(report?.brokenWorkflowRefs).toHaveLength(0);
      expect(report?.orphanedWorkflowSteps).toHaveLength(0);
    });

    it('should detect missing intent references in routing', () => {
      const profileId = 'test-missing-intent';
      const dir = setupFixtureDir(profileId);

      const brokenKeywords = {
        intents: [
          { intent: 'greeting', keywords: { en: ['hello'] } },
          { intent: 'unknown_intent', keywords: { en: ['unknown'] } },
        ],
      };

      writeFixture(dir, 'intent-keywords.json', brokenKeywords);
      writeFixture(dir, 'workflows.json', VALID_WORKFLOWS);
      writeFixture(dir, 'routing.json', VALID_ROUTING);
      writeFixture(dir, 'intents.json', VALID_INTENTS);

      const reports = generateAuditReport(FIXTURE_DIR);
      const report = reports.find(r => r.profile === profileId);

      expect(report).toBeDefined();
      expect(report?.isValid).toBe(false);
      expect(report?.missingIntentRefs.length).toBeGreaterThan(0);
    });

    it('should detect broken workflow references', () => {
      const profileId = 'test-broken-workflow';
      const dir = setupFixtureDir(profileId);

      const brokenRouting = {
        greeting: { action: 'static_reply' },
        booking: { action: 'workflow', workflow_id: 'non_existent_flow' },
      };

      writeFixture(dir, 'intent-keywords.json', VALID_INTENT_KEYWORDS);
      writeFixture(dir, 'workflows.json', VALID_WORKFLOWS);
      writeFixture(dir, 'routing.json', brokenRouting);
      writeFixture(dir, 'intents.json', VALID_INTENTS);

      const reports = generateAuditReport(FIXTURE_DIR);
      const report = reports.find(r => r.profile === profileId);

      expect(report).toBeDefined();
      expect(report?.isValid).toBe(false);
      expect(report?.brokenWorkflowRefs).toContainEqual(
        expect.objectContaining({
          intent: 'booking',
          workflowId: 'non_existent_flow',
        })
      );
    });

    it('should detect orphaned workflow steps (missing next step)', () => {
      const profileId = 'test-orphaned-step';
      const dir = setupFixtureDir(profileId);

      const brokenWorkflows = {
        workflows: [
          {
            id: 'broken_flow',
            steps: [
              {
                id: 'step_start',
                message: { en: 'Start' },
                next: 'step_missing', // This step doesn't exist
              },
            ],
          },
        ],
      };

      writeFixture(dir, 'intent-keywords.json', VALID_INTENT_KEYWORDS);
      writeFixture(dir, 'workflows.json', brokenWorkflows);
      writeFixture(dir, 'routing.json', VALID_ROUTING);
      writeFixture(dir, 'intents.json', VALID_INTENTS);

      const reports = generateAuditReport(FIXTURE_DIR);
      const report = reports.find(r => r.profile === profileId);

      expect(report).toBeDefined();
      expect(report?.isValid).toBe(false);
      expect(report?.orphanedWorkflowSteps).toContainEqual(
        expect.objectContaining({
          workflowId: 'broken_flow',
          stepId: 'step_start',
        })
      );
    });
  });

  describe('AC2: CLI audit tool output', () => {
    it('should generate JSON report with all issue types', () => {
      const profileId = 'test-all-issues';
      const dir = setupFixtureDir(profileId);

      const issuesConfig = {
        intents: [
          { intent: 'greeting', keywords: { en: ['hello'] } },
          { intent: 'missing_intent', keywords: { en: ['missing'] } },
          { intent: 'unused_intent', keywords: { en: ['unused'] } },
        ],
      };

      const issuesWorkflows = {
        workflows: [
          {
            id: 'used_workflow',
            steps: [
              { id: 'step1', message: { en: 'Step 1' }, next: 'missing_step' },
            ],
          },
          {
            id: 'unused_workflow',
            steps: [{ id: 'step1', message: { en: 'Never used' } }],
          },
        ],
      };

      const issuesRouting = {
        greeting: { action: 'workflow', workflow_id: 'used_workflow' },
      };

      writeFixture(dir, 'intent-keywords.json', issuesConfig);
      writeFixture(dir, 'workflows.json', issuesWorkflows);
      writeFixture(dir, 'routing.json', issuesRouting);
      writeFixture(dir, 'intents.json', VALID_INTENTS);

      const reports = generateAuditReport(FIXTURE_DIR);
      const jsonReport = formatAuditReportAsJson(reports);

      expect(jsonReport).toBeDefined();
      const parsed = JSON.parse(jsonReport);

      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('totalProfiles');
      expect(parsed).toHaveProperty('profilesWithIssues');
      expect(parsed).toHaveProperty('totalIssues');
      expect(parsed).toHaveProperty('profiles');
      expect(Array.isArray(parsed.profiles)).toBe(true);
    });

    it('should include missing intent_id refs in audit report', () => {
      const profileId = 'test-missing-intent-ref';
      const dir = setupFixtureDir(profileId);

      const config = {
        intents: [
          { intent: 'greeting', keywords: { en: ['hello'] } },
          { intent: 'orphaned_intent', keywords: { en: ['orphaned'] } },
        ],
      };

      writeFixture(dir, 'intent-keywords.json', config);
      writeFixture(dir, 'workflows.json', VALID_WORKFLOWS);
      writeFixture(dir, 'routing.json', VALID_ROUTING);
      writeFixture(dir, 'intents.json', VALID_INTENTS);

      const reports = generateAuditReport(FIXTURE_DIR);
      const report = reports.find(r => r.profile === profileId);

      expect(report?.missingIntentRefs.length).toBeGreaterThan(0);
    });

    it('should include orphaned workflow steps in audit report', () => {
      const profileId = 'test-orphaned-steps-report';
      const dir = setupFixtureDir(profileId);

      const workflows = {
        workflows: [
          {
            id: 'flow1',
            steps: [
              { id: 'a', message: { en: 'A' }, next: 'b' },
              { id: 'c', message: { en: 'C' } },
            ],
          },
        ],
      };

      writeFixture(dir, 'intent-keywords.json', VALID_INTENT_KEYWORDS);
      writeFixture(dir, 'workflows.json', workflows);
      writeFixture(dir, 'routing.json', VALID_ROUTING);
      writeFixture(dir, 'intents.json', VALID_INTENTS);

      const reports = generateAuditReport(FIXTURE_DIR);
      const report = reports.find(r => r.profile === profileId);

      expect(report?.orphanedWorkflowSteps.length).toBeGreaterThan(0);
      expect(report?.orphanedWorkflowSteps[0]).toHaveProperty('workflowId');
      expect(report?.orphanedWorkflowSteps[0]).toHaveProperty('stepId');
      expect(report?.orphanedWorkflowSteps[0]).toHaveProperty('reason');
    });

    it('should include unused profiles information in report', () => {
      const profileId = 'test-unused-profiles';
      const dir = setupFixtureDir(profileId);

      writeFixture(dir, 'intent-keywords.json', VALID_INTENT_KEYWORDS);
      writeFixture(dir, 'workflows.json', VALID_WORKFLOWS);
      writeFixture(dir, 'routing.json', VALID_ROUTING);
      writeFixture(dir, 'intents.json', VALID_INTENTS);

      const reports = generateAuditReport(FIXTURE_DIR);
      const report = reports.find(r => r.profile === profileId);

      expect(report).toHaveProperty('unusedProfiles');
    });

    it('should include unused intent definitions in report', () => {
      const profileId = 'test-unused-intents';
      const dir = setupFixtureDir(profileId);

      const keywords = {
        intents: [
          { intent: 'greeting', keywords: { en: ['hello'] } },
          { intent: 'unused1', keywords: { en: ['unused'] } },
          { intent: 'unused2', keywords: { en: ['unused'] } },
        ],
      };

      const routing = {
        greeting: { action: 'static_reply' },
      };

      writeFixture(dir, 'intent-keywords.json', keywords);
      writeFixture(dir, 'workflows.json', VALID_WORKFLOWS);
      writeFixture(dir, 'routing.json', routing);
      writeFixture(dir, 'intents.json', VALID_INTENTS);

      const reports = generateAuditReport(FIXTURE_DIR);
      const report = reports.find(r => r.profile === profileId);

      expect(report?.unusedIntentDefinitions.length).toBeGreaterThan(0);
      expect(report?.unusedIntentDefinitions).toContain('unused1');
      expect(report?.unusedIntentDefinitions).toContain('unused2');
    });
  });

  describe('AC3: 100% config issue detection', () => {
    it('should catch all broken references in single profile', () => {
      const profileId = 'test-comprehensive';
      const dir = setupFixtureDir(profileId);

      const keywords = {
        intents: [
          { intent: 'greeting', keywords: { en: ['hello'] } },
          { intent: 'booking', keywords: { en: ['book'] } },
          { intent: 'orphaned_intent', keywords: { en: ['orphaned'] } },
        ],
      };

      const workflows = {
        workflows: [
          {
            id: 'booking_flow',
            steps: [
              { id: 'step1', message: { en: 'Step 1' }, next: 'missing' },
            ],
          },
          {
            id: 'unused_flow',
            steps: [{ id: 'step1', message: { en: 'Unused' } }],
          },
        ],
      };

      const routing = {
        greeting: { action: 'static_reply' },
        booking: { action: 'workflow', workflow_id: 'booking_flow' },
        broken_ref: { action: 'workflow', workflow_id: 'nonexistent' },
      };

      writeFixture(dir, 'intent-keywords.json', keywords);
      writeFixture(dir, 'workflows.json', workflows);
      writeFixture(dir, 'routing.json', routing);
      writeFixture(dir, 'intents.json', VALID_INTENTS);

      const reports = generateAuditReport(FIXTURE_DIR);
      const report = reports.find(r => r.profile === profileId);

      expect(report?.isValid).toBe(false);
      expect(report?.orphanedWorkflowSteps.length).toBeGreaterThan(0);
      expect(report?.brokenWorkflowRefs.length).toBeGreaterThan(0);
      expect(report?.unusedWorkflows.length).toBeGreaterThan(0);
      expect(report?.unusedIntentDefinitions.length).toBeGreaterThan(0);
    });

    it('should validate multiple profiles independently', () => {
      // Profile 1: Valid
      const profile1 = 'test-multi-valid';
      const dir1 = path.join(FIXTURE_DIR, profile1);
      fs.mkdirSync(dir1, { recursive: true });
      writeFixture(dir1, 'intent-keywords.json', VALID_INTENT_KEYWORDS);
      writeFixture(dir1, 'workflows.json', VALID_WORKFLOWS);
      writeFixture(dir1, 'routing.json', VALID_ROUTING);
      writeFixture(dir1, 'intents.json', VALID_INTENTS);

      // Profile 2: Invalid
      const profile2 = 'test-multi-invalid';
      const dir2 = path.join(FIXTURE_DIR, profile2);
      fs.mkdirSync(dir2, { recursive: true });
      const brokenRouting = {
        greeting: { action: 'workflow', workflow_id: 'nonexistent' },
      };
      writeFixture(dir2, 'intent-keywords.json', VALID_INTENT_KEYWORDS);
      writeFixture(dir2, 'workflows.json', VALID_WORKFLOWS);
      writeFixture(dir2, 'routing.json', brokenRouting);
      writeFixture(dir2, 'intents.json', VALID_INTENTS);

      // Create profiles.json with both profiles
      const profilesJson = {
        profiles: [
          {
            id: profile1,
            dataDir: profile1,  // Just the profile name, relative to projectRoot
            enabled: true,
          },
          {
            id: profile2,
            dataDir: profile2,  // Just the profile name, relative to projectRoot
            enabled: true,
          },
        ],
        defaultProfileId: profile1,
      };
      fs.writeFileSync(path.join(FIXTURE_DIR, 'profiles.json'), JSON.stringify(profilesJson, null, 2));

      const reports = generateAuditReport(FIXTURE_DIR);

      const report1 = reports.find(r => r.profile === profile1);
      const report2 = reports.find(r => r.profile === profile2);

      expect(report1?.isValid).toBe(true);
      expect(report2?.isValid).toBe(false);
    });

    it('should handle missing config files gracefully', () => {
      const profileId = 'test-missing-files';
      const dir = setupFixtureDir(profileId);

      // Write only intent-keywords.json, omit others
      writeFixture(dir, 'intent-keywords.json', VALID_INTENT_KEYWORDS);

      const reports = generateAuditReport(FIXTURE_DIR);
      const report = reports.find(r => r.profile === profileId);

      expect(report).toBeDefined();
      expect(Array.isArray(report?.missingIntentRefs)).toBe(true);
    });

    it('should include reason field for all issues', () => {
      const profileId = 'test-issue-reasons';
      const dir = setupFixtureDir(profileId);

      const workflows = {
        workflows: [
          {
            id: 'flow1',
            steps: [{ id: 'a', message: { en: 'A' }, next: 'missing' }],
          },
        ],
      };

      writeFixture(dir, 'intent-keywords.json', VALID_INTENT_KEYWORDS);
      writeFixture(dir, 'workflows.json', workflows);
      writeFixture(dir, 'routing.json', { broken: { action: 'workflow', workflow_id: 'missing' } });
      writeFixture(dir, 'intents.json', VALID_INTENTS);

      const reports = generateAuditReport(FIXTURE_DIR);
      const report = reports.find(r => r.profile === profileId);

      if (report?.orphanedWorkflowSteps.length) {
        expect(report.orphanedWorkflowSteps[0]).toHaveProperty('reason');
        expect(report.orphanedWorkflowSteps[0].reason).toBeTruthy();
      }

      if (report?.brokenWorkflowRefs.length) {
        expect(report.brokenWorkflowRefs[0]).toHaveProperty('reason');
        expect(report.brokenWorkflowRefs[0].reason).toBeTruthy();
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle empty config files', () => {
      const profileId = 'test-empty-configs';
      const dir = setupFixtureDir(profileId);

      writeFixture(dir, 'intent-keywords.json', { intents: [] });
      writeFixture(dir, 'workflows.json', { workflows: [] });
      writeFixture(dir, 'routing.json', {});
      writeFixture(dir, 'intents.json', { categories: [] });

      const reports = generateAuditReport(FIXTURE_DIR);
      const report = reports.find(r => r.profile === profileId);

      expect(report).toBeDefined();
      expect(report?.isValid).toBe(true);
    });

    it('should handle JSON formatting correctly in report', () => {
      const profileId = 'test-json-format';
      const dir = setupFixtureDir(profileId);

      writeFixture(dir, 'intent-keywords.json', VALID_INTENT_KEYWORDS);
      writeFixture(dir, 'workflows.json', VALID_WORKFLOWS);
      writeFixture(dir, 'routing.json', VALID_ROUTING);
      writeFixture(dir, 'intents.json', VALID_INTENTS);

      const reports = generateAuditReport(FIXTURE_DIR);
      const jsonString = formatAuditReportAsJson(reports);

      expect(() => JSON.parse(jsonString)).not.toThrow();

      const parsed = JSON.parse(jsonString);
      expect(parsed.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });
  });
});
