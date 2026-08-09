/**
 * US-332: Intent Routing Table Cross-Profile Contamination Validator — Unit Tests
 *
 * Tests pure logic in routing-conflict-logic.ts — no file system access
 * required for core tests. Integration tests verify real file loading.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  extractWorkflowIds,
  extractRoutedWorkflows,
  validateRoutingConflicts,
  loadRoutingFile,
  loadWorkflowsFile,
  findLineNumber,
  PROFILE_CONFIGS,
  type RoutingFile,
  type WorkflowsFile,
  type RoutingConflictReport,
  type RoutingViolation,
} from './routing-conflict-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..', '..');

// ── Test fixture helpers ─────────────────────────────────────────────

function makeRoutingFile(
  entries: Record<
    string,
    { action: string; workflow_id?: string; notes?: string }
  >,
): RoutingFile {
  return entries;
}

function makeWorkflowsFile(ids: string[]): WorkflowsFile {
  return {
    schema_version: '1.0',
    workflows: ids.map((id) => ({ id, name: `Workflow ${id}` })),
  };
}

// ── extractWorkflowIds ───────────────────────────────────────────────

describe('extractWorkflowIds', () => {
  it('extracts all workflow IDs from workflows file', () => {
    const workflows = makeWorkflowsFile([
      'booking_handler',
      'complaint_handling',
      'escalate',
    ]);

    const ids = extractWorkflowIds(workflows);

    expect(ids.size).toBe(3);
    expect(ids.has('booking_handler')).toBe(true);
    expect(ids.has('complaint_handling')).toBe(true);
    expect(ids.has('escalate')).toBe(true);
  });

  it('returns empty set for empty workflows file', () => {
    const workflows = makeWorkflowsFile([]);

    const ids = extractWorkflowIds(workflows);

    expect(ids.size).toBe(0);
  });
});

// ── extractRoutedWorkflows ───────────────────────────────────────────

describe('extractRoutedWorkflows', () => {
  it('extracts intents that route to workflows', () => {
    const routing = makeRoutingFile({
      booking: { action: 'workflow', workflow_id: 'booking_handler' },
      greeting: { action: 'static_reply' },
      complaint: { action: 'workflow', workflow_id: 'complaint_handling' },
      unknown: { action: 'llm_reply' },
    });

    const routed = extractRoutedWorkflows(routing);

    expect(routed).toHaveLength(2);
    expect(routed).toContainEqual({
      intent: 'booking',
      handler: 'booking_handler',
    });
    expect(routed).toContainEqual({
      intent: 'complaint',
      handler: 'complaint_handling',
    });
  });

  it('ignores non-workflow actions', () => {
    const routing = makeRoutingFile({
      greeting: { action: 'static_reply' },
      unknown: { action: 'llm_reply' },
      pricing: { action: 'static_reply' },
    });

    const routed = extractRoutedWorkflows(routing);

    expect(routed).toHaveLength(0);
  });

  it('ignores workflow entries without workflow_id', () => {
    const routing = makeRoutingFile({
      broken: { action: 'workflow' },
    });

    const routed = extractRoutedWorkflows(routing);

    expect(routed).toHaveLength(0);
  });
});

// ── validateRoutingConflicts ─────────────────────────────────────────

describe('validateRoutingConflicts', () => {
  it('returns no violations when all handlers belong to own profile', () => {
    const routing = makeRoutingFile({
      booking: { action: 'workflow', workflow_id: 'booking_handler' },
      complaint: { action: 'workflow', workflow_id: 'complaint_handling' },
      greeting: { action: 'static_reply' },
    });
    const ownWorkflows = new Set(['booking_handler', 'complaint_handling']);
    const otherWorkflows = new Map<string, Set<string>>();

    const report = validateRoutingConflicts(
      'pelangi',
      routing,
      ownWorkflows,
      otherWorkflows,
      'src/assistant/data/routing.json',
    );

    expect(report.totalViolations).toBe(0);
    expect(report.violations).toHaveLength(0);
  });

  it('detects handler belonging to another profile', () => {
    const routing = makeRoutingFile({
      booking: {
        action: 'workflow',
        workflow_id: 'southern_booking_handler',
      },
      greeting: { action: 'static_reply' },
    });
    const ownWorkflows = new Set(['complaint_handling', 'escalate']);
    const otherWorkflows = new Map<string, Set<string>>([
      ['southern', new Set(['southern_booking_handler', 'tourist_guide'])],
    ]);

    const report = validateRoutingConflicts(
      'pelangi',
      routing,
      ownWorkflows,
      otherWorkflows,
      'src/assistant/data/routing.json',
    );

    expect(report.totalViolations).toBe(1);
    expect(report.violations[0]).toMatchObject({
      intent: 'booking',
      profile: 'pelangi',
      handler: 'southern_booking_handler',
      file: 'src/assistant/data/routing.json',
    });
  });

  it('detects handler not defined anywhere as violation', () => {
    const routing = makeRoutingFile({
      booking: { action: 'workflow', workflow_id: 'nonexistent_handler' },
    });
    const ownWorkflows = new Set(['complaint_handling']);
    const otherWorkflows = new Map<string, Set<string>>([
      ['southern', new Set(['tourist_guide'])],
    ]);

    const report = validateRoutingConflicts(
      'pelangi',
      routing,
      ownWorkflows,
      otherWorkflows,
      'src/assistant/data/routing.json',
    );

    expect(report.totalViolations).toBe(1);
    expect(report.violations[0].handler).toBe('nonexistent_handler');
  });

  it('does not flag non-workflow routing entries', () => {
    const routing = makeRoutingFile({
      greeting: { action: 'static_reply' },
      unknown: { action: 'llm_reply' },
      pricing: { action: 'static_reply' },
    });
    const ownWorkflows = new Set<string>();
    const otherWorkflows = new Map<string, Set<string>>();

    const report = validateRoutingConflicts(
      'makan',
      routing,
      ownWorkflows,
      otherWorkflows,
      'src/assistant/data-makan/routing.json',
    );

    expect(report.totalViolations).toBe(0);
  });

  it('uses lineFinder to populate line numbers', () => {
    const routing = makeRoutingFile({
      booking: {
        action: 'workflow',
        workflow_id: 'southern_booking_handler',
      },
    });
    const ownWorkflows = new Set<string>();
    const otherWorkflows = new Map<string, Set<string>>([
      ['southern', new Set(['southern_booking_handler'])],
    ]);
    const lineFinder = (key: string) => (key === 'booking' ? 42 : 0);

    const report = validateRoutingConflicts(
      'pelangi',
      routing,
      ownWorkflows,
      otherWorkflows,
      'src/assistant/data/routing.json',
      lineFinder,
    );

    expect(report.violations[0].line).toBe(42);
  });

  it('reports correct profile name in violations', () => {
    const routing = makeRoutingFile({
      checkin: {
        action: 'workflow',
        workflow_id: 'checkin_full',
      },
    });
    const ownWorkflows = new Set<string>();
    const otherWorkflows = new Map<string, Set<string>>([
      ['pelangi', new Set(['checkin_full'])],
    ]);

    const report = validateRoutingConflicts(
      'makan',
      routing,
      ownWorkflows,
      otherWorkflows,
      'src/assistant/data-makan/routing.json',
    );

    expect(report.profile).toBe('makan');
    expect(report.violations[0].profile).toBe('makan');
  });

  it('counts total intents from routing file', () => {
    const routing = makeRoutingFile({
      greeting: { action: 'static_reply' },
      booking: { action: 'workflow', workflow_id: 'booking_handler' },
      complaint: { action: 'workflow', workflow_id: 'complaint_handling' },
      unknown: { action: 'llm_reply' },
    });
    const ownWorkflows = new Set(['booking_handler', 'complaint_handling']);
    const otherWorkflows = new Map<string, Set<string>>();

    const report = validateRoutingConflicts(
      'pelangi',
      routing,
      ownWorkflows,
      otherWorkflows,
      'src/assistant/data/routing.json',
    );

    expect(report.totalIntents).toBe(4);
  });

  it('includes timestamp in report', () => {
    const routing = makeRoutingFile({});
    const ownWorkflows = new Set<string>();
    const otherWorkflows = new Map<string, Set<string>>();

    const report = validateRoutingConflicts(
      'pelangi',
      routing,
      ownWorkflows,
      otherWorkflows,
      'src/assistant/data/routing.json',
    );

    expect(report.timestamp).toBeDefined();
    expect(() => new Date(report.timestamp)).not.toThrow();
  });

  it('detects multiple violations in same routing file', () => {
    const routing = makeRoutingFile({
      booking: {
        action: 'workflow',
        workflow_id: 'southern_booking_handler',
      },
      checkin: { action: 'workflow', workflow_id: 'southern_checkin' },
      greeting: { action: 'static_reply' },
    });
    const ownWorkflows = new Set(['complaint_handling']);
    const otherWorkflows = new Map<string, Set<string>>([
      [
        'southern',
        new Set(['southern_booking_handler', 'southern_checkin']),
      ],
    ]);

    const report = validateRoutingConflicts(
      'pelangi',
      routing,
      ownWorkflows,
      otherWorkflows,
      'src/assistant/data/routing.json',
    );

    expect(report.totalViolations).toBe(2);
    const violatedIntents = report.violations.map((v) => v.intent);
    expect(violatedIntents).toContain('booking');
    expect(violatedIntents).toContain('checkin');
  });
});

// ── AC1: CLI returns structured JSON list of violations ──────────────

describe('AC1: validate:routing-conflicts returns structured JSON violations', () => {
  it('returns violations with intent, profile, handler, file, and line', () => {
    const routing = makeRoutingFile({
      booking: {
        action: 'workflow',
        workflow_id: 'southern_booking_handler',
      },
    });
    const ownWorkflows = new Set<string>();
    const otherWorkflows = new Map<string, Set<string>>([
      ['southern', new Set(['southern_booking_handler'])],
    ]);
    const lineFinder = (_key: string) => 42;

    const report = validateRoutingConflicts(
      'pelangi',
      routing,
      ownWorkflows,
      otherWorkflows,
      'src/assistant/data/routing.json',
      lineFinder,
    );

    expect(report.violations).toHaveLength(1);
    const v = report.violations[0];
    expect(v).toHaveProperty('intent', 'booking');
    expect(v).toHaveProperty('profile', 'pelangi');
    expect(v).toHaveProperty('handler', 'southern_booking_handler');
    expect(v).toHaveProperty('file', 'src/assistant/data/routing.json');
    expect(v).toHaveProperty('line', 42);
  });

  it('returns empty violations array when no conflicts exist', () => {
    const routing = makeRoutingFile({
      complaint: { action: 'workflow', workflow_id: 'complaint_handling' },
      greeting: { action: 'static_reply' },
    });
    const ownWorkflows = new Set(['complaint_handling']);
    const otherWorkflows = new Map<string, Set<string>>();

    const report = validateRoutingConflicts(
      'pelangi',
      routing,
      ownWorkflows,
      otherWorkflows,
      'src/assistant/data/routing.json',
    );

    expect(report.violations).toEqual([]);
    expect(report.totalViolations).toBe(0);
  });
});

// ── AC2: Parses routing.json and validates handler ownership ─────────

describe('AC2: parses routing.json and validates handler ownership against profile', () => {
  it('validates handler ownership against own profile workflows', () => {
    const routing = makeRoutingFile({
      booking: { action: 'workflow', workflow_id: 'booking_handler' },
      escalate: { action: 'workflow', workflow_id: 'escalate' },
    });
    const ownWorkflows = new Set(['booking_handler', 'escalate']);
    const otherWorkflows = new Map<string, Set<string>>([
      ['makan', new Set(['table_reservation'])],
    ]);

    const report = validateRoutingConflicts(
      'pelangi',
      routing,
      ownWorkflows,
      otherWorkflows,
      'src/assistant/data/routing.json',
    );

    expect(report.totalViolations).toBe(0);
  });

  it('flags handler from foreign profile as violation', () => {
    const routing = makeRoutingFile({
      table_res: {
        action: 'workflow',
        workflow_id: 'table_reservation',
      },
    });
    const ownWorkflows = new Set(['booking_handler']);
    const otherWorkflows = new Map<string, Set<string>>([
      ['makan', new Set(['table_reservation'])],
    ]);

    const report = validateRoutingConflicts(
      'southern',
      routing,
      ownWorkflows,
      otherWorkflows,
      'src/assistant/data-southern/routing.json',
    );

    expect(report.totalViolations).toBe(1);
    expect(report.violations[0].handler).toBe('table_reservation');
  });
});

// ── AC3: Output matches expected violation format ────────────────────

describe('AC3: output includes violations with {intent, profile, handler, file, line}', () => {
  it('violation matches documented format exactly', () => {
    const routing = makeRoutingFile({
      booking: {
        action: 'workflow',
        workflow_id: 'southern_booking_handler',
      },
    });
    const ownWorkflows = new Set<string>();
    const otherWorkflows = new Map<string, Set<string>>([
      ['southern', new Set(['southern_booking_handler'])],
    ]);
    const lineFinder = (_key: string) => 42;

    const report = validateRoutingConflicts(
      'pelangi',
      routing,
      ownWorkflows,
      otherWorkflows,
      'src/assistant/data/routing.json',
      lineFinder,
    );

    // Matches the exact format from AC3:
    // {intent: 'booking', profile: 'pelangi', handler: 'southern_booking_handler',
    //  file: 'src/assistant/data/routing.json', line: 42}
    expect(report.violations[0]).toEqual({
      intent: 'booking',
      profile: 'pelangi',
      handler: 'southern_booking_handler',
      file: 'src/assistant/data/routing.json',
      line: 42,
    });
  });
});

// ── Integration: loads real profile files ─────────────────────────────

describe('Integration: real profile files', () => {
  const profiles = [
    { name: 'pelangi', dir: 'src/assistant/data' },
    { name: 'southern', dir: 'src/assistant/data-southern' },
    { name: 'makan', dir: 'src/assistant/data-makan' },
  ];

  for (const { name, dir } of profiles) {
    const routingPath = path.join(rootDir, dir, 'routing.json');
    const workflowsPath = path.join(rootDir, dir, 'workflows.json');

    it(`loads real ${name} routing and workflows files`, () => {
      const routingData = loadRoutingFile(routingPath);
      const workflowsData = loadWorkflowsFile(workflowsPath);

      expect(Object.keys(routingData).length).toBeGreaterThan(0);
      expect(workflowsData.workflows.length).toBeGreaterThan(0);
    });

    it(`validates ${name} profile routing against own workflows`, () => {
      const routingData = loadRoutingFile(routingPath);
      const workflowsData = loadWorkflowsFile(workflowsPath);
      const ownWorkflows = extractWorkflowIds(workflowsData);

      // Load other profiles' workflows
      const otherProfileWorkflows = new Map<string, Set<string>>();
      for (const other of profiles) {
        if (other.name === name) continue;
        const otherWorkflowsPath = path.join(
          rootDir,
          other.dir,
          'workflows.json',
        );
        if (fs.existsSync(otherWorkflowsPath)) {
          const otherData = loadWorkflowsFile(otherWorkflowsPath);
          otherProfileWorkflows.set(other.name, extractWorkflowIds(otherData));
        }
      }

      const relPath = dir + '/routing.json';
      const report = validateRoutingConflicts(
        name,
        routingData,
        ownWorkflows,
        otherProfileWorkflows,
        relPath,
      );

      expect(report.profile).toBe(name);
      expect(typeof report.totalIntents).toBe('number');
      expect(typeof report.totalViolations).toBe('number');
      expect(Array.isArray(report.violations)).toBe(true);

      // Validate each violation entry structure
      for (const v of report.violations) {
        expect(v).toHaveProperty('intent');
        expect(v).toHaveProperty('profile', name);
        expect(v).toHaveProperty('handler');
        expect(v).toHaveProperty('file');
        expect(v).toHaveProperty('line');
        expect(typeof v.line).toBe('number');
      }
    });
  }

  it('findLineNumber returns correct line for real routing.json key', () => {
    const routingPath = path.join(rootDir, 'src/assistant/data/routing.json');
    const line = findLineNumber(routingPath, 'booking');

    // booking exists in pelangi routing.json, should return a positive line number
    expect(line).toBeGreaterThan(0);
  });
});
