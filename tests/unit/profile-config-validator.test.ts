/**
 * Test suite for Profile Configuration Integrity Validator (US-592)
 *
 * Tests cover:
 * - Missing intent references in routing.json
 * - Orphaned workflow steps (steps referencing non-existent next steps)
 * - Broken workflow references (routing pointing to non-existent workflows)
 * - Unused workflows
 * - Unused intent definitions
 * - Non-fatal startup validation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  ValidationReport,
  generateAuditReport,
  formatAuditReportAsJson,
} from '../../src/lib/profile-config-validator.js';

describe('ProfileConfigValidator', () => {
  let testDataDir: string;
  let profilesList: Array<{ id: string; dataDir: string; enabled: boolean }> = [];

  beforeAll(() => {
    // Create temporary directory for test data
    testDataDir = join(tmpdir(), `test-profiles-${Date.now()}`);
    mkdirSync(testDataDir, { recursive: true });
    profilesList = [];
  });

  afterAll(() => {
    // Clean up
    rmSync(testDataDir, { recursive: true, force: true });
  });

  function writeProfilesJson(): void {
    const profilesJson = {
      profiles: profilesList,
      defaultProfileId: profilesList.length > 0 ? profilesList[0].id : null,
    };
    writeFileSync(
      join(testDataDir, 'profiles.json'),
      JSON.stringify(profilesJson, null, 2)
    );
  }

  function createTestProfile(
    profileName: string,
    data: Record<string, any>
  ): void {
    const profileDir = join(testDataDir, profileName);
    mkdirSync(profileDir, { recursive: true });

    // Register profile in profiles list
    if (!profilesList.find(p => p.id === profileName)) {
      profilesList.push({
        id: profileName,
        dataDir: profileName,
        enabled: true,
      });
      writeProfilesJson();
    }

    if (data.intentKeywords) {
      writeFileSync(
        join(profileDir, 'intent-keywords.json'),
        JSON.stringify(data.intentKeywords, null, 2)
      );
    }
    if (data.workflows) {
      writeFileSync(
        join(profileDir, 'workflows.json'),
        JSON.stringify(data.workflows, null, 2)
      );
    }
    if (data.routing) {
      writeFileSync(
        join(profileDir, 'routing.json'),
        JSON.stringify(data.routing, null, 2)
      );
    }
    if (data.intents) {
      writeFileSync(
        join(profileDir, 'intents.json'),
        JSON.stringify(data.intents, null, 2)
      );
    }
  }

  describe('Missing Intent References', () => {
    it('should detect missing intent in routing.json and intents.json', () => {
      const profileName = 'test-missing-intent';

      createTestProfile(profileName, {
        intentKeywords: {
          intents: [
            { intent: 'greeting', keywords: { en: ['hi'] } },
            { intent: 'undefined_intent', keywords: { en: ['test'] } }, // No routing, no category
          ],
        },
        workflows: {
          workflows: [],
        },
        routing: {
          greeting: { action: 'static_reply' },
        },
        intents: {
          categories: [
            {
              phase: 'GENERAL',
              intents: [
                { category: 'greeting', patterns: [] },
              ],
            },
          ],
        },
      });

      const reports = generateAuditReport(testDataDir);
      const report = reports.find(r => r.profile === profileName);

      expect(report).toBeDefined();
      expect(report?.isValid).toBe(false);
      expect(report?.missingIntentRefs.length).toBeGreaterThan(0);
      expect(
        report?.missingIntentRefs.some(ref => ref.intent === 'undefined_intent')
      ).toBe(true);
    });
  });

  describe('Broken Workflow References', () => {
    it('should detect workflow_id that does not exist in workflows.json', () => {
      const profileName = 'test-broken-workflow';

      createTestProfile(profileName, {
        intentKeywords: {
          intents: [
            { intent: 'booking', keywords: { en: ['book'] } },
          ],
        },
        workflows: {
          workflows: [
            {
              id: 'booking_flow',
              name: 'Booking Flow',
              steps: [{ id: 'step1', message: { en: 'Hi' } }],
            },
          ],
        },
        routing: {
          booking: {
            action: 'workflow',
            workflow_id: 'nonexistent_workflow', // Does not exist
          },
        },
        intents: {
          categories: [
            {
              phase: 'PRE_ARRIVAL',
              intents: [
                { category: 'booking', patterns: [] },
              ],
            },
          ],
        },
      });

      const reports = generateAuditReport(testDataDir);
      const report = reports.find(r => r.profile === profileName);

      expect(report).toBeDefined();
      expect(report?.isValid).toBe(false);
      expect(report?.brokenWorkflowRefs.length).toBeGreaterThan(0);
      expect(
        report?.brokenWorkflowRefs.some(
          ref => ref.workflowId === 'nonexistent_workflow'
        )
      ).toBe(true);
    });
  });

  describe('Orphaned Workflow Steps', () => {
    it('should detect steps with next reference to non-existent steps', () => {
      const profileName = 'test-orphaned-steps';

      createTestProfile(profileName, {
        intentKeywords: {
          intents: [
            { intent: 'checkout', keywords: { en: ['checkout'] } },
          ],
        },
        workflows: {
          workflows: [
            {
              id: 'checkout_flow',
              name: 'Checkout Flow',
              steps: [
                {
                  id: 'step1',
                  message: { en: 'Ready?' },
                  next: 'step2', // Points to non-existent step
                },
                {
                  id: 'step3',
                  message: { en: 'Done' },
                },
              ],
            },
          ],
        },
        routing: {
          checkout: { action: 'workflow', workflow_id: 'checkout_flow' },
        },
        intents: {
          categories: [
            {
              phase: 'CHECKOUT',
              intents: [
                { category: 'checkout', patterns: [] },
              ],
            },
          ],
        },
      });

      const reports = generateAuditReport(testDataDir);
      const report = reports.find(r => r.profile === profileName);

      expect(report).toBeDefined();
      expect(report?.isValid).toBe(false);
      expect(report?.orphanedWorkflowSteps.length).toBeGreaterThan(0);
      expect(
        report?.orphanedWorkflowSteps.some(
          step => step.workflowId === 'checkout_flow' && step.stepId === 'step1'
        )
      ).toBe(true);
    });
  });

  describe('Unused Workflows', () => {
    it('should detect workflows not referenced in routing.json', () => {
      const profileName = 'test-unused-workflows';

      createTestProfile(profileName, {
        intentKeywords: {
          intents: [
            { intent: 'greeting', keywords: { en: ['hi'] } },
          ],
        },
        workflows: {
          workflows: [
            {
              id: 'greeting_flow',
              name: 'Greeting',
              steps: [{ id: 'step1', message: { en: 'Hello' } }],
            },
            {
              id: 'unused_flow',
              name: 'Never Used',
              steps: [{ id: 'step1', message: { en: 'Test' } }],
            },
          ],
        },
        routing: {
          greeting: { action: 'workflow', workflow_id: 'greeting_flow' },
        },
        intents: {
          categories: [
            {
              phase: 'GENERAL',
              intents: [
                { category: 'greeting', patterns: [] },
              ],
            },
          ],
        },
      });

      const reports = generateAuditReport(testDataDir);
      const report = reports.find(r => r.profile === profileName);

      expect(report).toBeDefined();
      expect(report?.unusedWorkflows).toContain('unused_flow');
    });
  });

  describe('Unused Intent Definitions', () => {
    it('should detect intent keywords not used in routing or intents.json', () => {
      const profileName = 'test-unused-intents';

      createTestProfile(profileName, {
        intentKeywords: {
          intents: [
            { intent: 'greeting', keywords: { en: ['hi'] } },
            { intent: 'unused_intent', keywords: { en: ['xyz'] } },
          ],
        },
        workflows: {
          workflows: [],
        },
        routing: {
          greeting: { action: 'static_reply' },
        },
        intents: {
          categories: [
            {
              phase: 'GENERAL',
              intents: [
                { category: 'greeting', patterns: [] },
              ],
            },
          ],
        },
      });

      const reports = generateAuditReport(testDataDir);
      const report = reports.find(r => r.profile === profileName);

      expect(report).toBeDefined();
      expect(report?.unusedIntentDefinitions).toContain('unused_intent');
    });
  });

  describe('Clean Configuration', () => {
    it('should pass validation for clean configuration', () => {
      const profileName = 'test-clean';

      createTestProfile(profileName, {
        intentKeywords: {
          intents: [
            { intent: 'greeting', keywords: { en: ['hi'] } },
            { intent: 'booking', keywords: { en: ['book'] } },
          ],
        },
        workflows: {
          workflows: [
            {
              id: 'booking_flow',
              name: 'Booking Flow',
              steps: [
                { id: 'step1', message: { en: 'Name?' }, next: 'step2' },
                { id: 'step2', message: { en: 'Email?' } },
              ],
            },
          ],
        },
        routing: {
          greeting: { action: 'static_reply' },
          booking: { action: 'workflow', workflow_id: 'booking_flow' },
        },
        intents: {
          categories: [
            {
              phase: 'GENERAL',
              intents: [
                { category: 'greeting', patterns: [] },
              ],
            },
            {
              phase: 'PRE_ARRIVAL',
              intents: [
                { category: 'booking', patterns: [] },
              ],
            },
          ],
        },
      });

      const reports = generateAuditReport(testDataDir);
      const report = reports.find(r => r.profile === profileName);

      expect(report).toBeDefined();
      expect(report?.isValid).toBe(true);
      expect(report?.missingIntentRefs.length).toBe(0);
      expect(report?.brokenWorkflowRefs.length).toBe(0);
      expect(report?.orphanedWorkflowSteps.length).toBe(0);
    });
  });

  describe('JSON Report Formatting', () => {
    it('should format audit report as valid JSON with summary', () => {
      const profileName = 'test-json-format';

      createTestProfile(profileName, {
        intentKeywords: {
          intents: [
            { intent: 'greeting', keywords: { en: ['hi'] } },
          ],
        },
        workflows: {
          workflows: [
            {
              id: 'greeting_flow',
              name: 'Greeting',
              steps: [{ id: 'step1', message: { en: 'Hello' } }],
            },
          ],
        },
        routing: {
          greeting: { action: 'workflow', workflow_id: 'greeting_flow' },
        },
        intents: {
          categories: [
            {
              phase: 'GENERAL',
              intents: [
                { category: 'greeting', patterns: [] },
              ],
            },
          ],
        },
      });

      const reports = generateAuditReport(testDataDir);
      const jsonString = formatAuditReportAsJson(reports);

      // Should be valid JSON
      const parsed = JSON.parse(jsonString);

      expect(parsed).toBeDefined();
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.totalProfiles).toBeGreaterThan(0);
      expect(parsed.profilesWithIssues).toBeDefined();
      expect(parsed.totalIssues).toBeDefined();
      expect(Array.isArray(parsed.profiles)).toBe(true);
    });
  });

  describe('Multiple Profiles', () => {
    it('should validate multiple profiles independently', () => {
      createTestProfile('profile-a', {
        intentKeywords: {
          intents: [
            { intent: 'greeting', keywords: { en: ['hi'] } },
          ],
        },
        workflows: {
          workflows: [],
        },
        routing: {
          greeting: { action: 'static_reply' },
        },
        intents: {
          categories: [
            {
              phase: 'GENERAL',
              intents: [
                { category: 'greeting', patterns: [] },
              ],
            },
          ],
        },
      });

      createTestProfile('profile-b', {
        intentKeywords: {
          intents: [
            { intent: 'booking', keywords: { en: ['book'] } },
            { intent: 'undefined', keywords: { en: ['xyz'] } },
          ],
        },
        workflows: {
          workflows: [],
        },
        routing: {
          booking: { action: 'static_reply' },
        },
        intents: {
          categories: [
            {
              phase: 'PRE_ARRIVAL',
              intents: [
                { category: 'booking', patterns: [] },
              ],
            },
          ],
        },
      });

      const reports = generateAuditReport(testDataDir);

      const profileA = reports.find(r => r.profile === 'profile-a');
      const profileB = reports.find(r => r.profile === 'profile-b');

      expect(profileA).toBeDefined();
      expect(profileB).toBeDefined();

      expect(profileA?.isValid).toBe(true);
      expect(profileB?.isValid).toBe(false); // Has unused intent 'undefined'
      expect(profileB?.unusedIntentDefinitions).toContain('undefined');
    });
  });
});
