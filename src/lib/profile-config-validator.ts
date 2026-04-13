/**
 * Profile Configuration Integrity Validator (US-592)
 *
 * Validates referential integrity across profile configuration files:
 * - workflows.json: workflow steps, actions, and references
 * - routing.json: intent -> workflow/action mappings
 * - intent-keywords.json: intent definitions and keywords
 * - intents.json: intent categories and patterns
 *
 * Runs at server startup (non-fatal warnings) and via CLI audit tool (JSON report).
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Structure for validation report
 */
export interface ValidationReport {
  profile: string;
  isValid: boolean;
  missingIntentRefs: Array<{
    intent: string;
    referencedBy: 'routing' | 'workflows';
  }>;
  orphanedWorkflowSteps: Array<{
    workflowId: string;
    stepId: string;
    reason: string;
  }>;
  brokenWorkflowRefs: Array<{
    intent: string;
    workflowId: string;
    reason: string;
  }>;
  unusedWorkflows: string[];
  unusedIntentDefinitions: string[];
  unusedProfiles: string[];
}

/**
 * Loads JSON file safely
 */
function loadJsonFile(filePath: string): any {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.warn(
      `[ProfileConfigValidator] Warning: Could not load ${filePath}:`,
      (error as Error).message
    );
    return null;
  }
}

/**
 * Gets all profile directories from profiles.json
 */
function getProfilesFromJson(projectRoot: string): Array<{ id: string; dataDir: string }> {
  const profiles: Array<{ id: string; dataDir: string }> = [];

  try {
    const profilesJsonPath = join(projectRoot, 'profiles.json');
    if (!existsSync(profilesJsonPath)) {
      console.warn('[ProfileConfigValidator] Warning: profiles.json not found at', profilesJsonPath);
      return [];
    }

    const profilesData = loadJsonFile(profilesJsonPath);
    if (profilesData && Array.isArray(profilesData.profiles)) {
      profilesData.profiles.forEach((profile: any) => {
        if (profile.id && profile.dataDir && profile.enabled !== false) {
          profiles.push({
            id: profile.id,
            dataDir: join(projectRoot, profile.dataDir),
          });
        }
      });
    }
  } catch (error) {
    console.warn(
      '[ProfileConfigValidator] Warning: Could not load profiles.json:',
      (error as Error).message
    );
  }

  return profiles;
}

/**
 * Validates a single profile's configuration
 */
function validateProfile(
  profileId: string,
  profileDataDir: string
): ValidationReport {
  const report: ValidationReport = {
    profile: profileId,
    isValid: true,
    missingIntentRefs: [],
    orphanedWorkflowSteps: [],
    brokenWorkflowRefs: [],
    unusedWorkflows: [],
    unusedIntentDefinitions: [],
    unusedProfiles: [],
  };

  // Load files from profile's data directory
  const intentKeywordsPath = join(profileDataDir, 'intent-keywords.json');
  const workflowsPath = join(profileDataDir, 'workflows.json');
  const routingPath = join(profileDataDir, 'routing.json');
  const intentsPath = join(profileDataDir, 'intents.json');

  const intentKeywords = loadJsonFile(intentKeywordsPath) || { intents: [] };
  const workflows = loadJsonFile(workflowsPath) || { workflows: [] };
  const routing = loadJsonFile(routingPath) || {};
  const intents = loadJsonFile(intentsPath) || { categories: [] };

  // Extract all intent definitions
  const definedIntents = new Set<string>();
  if (intentKeywords.intents) {
    intentKeywords.intents.forEach((item: any) => {
      if (item.intent) {
        definedIntents.add(item.intent);
      }
    });
  }

  // Extract all intent categories from intents.json
  const intentCategories = new Set<string>();
  if (intents.categories) {
    intents.categories.forEach((category: any) => {
      if (category.intents) {
        category.intents.forEach((intent: any) => {
          if (intent.category) {
            intentCategories.add(intent.category);
          }
        });
      }
    });
  }

  // Check all defined intents against routing and categories
  definedIntents.forEach(intent => {
    if (!intentCategories.has(intent) && !routing[intent]) {
      report.missingIntentRefs.push({
        intent,
        referencedBy: 'routing',
      });
      report.isValid = false;
    }
  });

  // Extract all workflow IDs
  const workflowIds = new Set<string>();
  if (workflows.workflows) {
    workflows.workflows.forEach((wf: any) => {
      if (wf.id) {
        workflowIds.add(wf.id);
      }
    });
  }

  // Check routing references
  const referencedWorkflows = new Set<string>();
  Object.entries(routing).forEach(([intentId, route]: [string, any]) => {
    if (route.action === 'workflow' && route.workflow_id) {
      referencedWorkflows.add(route.workflow_id);

      if (!workflowIds.has(route.workflow_id)) {
        report.brokenWorkflowRefs.push({
          intent: intentId,
          workflowId: route.workflow_id,
          reason: `Workflow '${route.workflow_id}' not found in workflows.json`,
        });
        report.isValid = false;
      }
    }
  });

  // Find unused workflows
  workflowIds.forEach(wfId => {
    if (!referencedWorkflows.has(wfId)) {
      report.unusedWorkflows.push(wfId);
    }
  });

  // Check for orphaned workflow steps (steps that reference next steps that don't exist)
  if (workflows.workflows) {
    workflows.workflows.forEach((wf: any) => {
      if (!wf.steps || !Array.isArray(wf.steps)) return;

      const stepIds = new Set<string>();
      wf.steps.forEach((step: any) => {
        if (step.id) {
          stepIds.add(step.id);
        }
      });

      wf.steps.forEach((step: any) => {
        if (step.next && !stepIds.has(step.next)) {
          report.orphanedWorkflowSteps.push({
            workflowId: wf.id,
            stepId: step.id || 'unknown',
            reason: `Next step '${step.next}' does not exist in workflow`,
          });
          report.isValid = false;
        }
      });
    });
  }

  // Find unused intent definitions
  const usedIntents = new Set<string>(intentCategories);
  Object.keys(routing).forEach(intent => {
    usedIntents.add(intent);
  });

  definedIntents.forEach(intent => {
    if (!usedIntents.has(intent)) {
      report.unusedIntentDefinitions.push(intent);
    }
  });

  return report;
}

