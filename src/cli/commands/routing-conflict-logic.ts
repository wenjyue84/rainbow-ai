/**
 * US-332: Intent Routing Table Cross-Profile Contamination Validator — Pure Logic Module
 *
 * Validates that each intent in routing.json maps only to handlers (workflow_ids)
 * that are defined within the same profile's workflows.json. Detects cross-profile
 * contamination in routing configuration before deployment.
 *
 * Pure logic module — core functions accept data as parameters for easy testing.
 * File I/O helpers are separate.
 */

import fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single routing entry from routing.json */
export interface RoutingEntry {
  action: string;
  workflow_id?: string;
  flow_type?: string;
  request_type?: string;
  notes?: string;
}

/** The full routing.json structure — intent key -> routing config */
export type RoutingFile = Record<string, RoutingEntry>;

/** A single workflow entry from workflows.json */
export interface WorkflowEntry {
  id: string;
  name?: string;
  [key: string]: unknown;
}

/** The full workflows.json structure */
export interface WorkflowsFile {
  schema_version?: string;
  workflows: WorkflowEntry[];
}

/** A single cross-profile routing violation */
export interface RoutingViolation {
  intent: string;
  profile: string;
  handler: string;
  file: string;
  line: number;
}

/** The full validation report */
export interface RoutingConflictReport {
  timestamp: string;
  profile: string;
  totalIntents: number;
  totalViolations: number;
  violations: RoutingViolation[];
}

// ---------------------------------------------------------------------------
// Profile configuration
// ---------------------------------------------------------------------------

export interface ProfileConfig {
  label: string;
  dataDir: string;
}

export const PROFILE_CONFIGS: Record<string, ProfileConfig> = {
  pelangi: {
    label: 'Pelangi Capsule Hostel',
    dataDir: 'src/assistant/data',
  },
  southern: {
    label: 'Southern Homestay',
    dataDir: 'src/assistant/data-southern',
  },
  makan: {
    label: 'Makan Moments Cafe',
    dataDir: 'src/assistant/data-makan',
  },
};

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

/** Load and parse a routing.json file from disk. */
export function loadRoutingFile(filePath: string): RoutingFile {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as RoutingFile;
}

/** Load and parse a workflows.json file from disk. */
export function loadWorkflowsFile(filePath: string): WorkflowsFile {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as WorkflowsFile;
}

/**
 * Read a file and return line number where a given key appears in the JSON.
 * Searches for `"<key>"` as a top-level key pattern.
 * Returns 0 if not found.
 */
export function findLineNumber(filePath: string, key: string): number {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const pattern = `"${key}"`;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith(pattern)) {
      return i + 1; // 1-based
    }
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Extract all workflow IDs defined in a workflows file.
 */
export function extractWorkflowIds(workflowsData: WorkflowsFile): Set<string> {
  const ids = new Set<string>();
  for (const workflow of workflowsData.workflows) {
    ids.add(workflow.id);
  }
  return ids;
}

/**
 * Extract all workflow IDs referenced in routing entries.
 * Returns array of {intent, handler} for entries that reference a workflow_id.
 */
export function extractRoutedWorkflows(
  routingData: RoutingFile,
): Array<{ intent: string; handler: string }> {
  const result: Array<{ intent: string; handler: string }> = [];

  for (const [intent, entry] of Object.entries(routingData)) {
    if (entry.action === 'workflow' && entry.workflow_id) {
      result.push({ intent, handler: entry.workflow_id });
    }
  }

  return result;
}

/**
 * Validate routing entries against the profile's own workflow definitions.
 *
 * A violation occurs when a routing entry references a workflow_id that is NOT
 * defined in the same profile's workflows.json but IS defined in another
 * profile's workflows.json — indicating cross-profile contamination.
 *
 * @param profileName - The profile being validated
 * @param routingData - Parsed routing.json for this profile
 * @param ownWorkflows - Workflow IDs defined in this profile's workflows.json
 * @param otherProfileWorkflows - Map of profile name -> Set of workflow IDs for all other profiles
 * @param routingFilePath - Relative path to the routing.json file (for reporting)
 * @param lineFinder - Optional function to look up line numbers
 */
export function validateRoutingConflicts(
  profileName: string,
  routingData: RoutingFile,
  ownWorkflows: Set<string>,
  otherProfileWorkflows: Map<string, Set<string>>,
  routingFilePath: string,
  lineFinder?: (key: string) => number,
): RoutingConflictReport {
  const routedWorkflows = extractRoutedWorkflows(routingData);
  const violations: RoutingViolation[] = [];

  for (const { intent, handler } of routedWorkflows) {
    // If the handler is defined in this profile's own workflows, it's fine
    if (ownWorkflows.has(handler)) {
      continue;
    }

    // Check if the handler belongs to another profile
    let foreignProfile: string | null = null;
    for (const [otherProfile, otherIds] of otherProfileWorkflows) {
      if (otherIds.has(handler)) {
        foreignProfile = otherProfile;
        break;
      }
    }

    // If handler is not in own workflows AND exists in another profile,
    // that's a cross-profile contamination violation
    if (foreignProfile !== null) {
      const line = lineFinder ? lineFinder(intent) : 0;
      violations.push({
        intent,
        profile: profileName,
        handler,
        file: routingFilePath,
        line,
      });
    }

    // If handler is not found anywhere (undefined workflow), that's a
    // different kind of error — we still report it as a violation since
    // it references a handler that doesn't belong to this profile
    if (foreignProfile === null && !ownWorkflows.has(handler)) {
      const line = lineFinder ? lineFinder(intent) : 0;
      violations.push({
        intent,
        profile: profileName,
        handler,
        file: routingFilePath,
        line,
      });
    }
  }

  return {
    timestamp: new Date().toISOString(),
    profile: profileName,
    totalIntents: Object.keys(routingData).length,
    totalViolations: violations.length,
    violations,
  };
}
