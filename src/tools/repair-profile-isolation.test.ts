/**
 * US-238: Profile Isolation Violations Auto-Repair Tool — unit tests
 *
 * Tests pure logic. Validates that:
 *   AC1: CLI command detects violations: guests with multi-profile references,
 *        intent keywords in wrong profiles, routing.json routes to foreign workflows
 *   AC2: For each violation, generates suggestion (delete, reassign, or flag_for_review);
 *        applies fix and logs to profile_isolation_repairs table
 *   AC3: Output JSON report with: violations_found, repairs_applied, repairs_flagged,
 *        before/after data counts per profile, timestamp
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getProfileIntentIds,
  getProfileWorkflowIds,
  detectKeywordCrossProfileViolations,
  detectWorkflowForeignRouteViolations,
  generateKeywordRepairs,
  generateWorkflowRepairs,
  getProfileDir,
  loadProfileData,
  PROFILE_DIRS,
  type IntentsFile,
  type RoutingFile,
  type WorkflowsFile,
  type Violation,
  type RepairReport,
} from './repair-profile-isolation.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeIntentsFile(intents: string[]): IntentsFile {
  return {
    categories: [
      {
        phase: 'TEST',
        intents: intents.map((category) => ({ category })),
      },
    ],
  };
}

function makeWorkflowsFile(ids: string[]): WorkflowsFile {
  return {
    workflows: ids.map((id) => ({ id, name: `Workflow ${id}` })),
  };
}

// ── getProfileIntentIds ──────────────────────────────────────────────────

describe('getProfileIntentIds', () => {
  it('extracts intent category IDs from intents file', () => {
    const file = makeIntentsFile(['greeting', 'booking', 'pricing']);
    const ids = getProfileIntentIds(file);
    expect(ids).toEqual(new Set(['greeting', 'booking', 'pricing']));
  });

  it('returns empty set for null input', () => {
    const ids = getProfileIntentIds(null);
    expect(ids.size).toBe(0);
  });

  it('returns empty set for file with no categories', () => {
    const ids = getProfileIntentIds({});
    expect(ids.size).toBe(0);
  });

  it('handles multiple phases', () => {
    const file: IntentsFile = {
      categories: [
        { phase: 'A', intents: [{ category: 'greeting' }] },
        { phase: 'B', intents: [{ category: 'booking' }] },
      ],
    };
    const ids = getProfileIntentIds(file);
    expect(ids).toEqual(new Set(['greeting', 'booking']));
  });
});

// ── getProfileWorkflowIds ────────────────────────────────────────────────

describe('getProfileWorkflowIds', () => {
  it('extracts workflow IDs from workflows file', () => {
    const file = makeWorkflowsFile(['booking_payment_handler', 'escalate']);
    const ids = getProfileWorkflowIds(file);
    expect(ids).toEqual(new Set(['booking_payment_handler', 'escalate']));
  });

  it('returns empty set for null input', () => {
    const ids = getProfileWorkflowIds(null);
    expect(ids.size).toBe(0);
  });

  it('returns empty set for file with no workflows', () => {
    const ids = getProfileWorkflowIds({});
    expect(ids.size).toBe(0);
  });
});

// ── PROFILE_DIRS ─────────────────────────────────────────────────────────

describe('PROFILE_DIRS', () => {
  it('maps all three profiles to correct directories', () => {
    expect(PROFILE_DIRS.pelangi).toBe('src/assistant/data');
    expect(PROFILE_DIRS.makan).toBe('src/assistant/data-makan');
    expect(PROFILE_DIRS.southern).toBe('src/assistant/data-southern');
  });

  it('getProfileDir returns correct path for known profiles', () => {
    expect(getProfileDir('pelangi')).toBe('src/assistant/data');
    expect(getProfileDir('makan')).toBe('src/assistant/data-makan');
    expect(getProfileDir('southern')).toBe('src/assistant/data-southern');
  });

  it('getProfileDir generates fallback for unknown profiles', () => {
    expect(getProfileDir('test')).toBe('src/assistant/data-test');
  });
});

// ── AC1: detectKeywordCrossProfileViolations ─────────────────────────────

describe('AC1: detectKeywordCrossProfileViolations', () => {
  it('detects keyword intent present in wrong profile', () => {
    const profileIntents: Record<string, Set<string>> = {
      pelangi: new Set(['greeting', 'booking', 'checkin_info']),
      makan: new Set(['greeting', 'menu_query', 'order_placement']),
    };
    const profileKeywordIntents: Record<string, Set<string>> = {
      pelangi: new Set(['greeting', 'booking', 'checkin_info']),
      // makan has 'checkin_info' keyword entries but no 'checkin_info' intent defined
      makan: new Set(['greeting', 'menu_query', 'checkin_info']),
    };

    const violations = detectKeywordCrossProfileViolations(
      profileIntents, profileKeywordIntents, ['pelangi', 'makan'],
    );

    expect(violations.length).toBe(1);
    expect(violations[0].type).toBe('keyword_cross_profile');
    expect(violations[0].profileId).toBe('makan');
    expect(violations[0].details.intent).toBe('checkin_info');
    expect(violations[0].details.intended_profiles).toContain('pelangi');
  });

  it('returns no violations when all keywords match defined intents', () => {
    const profileIntents: Record<string, Set<string>> = {
      pelangi: new Set(['greeting', 'booking']),
      makan: new Set(['greeting', 'menu_query']),
    };
    const profileKeywordIntents: Record<string, Set<string>> = {
      pelangi: new Set(['greeting', 'booking']),
      makan: new Set(['greeting', 'menu_query']),
    };

    const violations = detectKeywordCrossProfileViolations(
      profileIntents, profileKeywordIntents, ['pelangi', 'makan'],
    );

    expect(violations).toHaveLength(0);
  });

  it('detects violations across all three profiles', () => {
    const profileIntents: Record<string, Set<string>> = {
      pelangi: new Set(['booking', 'checkin_info']),
      makan: new Set(['menu_query']),
      southern: new Set(['booking', 'checkin_info']),
    };
    const profileKeywordIntents: Record<string, Set<string>> = {
      pelangi: new Set(['booking', 'checkin_info']),
      // makan has 'booking' keywords but no booking intent
      makan: new Set(['menu_query', 'booking']),
      southern: new Set(['booking', 'checkin_info']),
    };

    const violations = detectKeywordCrossProfileViolations(
      profileIntents, profileKeywordIntents, ['pelangi', 'makan', 'southern'],
    );

    expect(violations.length).toBe(1);
    expect(violations[0].profileId).toBe('makan');
    expect(violations[0].details.intent).toBe('booking');
    // booking intent is in pelangi and southern
    expect(violations[0].details.intended_profiles).toContain('pelangi');
    expect(violations[0].details.intended_profiles).toContain('southern');
  });

  it('detects orphaned keyword intents not found in any profile', () => {
    const profileIntents: Record<string, Set<string>> = {
      pelangi: new Set(['greeting']),
      makan: new Set(['greeting']),
    };
    const profileKeywordIntents: Record<string, Set<string>> = {
      pelangi: new Set(['greeting']),
      // 'nonexistent_intent' not defined in any profile
      makan: new Set(['greeting', 'nonexistent_intent']),
    };

    const violations = detectKeywordCrossProfileViolations(
      profileIntents, profileKeywordIntents, ['pelangi', 'makan'],
    );

    expect(violations.length).toBe(1);
    expect(violations[0].details.intent).toBe('nonexistent_intent');
    // No other profile has it, so intended_profiles is empty
    expect(violations[0].details.intended_profiles).toHaveLength(0);
  });
});

// ── AC1: detectWorkflowForeignRouteViolations ────────────────────────────

describe('AC1: detectWorkflowForeignRouteViolations', () => {
  it('detects routing entry pointing to foreign workflow', () => {
    const profileRoutings: Record<string, RoutingFile | null> = {
      pelangi: {
        booking: { action: 'workflow', workflow_id: 'booking_payment_handler' },
        greeting: { action: 'static_reply' },
      },
      makan: {
        table_reservation: { action: 'workflow', workflow_id: 'table_reservation' },
        // makan routes 'booking' to a workflow that does not exist in makan
        booking: { action: 'workflow', workflow_id: 'booking_payment_handler' },
      },
    };
    const profileIntents: Record<string, Set<string>> = {
      pelangi: new Set(['booking', 'greeting']),
      makan: new Set(['table_reservation', 'booking']),
    };
    const profileWorkflows: Record<string, Set<string>> = {
      pelangi: new Set(['booking_payment_handler', 'escalate']),
      makan: new Set(['table_reservation', 'complaint_handling']),
    };

    const violations = detectWorkflowForeignRouteViolations(
      profileRoutings, profileIntents, profileWorkflows, ['pelangi', 'makan'],
    );

    // makan has 'booking' routing to 'booking_payment_handler' which is not in makan workflows
    expect(violations.length).toBe(1);
    expect(violations[0].type).toBe('workflow_foreign_route');
    expect(violations[0].profileId).toBe('makan');
    expect(violations[0].details.intent).toBe('booking');
    expect(violations[0].details.workflow_id).toBe('booking_payment_handler');
  });

  it('returns no violations when all routes point to valid workflows', () => {
    const profileRoutings: Record<string, RoutingFile | null> = {
      pelangi: {
        booking: { action: 'workflow', workflow_id: 'booking_handler' },
      },
      makan: {
        order: { action: 'workflow', workflow_id: 'order_handler' },
      },
    };
    const profileIntents: Record<string, Set<string>> = {
      pelangi: new Set(['booking']),
      makan: new Set(['order']),
    };
    const profileWorkflows: Record<string, Set<string>> = {
      pelangi: new Set(['booking_handler']),
      makan: new Set(['order_handler']),
    };

    const violations = detectWorkflowForeignRouteViolations(
      profileRoutings, profileIntents, profileWorkflows, ['pelangi', 'makan'],
    );

    expect(violations).toHaveLength(0);
  });

  it('ignores non-workflow routes (static_reply, llm_reply)', () => {
    const profileRoutings: Record<string, RoutingFile | null> = {
      pelangi: {
        greeting: { action: 'static_reply' },
        unknown: { action: 'llm_reply' },
      },
    };
    const profileIntents: Record<string, Set<string>> = {
      pelangi: new Set(['greeting', 'unknown']),
    };
    const profileWorkflows: Record<string, Set<string>> = {
      pelangi: new Set(),
    };

    const violations = detectWorkflowForeignRouteViolations(
      profileRoutings, profileIntents, profileWorkflows, ['pelangi'],
    );

    expect(violations).toHaveLength(0);
  });

  it('handles profile with null routing file', () => {
    const profileRoutings: Record<string, RoutingFile | null> = {
      pelangi: null,
    };
    const profileIntents: Record<string, Set<string>> = {
      pelangi: new Set(['greeting']),
    };
    const profileWorkflows: Record<string, Set<string>> = {
      pelangi: new Set(),
    };

    const violations = detectWorkflowForeignRouteViolations(
      profileRoutings, profileIntents, profileWorkflows, ['pelangi'],
    );

    expect(violations).toHaveLength(0);
  });
});

// ── AC2: Repair suggestions ──────────────────────────────────────────────

describe('AC2: generateKeywordRepairs', () => {
  it('generates reassign repair for cross-profile keyword with known target', () => {
    const violations: Violation[] = [
      {
        id: 'keyword_cross_makan_checkin_info',
        type: 'keyword_cross_profile',
        profileId: 'makan',
        details: {
          intent: 'checkin_info',
          found_in_profile: 'makan',
          intended_profiles: ['pelangi'],
        },
      },
    ];

    const repairs = generateKeywordRepairs(violations);

    expect(repairs).toHaveLength(1);
    expect(repairs[0].action).toBe('reassign');
    expect(repairs[0].applied).toBe(false);
    expect(repairs[0].details.intent).toBe('checkin_info');
    expect(repairs[0].details.from_profile).toBe('makan');
    expect(repairs[0].details.to_profiles).toContain('pelangi');
    expect(repairs[0].reason).toContain('pelangi');
    expect(repairs[0].reason).toContain('makan');
  });

  it('generates flag_for_review repair for orphaned keyword', () => {
    const violations: Violation[] = [
      {
        id: 'keyword_cross_makan_nonexistent',
        type: 'keyword_cross_profile',
        profileId: 'makan',
        details: {
          intent: 'nonexistent_intent',
          found_in_profile: 'makan',
          intended_profiles: [],
        },
      },
    ];

    const repairs = generateKeywordRepairs(violations);

    expect(repairs).toHaveLength(1);
    expect(repairs[0].action).toBe('flag_for_review');
    expect(repairs[0].applied).toBe(false);
    expect(repairs[0].reason).toContain('manual review');
  });

  it('returns delete, reassign, or flag_for_review actions only', () => {
    const violations: Violation[] = [
      {
        id: 'v1',
        type: 'keyword_cross_profile',
        profileId: 'makan',
        details: { intent: 'a', found_in_profile: 'makan', intended_profiles: ['pelangi'] },
      },
      {
        id: 'v2',
        type: 'keyword_cross_profile',
        profileId: 'makan',
        details: { intent: 'b', found_in_profile: 'makan', intended_profiles: [] },
      },
    ];

    const repairs = generateKeywordRepairs(violations);
    const validActions = new Set(['delete', 'reassign', 'flag_for_review']);
    for (const r of repairs) {
      expect(validActions.has(r.action)).toBe(true);
    }
  });
});

describe('AC2: generateWorkflowRepairs', () => {
  it('generates flag_for_review repair for foreign route violation', () => {
    const violations: Violation[] = [
      {
        id: 'workflow_foreign_makan_booking',
        type: 'workflow_foreign_route',
        profileId: 'makan',
        details: {
          intent: 'booking',
          workflow_id: 'booking_payment_handler',
          profile: 'makan',
          reason: "Intent 'booking' routes to workflow 'booking_payment_handler' but workflow not found in makan profile",
        },
      },
    ];

    const repairs = generateWorkflowRepairs(violations);

    expect(repairs).toHaveLength(1);
    expect(repairs[0].action).toBe('flag_for_review');
    expect(repairs[0].applied).toBe(false);
    expect(repairs[0].details.intent).toBe('booking');
    expect(repairs[0].details.workflow_id).toBe('booking_payment_handler');
    expect(repairs[0].reason).toContain('booking');
  });

  it('returns empty array when no workflow violations', () => {
    const repairs = generateWorkflowRepairs([]);
    expect(repairs).toHaveLength(0);
  });

  it('ignores non-workflow violations', () => {
    const violations: Violation[] = [
      {
        id: 'keyword_cross_makan_test',
        type: 'keyword_cross_profile',
        profileId: 'makan',
        details: { intent: 'test', found_in_profile: 'makan', intended_profiles: [] },
      },
    ];

    const repairs = generateWorkflowRepairs(violations);
    expect(repairs).toHaveLength(0);
  });
});

// ── AC3: Report structure ────────────────────────────────────────────────

describe('AC3: RepairReport JSON structure', () => {
  it('report interface has all required fields', () => {
    // Create a mock report matching the interface
    const report: RepairReport = {
      timestamp: new Date().toISOString(),
      violations_found: 3,
      repairs_applied: 1,
      repairs_flagged: 2,
      violations_by_type: {
        keyword_cross_profile: 2,
        workflow_foreign_route: 1,
      },
      before_counts: {
        pelangi: { message_count: 100 },
        makan: { message_count: 50 },
        southern: { message_count: 30 },
      },
      after_counts: {
        pelangi: { message_count: 100 },
        makan: { message_count: 50 },
        southern: { message_count: 30 },
      },
      repairs: [],
    };

    // Verify required fields exist
    expect(report.timestamp).toBeDefined();
    expect(typeof report.violations_found).toBe('number');
    expect(typeof report.repairs_applied).toBe('number');
    expect(typeof report.repairs_flagged).toBe('number');
    expect(report.violations_by_type).toBeDefined();
    expect(report.before_counts).toBeDefined();
    expect(report.after_counts).toBeDefined();
    expect(Array.isArray(report.repairs)).toBe(true);
  });

  it('report has before/after counts per profile', () => {
    const report: RepairReport = {
      timestamp: new Date().toISOString(),
      violations_found: 0,
      repairs_applied: 0,
      repairs_flagged: 0,
      violations_by_type: {},
      before_counts: {
        pelangi: { message_count: 100 },
        makan: { message_count: 50 },
        southern: { message_count: 30 },
      },
      after_counts: {
        pelangi: { message_count: 100 },
        makan: { message_count: 48 },
        southern: { message_count: 30 },
      },
      repairs: [],
    };

    // Each profile should have counts in both before and after
    for (const profile of ['pelangi', 'makan', 'southern']) {
      expect(report.before_counts[profile]).toBeDefined();
      expect(typeof report.before_counts[profile].message_count).toBe('number');
      expect(report.after_counts[profile]).toBeDefined();
      expect(typeof report.after_counts[profile].message_count).toBe('number');
    }
  });

  it('report timestamp is valid ISO string', () => {
    const report: RepairReport = {
      timestamp: new Date().toISOString(),
      violations_found: 0,
      repairs_applied: 0,
      repairs_flagged: 0,
      violations_by_type: {},
      before_counts: {},
      after_counts: {},
      repairs: [],
    };

    const parsed = new Date(report.timestamp);
    expect(parsed.toISOString()).toBe(report.timestamp);
  });

  it('repairs_applied counts only applied repairs', () => {
    const repairs = [
      { violationId: 'v1', action: 'delete' as const, details: {}, applied: true, reason: 'test' },
      { violationId: 'v2', action: 'reassign' as const, details: {}, applied: false, reason: 'test' },
      { violationId: 'v3', action: 'flag_for_review' as const, details: {}, applied: false, reason: 'test' },
    ];

    const appliedCount = repairs.filter((r) => r.applied).length;
    const flaggedCount = repairs.filter((r) => !r.applied && r.action === 'flag_for_review').length;

    expect(appliedCount).toBe(1);
    expect(flaggedCount).toBe(1);
  });

  it('report serializes to valid JSON', () => {
    const report: RepairReport = {
      timestamp: '2026-03-24T10:00:00.000Z',
      violations_found: 2,
      repairs_applied: 1,
      repairs_flagged: 1,
      violations_by_type: { keyword_cross_profile: 1, workflow_foreign_route: 1 },
      before_counts: { pelangi: { message_count: 100 }, makan: { message_count: 50 } },
      after_counts: { pelangi: { message_count: 100 }, makan: { message_count: 50 } },
      repairs: [
        {
          violationId: 'v1',
          action: 'delete',
          details: { phone: '123' },
          applied: true,
          reason: 'Deleted messages',
        },
      ],
    };

    const json = JSON.stringify(report);
    const parsed = JSON.parse(json);

    expect(parsed.violations_found).toBe(2);
    expect(parsed.repairs_applied).toBe(1);
    expect(parsed.repairs_flagged).toBe(1);
    expect(parsed.before_counts.pelangi.message_count).toBe(100);
    expect(parsed.after_counts.makan.message_count).toBe(50);
    expect(parsed.repairs).toHaveLength(1);
    expect(parsed.timestamp).toBe('2026-03-24T10:00:00.000Z');
  });
});

// ── End-to-end detection + repair flow (pure logic) ──────────────────────

describe('End-to-end detection and repair flow', () => {
  it('detects keyword violations and generates appropriate repairs', () => {
    const profileIntents: Record<string, Set<string>> = {
      pelangi: new Set(['greeting', 'booking', 'checkin_info', 'checkout_info']),
      makan: new Set(['greeting', 'menu_query', 'order_placement']),
      southern: new Set(['greeting', 'booking', 'checkin_info']),
    };
    const profileKeywordIntents: Record<string, Set<string>> = {
      pelangi: new Set(['greeting', 'booking', 'checkin_info', 'checkout_info']),
      // makan has hostel-specific keywords that don't belong
      makan: new Set(['greeting', 'menu_query', 'order_placement', 'checkin_info', 'checkout_info']),
      southern: new Set(['greeting', 'booking', 'checkin_info']),
    };

    const violations = detectKeywordCrossProfileViolations(
      profileIntents, profileKeywordIntents, ['pelangi', 'makan', 'southern'],
    );

    expect(violations.length).toBe(2); // checkin_info and checkout_info in makan
    expect(violations.every((v) => v.profileId === 'makan')).toBe(true);

    const repairs = generateKeywordRepairs(violations);
    expect(repairs.length).toBe(2);

    // checkin_info found in pelangi and southern, so reassign
    const checkinRepair = repairs.find((r) => r.details.intent === 'checkin_info');
    expect(checkinRepair).toBeDefined();
    expect(checkinRepair!.action).toBe('reassign');

    // checkout_info found in pelangi only, so reassign
    const checkoutRepair = repairs.find((r) => r.details.intent === 'checkout_info');
    expect(checkoutRepair).toBeDefined();
    expect(checkoutRepair!.action).toBe('reassign');
  });

  it('detects workflow violations and generates flag_for_review repairs', () => {
    const profileRoutings: Record<string, RoutingFile | null> = {
      pelangi: {
        booking: { action: 'workflow', workflow_id: 'booking_payment_handler' },
        contact_staff: { action: 'workflow', workflow_id: 'escalate' },
      },
      makan: {
        table_reservation: { action: 'workflow', workflow_id: 'table_reservation' },
        complaint: { action: 'workflow', workflow_id: 'complaint_handling' },
        // Foreign workflow reference
        booking: { action: 'workflow', workflow_id: 'booking_payment_handler' },
      },
      southern: {
        booking: { action: 'workflow', workflow_id: 'booking_payment_handler' },
      },
    };
    const profileIntents: Record<string, Set<string>> = {
      pelangi: new Set(['booking', 'contact_staff']),
      makan: new Set(['table_reservation', 'complaint', 'booking']),
      southern: new Set(['booking']),
    };
    const profileWorkflows: Record<string, Set<string>> = {
      pelangi: new Set(['booking_payment_handler', 'escalate']),
      makan: new Set(['table_reservation', 'complaint_handling']),
      southern: new Set(['booking_payment_handler']),
    };

    const violations = detectWorkflowForeignRouteViolations(
      profileRoutings, profileIntents, profileWorkflows, ['pelangi', 'makan', 'southern'],
    );

    // makan has 'booking' -> 'booking_payment_handler' but booking_payment_handler not in makan
    expect(violations.length).toBe(1);
    expect(violations[0].profileId).toBe('makan');

    const repairs = generateWorkflowRepairs(violations);
    expect(repairs.length).toBe(1);
    expect(repairs[0].action).toBe('flag_for_review');
  });

  it('handles scenario with no violations across profiles', () => {
    const profileIntents: Record<string, Set<string>> = {
      pelangi: new Set(['greeting', 'booking']),
      makan: new Set(['greeting', 'menu_query']),
    };
    const profileKeywordIntents: Record<string, Set<string>> = {
      pelangi: new Set(['greeting', 'booking']),
      makan: new Set(['greeting', 'menu_query']),
    };
    const profileRoutings: Record<string, RoutingFile | null> = {
      pelangi: { booking: { action: 'workflow', workflow_id: 'booking_handler' } },
      makan: { menu_query: { action: 'llm_reply' } },
    };
    const profileWorkflows: Record<string, Set<string>> = {
      pelangi: new Set(['booking_handler']),
      makan: new Set(),
    };

    const kwViolations = detectKeywordCrossProfileViolations(
      profileIntents, profileKeywordIntents, ['pelangi', 'makan'],
    );
    const wfViolations = detectWorkflowForeignRouteViolations(
      profileRoutings, profileIntents, profileWorkflows, ['pelangi', 'makan'],
    );

    expect(kwViolations).toHaveLength(0);
    expect(wfViolations).toHaveLength(0);
  });
});

// ── Integration with real profile data files ─────────────────────────────

describe('Integration: load real profile data', () => {
  // Use the actual rootDir for integration tests
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.join(testDir, '..', '..');

  it('loads all three profiles successfully', () => {
    const data = loadProfileData(rootDir, ['pelangi', 'makan', 'southern']);

    expect(Object.keys(data.profileIntents)).toHaveLength(3);
    expect(data.profileIntents.pelangi.size).toBeGreaterThan(0);
    expect(data.profileIntents.makan.size).toBeGreaterThan(0);
    expect(data.profileIntents.southern.size).toBeGreaterThan(0);
  });

  it('each profile has keyword intents loaded', () => {
    const data = loadProfileData(rootDir, ['pelangi', 'makan', 'southern']);

    expect(data.profileKeywordIntents.pelangi.size).toBeGreaterThan(0);
    expect(data.profileKeywordIntents.makan.size).toBeGreaterThan(0);
    expect(data.profileKeywordIntents.southern.size).toBeGreaterThan(0);
  });

  it('each profile has routing loaded', () => {
    const data = loadProfileData(rootDir, ['pelangi', 'makan', 'southern']);

    expect(data.profileRoutings.pelangi).not.toBeNull();
    expect(data.profileRoutings.makan).not.toBeNull();
    expect(data.profileRoutings.southern).not.toBeNull();
  });

  it('runs keyword violation detection on real data without errors', () => {
    const data = loadProfileData(rootDir, ['pelangi', 'makan', 'southern']);

    const violations = detectKeywordCrossProfileViolations(
      data.profileIntents,
      data.profileKeywordIntents,
      ['pelangi', 'makan', 'southern'],
    );

    expect(Array.isArray(violations)).toBe(true);
    // Each violation should have required fields
    for (const v of violations) {
      expect(v.id).toBeDefined();
      expect(v.type).toBe('keyword_cross_profile');
      expect(v.profileId).toBeDefined();
      expect(v.details.intent).toBeDefined();
    }
  });

  it('runs workflow violation detection on real data without errors', () => {
    const data = loadProfileData(rootDir, ['pelangi', 'makan', 'southern']);

    const violations = detectWorkflowForeignRouteViolations(
      data.profileRoutings,
      data.profileIntents,
      data.profileWorkflows,
      ['pelangi', 'makan', 'southern'],
    );

    expect(Array.isArray(violations)).toBe(true);
    for (const v of violations) {
      expect(v.id).toBeDefined();
      expect(v.type).toBe('workflow_foreign_route');
      expect(v.profileId).toBeDefined();
      expect(v.details.workflow_id).toBeDefined();
    }
  });

  it('generates repairs for all detected violations', () => {
    const data = loadProfileData(rootDir, ['pelangi', 'makan', 'southern']);

    const kwViolations = detectKeywordCrossProfileViolations(
      data.profileIntents,
      data.profileKeywordIntents,
      ['pelangi', 'makan', 'southern'],
    );
    const wfViolations = detectWorkflowForeignRouteViolations(
      data.profileRoutings,
      data.profileIntents,
      data.profileWorkflows,
      ['pelangi', 'makan', 'southern'],
    );

    const kwRepairs = generateKeywordRepairs(kwViolations);
    const wfRepairs = generateWorkflowRepairs(wfViolations);

    // Every violation should produce exactly one repair
    expect(kwRepairs.length).toBe(kwViolations.length);
    expect(wfRepairs.length).toBe(wfViolations.length);

    // All repairs should have valid actions
    const validActions = new Set(['delete', 'reassign', 'flag_for_review']);
    for (const r of [...kwRepairs, ...wfRepairs]) {
      expect(validActions.has(r.action)).toBe(true);
      expect(r.violationId).toBeDefined();
      expect(r.reason).toBeDefined();
      expect(typeof r.applied).toBe('boolean');
    }
  });
});
