/**
 * US-238: Profile Isolation Violations Auto-Repair Tool
 *
 * Detects and automatically repairs data contamination that violates profile isolation rules.
 * Violations include:
 * - Guests (phone numbers) appearing in multiple profiles
 * - Intent keywords in wrong profiles
 * - routing.json intent routes pointing to foreign workflows
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

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

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function loadIntentsFile(profileDir: string): Record<string, any> | null {
  const intentsPath = path.join(rootDir, profileDir, 'intents.json');
  try {
    if (!fs.existsSync(intentsPath)) return null;
    return JSON.parse(fs.readFileSync(intentsPath, 'utf-8'));
  } catch {
    return null;
  }
}

function loadKeywordsFile(profileDir: string): Record<string, any> | null {
  const keywordsPath = path.join(rootDir, profileDir, 'intent-keywords.json');
  try {
    if (!fs.existsSync(keywordsPath)) return null;
    return JSON.parse(fs.readFileSync(keywordsPath, 'utf-8'));
  } catch {
    return null;
  }
}

function loadRoutingFile(): Record<string, any> | null {
  const routingPath = path.join(rootDir, 'src/assistant/data/routing.json');
  try {
    if (!fs.existsSync(routingPath)) return null;
    return JSON.parse(fs.readFileSync(routingPath, 'utf-8'));
  } catch {
    return null;
  }
}

function loadWorkflowsFile(profileDir: string): Record<string, any> | null {
  const workflowsPath = path.join(rootDir, profileDir, 'workflows.json');
  try {
    if (!fs.existsSync(workflowsPath)) return null;
    return JSON.parse(fs.readFileSync(workflowsPath, 'utf-8'));
  } catch {
    return null;
  }
}

function getProfileIntentIds(intentsFile: Record<string, any>): Set<string> {
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

function getProfileWorkflowIds(workflowsFile: Record<string, any>): Set<string> {
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
// Detection
// ─────────────────────────────────────────────────────────────────────────

async function detectGuestMultiProfileViolations(
  pool: Pool,
  profiles: string[]
): Promise<Violation[]> {
  const violations: Violation[] = [];

  try {
    // Find phones that appear in multiple profiles
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

function detectKeywordCrossProfileViolations(profiles: string[]): Violation[] {
  const violations: Violation[] = [];
  const profileKeywords: Record<string, Set<string>> = {};
  const profileIntents: Record<string, Set<string>> = {};

  // Load intents and keywords for each profile
  for (const profile of profiles) {
    const profileDir = profile === 'pelangi'
      ? 'src/assistant/data'
      : `src/assistant/data-${profile}`;

    const intentsFile = loadIntentsFile(profileDir);
    const keywordsFile = loadKeywordsFile(profileDir);

    profileIntents[profile] = getProfileIntentIds(intentsFile || {});

    if (keywordsFile?.intents) {
      profileKeywords[profile] = new Set();
      for (const item of keywordsFile.intents) {
        if (item.intent) {
          profileKeywords[profile].add(item.intent);
        }
      }
    }
  }

  // Check for cross-profile keywords
  for (const profile of profiles) {
    const validIntents = profileIntents[profile];
    const keywords = profileKeywords[profile] || new Set();

    for (const intent of keywords) {
      if (!validIntents.has(intent)) {
        violations.push({
          id: `keyword_cross_${profile}_${intent}`,
          type: 'keyword_cross_profile',
          profileId: profile,
          details: {
            intent,
            found_in_profile: profile,
            intended_profiles: [],
          },
        });

        // Find which profile(s) have this intent
        for (const otherProfile of profiles) {
          if (otherProfile !== profile && profileIntents[otherProfile].has(intent)) {
            violations[violations.length - 1].details.intended_profiles.push(otherProfile);
          }
        }
      }
    }
  }

  return violations;
}

function detectWorkflowForeignRouteViolations(profiles: string[]): Violation[] {
  const violations: Violation[] = [];
  const profileWorkflows: Record<string, Set<string>> = {};

  // Load workflows for each profile
  for (const profile of profiles) {
    const profileDir = profile === 'pelangi'
      ? 'src/assistant/data'
      : `src/assistant/data-${profile}`;

    const workflowsFile = loadWorkflowsFile(profileDir);
    profileWorkflows[profile] = getProfileWorkflowIds(workflowsFile || {});
  }

  // Load routing and check for foreign workflows
  const routing = loadRoutingFile();
  if (routing) {
    for (const [intent, config] of Object.entries(routing)) {
      if ((config as any).action === 'workflow' && (config as any).workflow_id) {
        const workflowId = (config as any).workflow_id;

        // Check each profile to see if it has this intent
        for (const profile of profiles) {
          const intentsFile = loadIntentsFile(
            profile === 'pelangi' ? 'src/assistant/data' : `src/assistant/data-${profile}`
          );
          const intents = getProfileIntentIds(intentsFile || {});

          if (intents.has(intent)) {
            // This profile has this intent - check if it has the workflow
            if (!profileWorkflows[profile].has(workflowId)) {
              violations.push({
                id: `workflow_foreign_${profile}_${intent}`,
                type: 'workflow_foreign_route',
                profileId: profile,
                details: {
                  intent,
                  workflow_id: workflowId,
                  profile: profile,
                  reason: `Intent '${intent}' routes to workflow '${workflowId}' but workflow not found in ${profile} profile`,
                },
              });
            }
          }
        }
      }
    }
  }

  return violations;
}

// ─────────────────────────────────────────────────────────────────────────
// Repair
// ─────────────────────────────────────────────────────────────────────────

async function repairGuestMultiProfileViolations(
  pool: Pool,
  violations: Violation[]
): Promise<Repair[]> {
  const repairs: Repair[] = [];
  const guestViolations = violations.filter((v) => v.type === 'guest_multi_profile');

  for (const violation of guestViolations) {
    const phone = violation.details.phone;
    const profiles = violation.details.found_in_profiles;

    if (!phone || !profiles || profiles.length < 2) continue;

    // Keep messages from primary profile, delete from secondary
    const primaryProfile = profiles[0];

    try {
      for (let i = 1; i < profiles.length; i++) {
        const secondaryProfile = profiles[i];
        const countBefore = await pool.query(
          'SELECT COUNT(*) as count FROM rainbow_messages WHERE phone = $1 AND profile_id = $2',
          [phone, secondaryProfile]
        );

        // Delete messages from secondary profile
        await pool.query(
          'DELETE FROM rainbow_messages WHERE phone = $1 AND profile_id = $2',
          [phone, secondaryProfile]
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

function repairKeywordCrossProfileViolations(violations: Violation[]): Repair[] {
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

    // Recommend moving to correct profile
    repairs.push({
      violationId: violation.id,
      action: 'reassign',
      details: {
        intent,
        from_profile: profile,
        to_profiles: intendedProfiles,
        action_required: `Remove intent '${intent}' from ${profile}/intent-keywords.json and add to ${intendedProfiles.join(', ')}`,
      },
      applied: false,
      reason: `Cross-profile keyword detected - should be in ${intendedProfiles.join(', ')} not ${profile}`,
    });
  }

  return repairs;
}

function repairWorkflowForeignRouteViolations(violations: Violation[]): Repair[] {
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

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

export async function repairProfileIsolation(
  pool: Pool,
  profiles: string[] = ['pelangi', 'makan', 'southern']
): Promise<RepairReport> {
  const startTime = Date.now();
  const beforeCounts: Record<string, Record<string, number>> = {};
  const afterCounts: Record<string, Record<string, number>> = {};
  const violations: Violation[] = [];
  const repairs: Repair[] = [];
  const violationsByType: Record<string, number> = {};

  // Get before counts
  for (const profile of profiles) {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM rainbow_messages WHERE profile_id = $1`,
      [profile]
    );
    beforeCounts[profile] = {
      message_count: result.rows[0]?.count || 0,
    };
  }

  // Detect violations
  console.log('[REPAIR] Detecting guest multi-profile violations...');
  const guestViolations = await detectGuestMultiProfileViolations(pool, profiles);
  violations.push(...guestViolations);

  console.log('[REPAIR] Detecting keyword cross-profile violations...');
  const keywordViolations = detectKeywordCrossProfileViolations(profiles);
  violations.push(...keywordViolations);

  console.log('[REPAIR] Detecting workflow foreign route violations...');
  const workflowViolations = detectWorkflowForeignRouteViolations(profiles);
  violations.push(...workflowViolations);

  // Count violations by type
  for (const v of violations) {
    violationsByType[v.type] = (violationsByType[v.type] || 0) + 1;
  }

  // Repair violations
  console.log('[REPAIR] Repairing guest multi-profile violations...');
  const guestRepairs = await repairGuestMultiProfileViolations(pool, guestViolations);
  repairs.push(...guestRepairs);

  console.log('[REPAIR] Processing keyword cross-profile violations...');
  const keywordRepairs = repairKeywordCrossProfileViolations(keywordViolations);
  repairs.push(...keywordRepairs);

  console.log('[REPAIR] Processing workflow foreign route violations...');
  const workflowRepairs = repairWorkflowForeignRouteViolations(workflowViolations);
  repairs.push(...workflowRepairs);

  // Get after counts
  for (const profile of profiles) {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM rainbow_messages WHERE profile_id = $1`,
      [profile]
    );
    afterCounts[profile] = {
      message_count: result.rows[0]?.count || 0,
    };
  }

  const appliedCount = repairs.filter((r) => r.applied).length;
  const flaggedCount = repairs.filter((r) => !r.applied && r.action === 'flag_for_review').length;

  const report: RepairReport = {
    timestamp: new Date().toISOString(),
    violations_found: violations.length,
    repairs_applied: appliedCount,
    repairs_flagged: flaggedCount,
    violations_by_type: violationsByType,
    before_counts: beforeCounts,
    after_counts: afterCounts,
    repairs,
  };

  console.log(`[REPAIR] Complete in ${Date.now() - startTime}ms`);
  console.log(`[REPAIR] Found ${violations.length} violations, applied ${appliedCount} repairs, flagged ${flaggedCount}`);

  return report;
}
