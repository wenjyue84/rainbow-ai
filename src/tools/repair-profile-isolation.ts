/**
 * US-238: Profile Isolation Violations Auto-Repair Tool
 *
 * Detects and automatically repairs data contamination that violates profile isolation rules.
 * Violations include:
 * - Guests (phone numbers) appearing in multiple profiles
 * - Intent keywords in wrong profiles
 * - routing.json intent routes pointing to foreign workflows
 *
 * Repairs are logged to the profile_isolation_repairs table.
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.join(__dirname, '..', '..');

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface Violation {
  id: string;
  type: 'guest_multi_profile' | 'keyword_cross_profile' | 'workflow_foreign_route';
  profileId: string;
  details: Record<string, any>;
}

export interface Repair {
  violationId: string;
  action: 'delete' | 'reassign' | 'flag_for_review';
  details: Record<string, any>;
  applied: boolean;
  reason: string;
}

export interface RepairReport {
  timestamp: string;
  violations_found: number;
  repairs_applied: number;
  repairs_flagged: number;
  violations_by_type: Record<string, number>;
  before_counts: Record<string, Record<string, number>>;
  after_counts: Record<string, Record<string, number>>;
  repairs: Repair[];
}

export interface IntentsFile {
  categories?: Array<{
    phase?: string;
    intents?: Array<{ category?: string; [key: string]: any }>;
  }>;
  [key: string]: any;
}

export interface KeywordsFile {
  intents?: Array<{
    intent: string;
    keywords?: Record<string, string[]>;
  }>;
}

export interface RoutingFile {
  [intent: string]: {
    action: string;
    workflow_id?: string;
    [key: string]: any;
  };
}

export interface WorkflowsFile {
  workflows?: Array<{ id: string; [key: string]: any }>;
}

// ─────────────────────────────────────────────────────────────────────────
// Profile directory mapping
// ─────────────────────────────────────────────────────────────────────────

export const PROFILE_DIRS: Record<string, string> = {
  pelangi: 'src/assistant/data',
  makan: 'src/assistant/data-makan',
  southern: 'src/assistant/data-southern',
};

export function getProfileDir(profile: string): string {
  return PROFILE_DIRS[profile] || `src/assistant/data-${profile}`;
}

// ─────────────────────────────────────────────────────────────────────────
// File loaders (accept rootDir for testability)
// ─────────────────────────────────────────────────────────────────────────

export function loadIntentsFile(rootDir: string, profileDir: string): IntentsFile | null {
  const intentsPath = path.join(rootDir, profileDir, 'intents.json');
  try {
    if (!fs.existsSync(intentsPath)) return null;
    return JSON.parse(fs.readFileSync(intentsPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function loadKeywordsFile(rootDir: string, profileDir: string): KeywordsFile | null {
  const keywordsPath = path.join(rootDir, profileDir, 'intent-keywords.json');
  try {
    if (!fs.existsSync(keywordsPath)) return null;
    return JSON.parse(fs.readFileSync(keywordsPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function loadRoutingFile(rootDir: string, profileDir: string): RoutingFile | null {
  const routingPath = path.join(rootDir, profileDir, 'routing.json');
  try {
    if (!fs.existsSync(routingPath)) return null;
    return JSON.parse(fs.readFileSync(routingPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function loadWorkflowsFile(rootDir: string, profileDir: string): WorkflowsFile | null {
  const workflowsPath = path.join(rootDir, profileDir, 'workflows.json');
  try {
    if (!fs.existsSync(workflowsPath)) return null;
    return JSON.parse(fs.readFileSync(workflowsPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Pure-logic extractors
// ─────────────────────────────────────────────────────────────────────────

export function getProfileIntentIds(intentsFile: IntentsFile | null): Set<string> {
  const ids = new Set<string>();
  if (intentsFile?.categories) {
    for (const phase of intentsFile.categories) {
      if (phase.intents) {
        for (const intent of phase.intents) {
          if (intent.category) {
            ids.add(intent.category);
          }
        }
      }
    }
  }
  return ids;
}

export function getProfileWorkflowIds(workflowsFile: WorkflowsFile | null): Set<string> {
  const ids = new Set<string>();
  if (workflowsFile?.workflows) {
    for (const workflow of workflowsFile.workflows) {
      if (workflow.id) {
        ids.add(workflow.id);
      }
    }
  }
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────
// Detection (pure logic — accept data as parameters)
// ─────────────────────────────────────────────────────────────────────────

export function detectKeywordCrossProfileViolations(
  profileIntents: Record<string, Set<string>>,
  profileKeywordIntents: Record<string, Set<string>>,
  profiles: string[],
): Violation[] {
  const violations: Violation[] = [];

  for (const profile of profiles) {
    const validIntents = profileIntents[profile] || new Set();
    const keywordIntents = profileKeywordIntents[profile] || new Set();

    for (const intent of keywordIntents) {
      if (!validIntents.has(intent)) {
        const intendedProfiles: string[] = [];

        // Find which profile(s) have this intent defined
        for (const otherProfile of profiles) {
          if (otherProfile !== profile && profileIntents[otherProfile]?.has(intent)) {
            intendedProfiles.push(otherProfile);
          }
        }

        violations.push({
          id: `keyword_cross_${profile}_${intent}`,
          type: 'keyword_cross_profile',
          profileId: profile,
          details: {
            intent,
            found_in_profile: profile,
            intended_profiles: intendedProfiles,
          },
        });
      }
    }
  }

  return violations;
}

export function detectWorkflowForeignRouteViolations(
  profileRoutings: Record<string, RoutingFile | null>,
  profileIntents: Record<string, Set<string>>,
  profileWorkflows: Record<string, Set<string>>,
  profiles: string[],
): Violation[] {
  const violations: Violation[] = [];

  for (const profile of profiles) {
    const routing = profileRoutings[profile];
    if (!routing) continue;

    const workflowIds = profileWorkflows[profile] || new Set();

    for (const [intent, config] of Object.entries(routing)) {
      if (intent === 'schema_version') continue;
      if (config.action === 'workflow' && config.workflow_id) {
        const workflowId = config.workflow_id;
        if (!workflowIds.has(workflowId)) {
          violations.push({
            id: `workflow_foreign_${profile}_${intent}`,
            type: 'workflow_foreign_route',
            profileId: profile,
            details: {
              intent,
              workflow_id: workflowId,
              profile,
              reason: `Intent '${intent}' routes to workflow '${workflowId}' but workflow not found in ${profile} profile`,
            },
          });
        }
      }
    }
  }

  return violations;
}

export async function detectGuestMultiProfileViolations(
  pool: Pool,
  profiles: string[],
): Promise<Violation[]> {
  const violations: Violation[] = [];

  try {
    const result = await pool.query(`
      SELECT phone, array_agg(DISTINCT profile_id) as profiles
      FROM rainbow_messages
      WHERE phone IS NOT NULL
      GROUP BY phone
      HAVING array_length(array_agg(DISTINCT profile_id), 1) > 1
      LIMIT 10000;
    `);

    for (const row of result.rows) {
      const primaryProfile = row.profiles[0];
      for (let i = 1; i < row.profiles.length; i++) {
        violations.push({
          id: `guest_multi_${row.phone}_${row.profiles[i]}`,
          type: 'guest_multi_profile',
          profileId: primaryProfile,
          details: {
            phone: row.phone,
            found_in_profiles: row.profiles,
            message_count_per_profile: {},
          },
        });
      }
    }

    // Count messages per profile for each guest
    if (violations.length > 0) {
      const phones = violations.map((v) => v.details.phone).filter(Boolean);
      if (phones.length > 0) {
        const countResult = await pool.query(`
          SELECT phone, profile_id, COUNT(*) as count
          FROM rainbow_messages
          WHERE phone = ANY($1)
          GROUP BY phone, profile_id
        `, [phones]);

        for (const v of violations) {
          v.details.message_count_per_profile = {};
          for (const row of countResult.rows) {
            if (row.phone === v.details.phone) {
              v.details.message_count_per_profile[row.profile_id] = row.count;
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error detecting guest multi-profile violations:', error);
  }

  return violations;
}

// ─────────────────────────────────────────────────────────────────────────
// Repair logic (pure functions)
// ─────────────────────────────────────────────────────────────────────────

export function generateKeywordRepairs(violations: Violation[]): Repair[] {
  const repairs: Repair[] = [];
  const keywordViolations = violations.filter((v) => v.type === 'keyword_cross_profile');

  for (const violation of keywordViolations) {
    const intent = violation.details.intent;
    const profile = violation.profileId;
    const intendedProfiles = violation.details.intended_profiles;

    if (!intent || !profile || intendedProfiles.length === 0) {
      repairs.push({
        violationId: violation.id,
        action: 'flag_for_review',
        details: { intent, profile },
        applied: false,
        reason: `Orphaned keyword '${intent}' in ${profile} but not found in any other profile - manual review needed`,
      });
      continue;
    }

    repairs.push({
      violationId: violation.id,
      action: 'reassign',
      details: {
        intent,
        from_profile: profile,
        to_profiles: intendedProfiles,
        action_required: `Remove intent '${intent}' from ${profile}/intent-keywords.json`,
      },
      applied: false,
      reason: `Cross-profile keyword detected - should be in ${intendedProfiles.join(', ')} not ${profile}`,
    });
  }

  return repairs;
}

export function generateWorkflowRepairs(violations: Violation[]): Repair[] {
  const repairs: Repair[] = [];
  const workflowViolations = violations.filter((v) => v.type === 'workflow_foreign_route');

  for (const violation of workflowViolations) {
    repairs.push({
      violationId: violation.id,
      action: 'flag_for_review',
      details: {
        intent: violation.details.intent,
        workflow_id: violation.details.workflow_id,
        profile: violation.details.profile,
      },
      applied: false,
      reason: violation.details.reason,
    });
  }

  return repairs;
}

export async function applyGuestRepairs(
  pool: Pool,
  violations: Violation[],
): Promise<Repair[]> {
  const repairs: Repair[] = [];
  const guestViolations = violations.filter((v) => v.type === 'guest_multi_profile');

  for (const violation of guestViolations) {
    const phone = violation.details.phone;
    const profiles = violation.details.found_in_profiles;

    if (!phone || !profiles || profiles.length < 2) continue;

    const primaryProfile = profiles[0];

    try {
      for (let i = 1; i < profiles.length; i++) {
        const secondaryProfile = profiles[i];
        const countBefore = await pool.query(
          'SELECT COUNT(*) as count FROM rainbow_messages WHERE phone = $1 AND profile_id = $2',
          [phone, secondaryProfile],
        );

        await pool.query(
          'DELETE FROM rainbow_messages WHERE phone = $1 AND profile_id = $2',
          [phone, secondaryProfile],
        );

        repairs.push({
          violationId: violation.id,
          action: 'delete',
          details: {
            phone,
            deleted_from_profile: secondaryProfile,
            kept_in_profile: primaryProfile,
            message_count_deleted: countBefore.rows[0].count,
          },
          applied: true,
          reason: `Deleted ${countBefore.rows[0].count} messages from ${secondaryProfile} (kept ${primaryProfile})`,
        });
      }
    } catch (error) {
      console.error('Error repairing guest multi-profile violation:', error);
    }
  }

  return repairs;
}

// ─────────────────────────────────────────────────────────────────────────
// Logging repairs to DB
// ─────────────────────────────────────────────────────────────────────────

export async function ensureRepairsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profile_isolation_repairs (
      id SERIAL PRIMARY KEY,
      violation_id TEXT NOT NULL,
      violation_type TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}',
      applied BOOLEAN NOT NULL DEFAULT false,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function logRepairsToDb(pool: Pool, repairs: Repair[], violations: Violation[]): Promise<void> {
  if (repairs.length === 0) return;

  // Build a map from violationId -> violation for quick lookup
  const violationMap = new Map<string, Violation>();
  for (const v of violations) {
    violationMap.set(v.id, v);
  }

  for (const repair of repairs) {
    const violation = violationMap.get(repair.violationId);
    const violationType = violation?.type || 'unknown';
    const profileId = violation?.profileId || 'unknown';

    try {
      await pool.query(
        `INSERT INTO profile_isolation_repairs
         (violation_id, violation_type, profile_id, action, details, applied, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          repair.violationId,
          violationType,
          profileId,
          repair.action,
          JSON.stringify(repair.details),
          repair.applied,
          repair.reason,
        ],
      );
    } catch (error) {
      console.error('Error logging repair to DB:', error);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Load profile data (with injectable rootDir)
// ─────────────────────────────────────────────────────────────────────────

export function loadProfileData(rootDir: string, profiles: string[]) {
  const profileIntents: Record<string, Set<string>> = {};
  const profileKeywordIntents: Record<string, Set<string>> = {};
  const profileRoutings: Record<string, RoutingFile | null> = {};
  const profileWorkflows: Record<string, Set<string>> = {};

  for (const profile of profiles) {
    const profileDir = getProfileDir(profile);

    const intentsFile = loadIntentsFile(rootDir, profileDir);
    profileIntents[profile] = getProfileIntentIds(intentsFile);

    const keywordsFile = loadKeywordsFile(rootDir, profileDir);
    const kwIntents = new Set<string>();
    if (keywordsFile?.intents) {
      for (const item of keywordsFile.intents) {
        if (item.intent) kwIntents.add(item.intent);
      }
    }
    profileKeywordIntents[profile] = kwIntents;

    profileRoutings[profile] = loadRoutingFile(rootDir, profileDir);

    const workflowsFile = loadWorkflowsFile(rootDir, profileDir);
    profileWorkflows[profile] = getProfileWorkflowIds(workflowsFile);
  }

  return { profileIntents, profileKeywordIntents, profileRoutings, profileWorkflows };
}

// ─────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────

export async function repairProfileIsolation(
  pool: Pool,
  profiles: string[] = ['pelangi', 'makan', 'southern'],
  rootDir: string = defaultRootDir,
): Promise<RepairReport> {
  const startTime = Date.now();
  const beforeCounts: Record<string, Record<string, number>> = {};
  const afterCounts: Record<string, Record<string, number>> = {};
  const allViolations: Violation[] = [];
  const allRepairs: Repair[] = [];
  const violationsByType: Record<string, number> = {};

  // Ensure repairs table exists
  await ensureRepairsTable(pool);

  // Get before counts
  for (const profile of profiles) {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM rainbow_messages WHERE profile_id = $1`,
      [profile],
    );
    beforeCounts[profile] = {
      message_count: parseInt(result.rows[0]?.count, 10) || 0,
    };
  }

  // Load profile data from disk
  const { profileIntents, profileKeywordIntents, profileRoutings, profileWorkflows } =
    loadProfileData(rootDir, profiles);

  // Detect violations
  console.log('[REPAIR] Detecting guest multi-profile violations...');
  const guestViolations = await detectGuestMultiProfileViolations(pool, profiles);
  allViolations.push(...guestViolations);

  console.log('[REPAIR] Detecting keyword cross-profile violations...');
  const keywordViolations = detectKeywordCrossProfileViolations(
    profileIntents, profileKeywordIntents, profiles,
  );
  allViolations.push(...keywordViolations);

  console.log('[REPAIR] Detecting workflow foreign route violations...');
  const workflowViolations = detectWorkflowForeignRouteViolations(
    profileRoutings, profileIntents, profileWorkflows, profiles,
  );
  allViolations.push(...workflowViolations);

  // Count violations by type
  for (const v of allViolations) {
    violationsByType[v.type] = (violationsByType[v.type] || 0) + 1;
  }

  // Apply repairs
  console.log('[REPAIR] Repairing guest multi-profile violations...');
  const guestRepairs = await applyGuestRepairs(pool, guestViolations);
  allRepairs.push(...guestRepairs);

  console.log('[REPAIR] Processing keyword cross-profile violations...');
  const keywordRepairs = generateKeywordRepairs(keywordViolations);
  allRepairs.push(...keywordRepairs);

  console.log('[REPAIR] Processing workflow foreign route violations...');
  const workflowRepairs = generateWorkflowRepairs(workflowViolations);
  allRepairs.push(...workflowRepairs);

  // Log all repairs to DB
  await logRepairsToDb(pool, allRepairs, allViolations);

  // Get after counts
  for (const profile of profiles) {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM rainbow_messages WHERE profile_id = $1`,
      [profile],
    );
    afterCounts[profile] = {
      message_count: parseInt(result.rows[0]?.count, 10) || 0,
    };
  }

  const appliedCount = allRepairs.filter((r) => r.applied).length;
  const flaggedCount = allRepairs.filter((r) => !r.applied && r.action === 'flag_for_review').length;

  const report: RepairReport = {
    timestamp: new Date().toISOString(),
    violations_found: allViolations.length,
    repairs_applied: appliedCount,
    repairs_flagged: flaggedCount,
    violations_by_type: violationsByType,
    before_counts: beforeCounts,
    after_counts: afterCounts,
    repairs: allRepairs,
  };

  console.log(`[REPAIR] Complete in ${Date.now() - startTime}ms`);
  console.log(`[REPAIR] Found ${allViolations.length} violations, applied ${appliedCount} repairs, flagged ${flaggedCount}`);

  return report;
}