/**
 * Validates all profiles' configurations (called at startup)
 * Logs warnings but does not throw errors (non-fatal)
 */
export async function validateProfileConfigs(): Promise<void> {
  const projectRoot = join(__dirname, '..', '..');

  console.log('[ProfileConfigValidator] Starting validation...');

  try {
    const profiles = getProfilesFromJson(projectRoot);

    if (profiles.length === 0) {
      console.warn(
        '[ProfileConfigValidator] No profiles found in profiles.json'
      );
      return;
    }

    let hasIssues = false;

    for (const profile of profiles) {
      const report = validateProfile(profile.id, profile.dataDir);

      if (!report.isValid) {
        hasIssues = true;
        console.warn(`[ProfileConfigValidator] Issues found in profile '${profile.id}':`);

        if (report.missingIntentRefs.length > 0) {
          console.warn(
            `  ⚠ Missing intent references (${report.missingIntentRefs.length}):`
          );
          report.missingIntentRefs.slice(0, 3).forEach(ref => {
            console.warn(`    - Intent '${ref.intent}' not found`);
          });
          if (report.missingIntentRefs.length > 3) {
            console.warn(
              `    ... and ${report.missingIntentRefs.length - 3} more`
            );
          }
        }

        if (report.brokenWorkflowRefs.length > 0) {
          console.warn(
            `  ⚠ Broken workflow references (${report.brokenWorkflowRefs.length}):`
          );
          report.brokenWorkflowRefs.slice(0, 3).forEach(ref => {
            console.warn(
              `    - Intent '${ref.intent}' → workflow '${ref.workflowId}' (${ref.reason})`
            );
          });
          if (report.brokenWorkflowRefs.length > 3) {
            console.warn(
              `    ... and ${report.brokenWorkflowRefs.length - 3} more`
            );
          }
        }

        if (report.orphanedWorkflowSteps.length > 0) {
          console.warn(
            `  ⚠ Orphaned workflow steps (${report.orphanedWorkflowSteps.length}):`
          );
          report.orphanedWorkflowSteps.slice(0, 3).forEach(step => {
            console.warn(
              `    - Workflow '${step.workflowId}' step '${step.stepId}' (${step.reason})`
            );
          });
          if (report.orphanedWorkflowSteps.length > 3) {
            console.warn(
              `    ... and ${report.orphanedWorkflowSteps.length - 3} more`
            );
          }
        }
      } else {
        console.log(
          `✓ Profile '${profile.id}' configuration integrity verified`
        );
      }
    }

    if (hasIssues) {
      console.warn(
        '[ProfileConfigValidator] ⚠ Some profiles have configuration issues. Run `npm run audit:profile-config` for detailed report.'
      );
    }
  } catch (error) {
    console.warn(
      '[ProfileConfigValidator] Error during validation:',
      (error as Error).message
    );
  }
}

/**
 * Generates detailed audit report for all profiles (used by CLI tool)
 * projectRoot: path to project root (where profiles.json is located)
 */
export function generateAuditReport(projectRoot: string): ValidationReport[] {
  const profiles = getProfilesFromJson(projectRoot);
  const reports = profiles.map(profile => validateProfile(profile.id, profile.dataDir));

  return reports;
}

/**
 * Formats audit report as JSON
 */
export function formatAuditReportAsJson(reports: ValidationReport[]): string {
  const summary = {
    timestamp: new Date().toISOString(),
    totalProfiles: reports.length,
    profilesWithIssues: reports.filter(r => !r.isValid).length,
    totalIssues: reports.reduce(
      (sum, r) =>
        sum +
        r.missingIntentRefs.length +
        r.brokenWorkflowRefs.length +
        r.orphanedWorkflowSteps.length,
      0
    ),
    profiles: reports,
  };

  return JSON.stringify(summary, null, 2);
}
