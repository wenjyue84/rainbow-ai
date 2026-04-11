#!/usr/bin/env tsx
/**
 * US-465: Profile Data File Integrity Checker with Corruption Detection
 *
 * Scans all profile data files (routing.json, workflows.json, knowledge.json,
 * intent-keywords.json) for JSON syntax errors, schema violations, and
 * cross-profile data contamination.
 *
 * Usage:
 *   npm run check:profile-integrity -- --profile data-pelangi
 *   npm run check:profile-integrity -- --profile data-makan
 *   npm run check:profile-integrity -- --profile data-pelangi --repair
 *   npm run check:profile-integrity -- --profile data-pelangi --repair --dry-run
 *
 * Exit codes:
 *   0 — No critical issues found
 *   1 — Critical issues detected
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  routingDataSchema,
  workflowsDataSchema,
  knowledgeDataSchema,
  intentKeywordsDataSchema,
  CONFIG_SCHEMAS,
} from '../assistant/schemas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..', '..');
const ASSISTANT_DIR = path.join(ROOT_DIR, 'src', 'assistant');

// ─── Types ──────────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'warning';
export type ErrorType =
  | 'invalid_json'
  | 'schema_violation'
  | 'missing_required_field'
  | 'unknown_workflow_reference'
  | 'cross_profile_contamination'
  | 'git_conflict_marker';

export interface IntegrityIssue {
  file: string;
  errorType: ErrorType;
  severity: Severity;
  message: string;
  line?: number;
  field?: string;
  suggestion?: string;
}

export interface IntegrityReport {
  profile: string;
  profileDir: string;
  timestamp: string;
  filesChecked: string[];
  issues: IntegrityIssue[];
  criticalCount: number;
  warningCount: number;
  passed: boolean;
}

// ─── Profile directory resolver ─────────────────────────────────────────────

function resolveProfileDir(profileId: string): string {
  if (profileId === 'data-pelangi' || profileId === 'data') {
    return path.join(ASSISTANT_DIR, 'data');
  }
  return path.join(ASSISTANT_DIR, profileId);
}

// ─── Pelangi-specific terms (must not appear in non-Pelangi profiles) ───────

const PELANGI_EXCLUSIVE_TERMS = [
  'capsule',
  'pelangi',
  'dorm',
  'dormitory',
  'hostel_booking',
  'capsule_conflict',
  'lower_deck_preference',
  'card_locked',
  'theft_report',
  'luggage_storage',
  'late_checkout_request',
  'stay_extension',
  'extend_stay',
  'room_type_inquiry',
  'facility_orientation',
  'checkin_info',
  'checkout_now',
  'checkout_procedure',
];

const NON_PELANGI_PROFILES = ['data-makan', 'data-southern', 'data-yoongmei'];

// ─── Files to check per profile ─────────────────────────────────────────────

const PROFILE_FILES_TO_CHECK = [
  'routing.json',
  'workflows.json',
  'knowledge.json',
  'intent-keywords.json',
] as const;

// ─── JSON parser with line-number tracking ──────────────────────────────────

function parseJsonWithLineInfo(content: string): { data: unknown; error: string | null; line?: number } {
  // Check for git conflict markers first
  const conflictMatch = content.match(/^(<{7}|={7}|>{7})/m);
  if (conflictMatch) {
    const line = content.substring(0, content.indexOf(conflictMatch[0])).split('\n').length;
    return { data: null, error: `Git conflict marker found: '${conflictMatch[0]}'`, line };
  }

  try {
    const data = JSON.parse(content);
    return { data, error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Extract line number from error message: "at line N column M"
    const lineMatch = msg.match(/line (\d+)/i);
    const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
    return { data: null, error: msg, line };
  }
}

// ─── Auto-repair helpers ─────────────────────────────────────────────────────

function repairTrailingCommas(content: string): { fixed: string; changes: string[] } {
  const changes: string[] = [];
  // Remove trailing commas before } or ]
  const fixed = content.replace(/,(\s*[}\]])/g, (_, suffix) => {
    changes.push('Removed trailing comma');
    return suffix;
  });
  return { fixed, changes };
}

// ─── ProfileIntegrityChecker class ──────────────────────────────────────────

export class ProfileIntegrityChecker {
  private profileDir: string;

  constructor(private readonly profileId: string) {
    this.profileDir = resolveProfileDir(profileId);
  }

  check(): IntegrityReport {
    const report: IntegrityReport = {
      profile: this.profileId,
      profileDir: this.profileDir,
      timestamp: new Date().toISOString(),
      filesChecked: [],
      issues: [],
      criticalCount: 0,
      warningCount: 0,
      passed: true,
    };

    if (!fs.existsSync(this.profileDir)) {
      report.issues.push({
        file: this.profileDir,
        errorType: 'missing_required_field',
        severity: 'critical',
        message: `Profile directory does not exist: ${this.profileDir}`,
        suggestion: `Create directory and add required JSON files`,
      });
      report.criticalCount++;
      report.passed = false;
      return report;
    }

    // Load workflows.json first (needed for workflow_id cross-reference)
    let workflowIds: Set<string> = new Set();
    const workflowsPath = path.join(this.profileDir, 'workflows.json');
    if (fs.existsSync(workflowsPath)) {
      const raw = fs.readFileSync(workflowsPath, 'utf8');
      const parsed = parseJsonWithLineInfo(raw);
      if (parsed.data && typeof parsed.data === 'object' && 'workflows' in parsed.data) {
        const wfData = parsed.data as { workflows: Array<{ id: string }> };
        workflowIds = new Set(wfData.workflows.map(w => w.id));
      }
    }

    for (const filename of PROFILE_FILES_TO_CHECK) {
      const filePath = path.join(this.profileDir, filename);

      if (!fs.existsSync(filePath)) {
        // Not all profiles have all files — just warn
        report.issues.push({
          file: filePath,
          errorType: 'missing_required_field',
          severity: 'warning',
          message: `File not found: ${filename}`,
          suggestion: `Create ${filename} if this profile requires it`,
        });
        report.warningCount++;
        continue;
      }

      report.filesChecked.push(filePath);
      const content = fs.readFileSync(filePath, 'utf8');

      // 1. Check for git conflict markers
      const conflictMarkerIssues = this.checkConflictMarkers(filePath, content);
      report.issues.push(...conflictMarkerIssues);

      // If conflict markers exist, skip further parsing
      if (conflictMarkerIssues.length > 0) {
        report.criticalCount += conflictMarkerIssues.filter(i => i.severity === 'critical').length;
        report.warningCount += conflictMarkerIssues.filter(i => i.severity === 'warning').length;
        continue;
      }

      // 2. Parse JSON
      const { data, error, line } = parseJsonWithLineInfo(content);
      if (error || data === null) {
        report.issues.push({
          file: filePath,
          errorType: 'invalid_json',
          severity: 'critical',
          message: `JSON parse error: ${error}`,
          line,
          suggestion: 'Check for trailing commas, missing quotes, or mismatched brackets. Run with --repair to auto-fix trailing commas.',
        });
        report.criticalCount++;
        continue;
      }

      // 3. Schema validation
      const schemaIssues = this.validateSchema(filePath, filename, data);
      report.issues.push(...schemaIssues);
      report.criticalCount += schemaIssues.filter(i => i.severity === 'critical').length;
      report.warningCount += schemaIssues.filter(i => i.severity === 'warning').length;

      // 4. Routing.json specific: cross-reference workflow_ids
      if (filename === 'routing.json') {
        const refIssues = this.checkRoutingWorkflowRefs(filePath, data, workflowIds);
        report.issues.push(...refIssues);
        report.criticalCount += refIssues.filter(i => i.severity === 'critical').length;
        report.warningCount += refIssues.filter(i => i.severity === 'warning').length;
      }

      // 5. Cross-profile contamination for non-Pelangi profiles
      if (NON_PELANGI_PROFILES.includes(this.profileId)) {
        const contamIssues = this.checkCrossProfileContamination(filePath, content, data);
        report.issues.push(...contamIssues);
        report.criticalCount += contamIssues.filter(i => i.severity === 'critical').length;
        report.warningCount += contamIssues.filter(i => i.severity === 'warning').length;
      }
    }

    report.passed = report.criticalCount === 0;
    return report;
  }

  repair(dryRun = false): { repaired: string[]; skipped: string[]; errors: string[] } {
    const repaired: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const filename of PROFILE_FILES_TO_CHECK) {
      const filePath = path.join(this.profileDir, filename);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf8');

      // Check if it has git conflict markers — cannot auto-repair
      if (/^(<{7}|={7}|>{7})/m.test(content)) {
        skipped.push(`${filename}: has git conflict markers — requires manual resolution`);
        continue;
      }

      // Try to parse — if already valid, skip
      try {
        JSON.parse(content);
        skipped.push(`${filename}: already valid JSON, no repair needed`);
        continue;
      } catch {
        // Needs repair — try trailing comma removal
        const { fixed, changes } = repairTrailingCommas(content);

        try {
          JSON.parse(fixed);
          if (dryRun) {
            repaired.push(`${filename} (dry-run): would fix — ${changes.join(', ')}`);
          } else {
            fs.writeFileSync(filePath, fixed, 'utf8');
            repaired.push(`${filename}: fixed — ${changes.join(', ')}`);
          }
        } catch (e2) {
          const msg = e2 instanceof Error ? e2.message : String(e2);
          errors.push(`${filename}: cannot auto-repair — ${msg}. Manual fix required.`);
        }
      }
    }

    return { repaired, skipped, errors };
  }

  private checkConflictMarkers(filePath: string, content: string): IntegrityIssue[] {
    const issues: IntegrityIssue[] = [];
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (/^(<{7}|={7}|>{7})/.test(line)) {
        issues.push({
          file: filePath,
          errorType: 'git_conflict_marker',
          severity: 'critical',
          message: `Git conflict marker found: '${line.substring(0, 20)}...'`,
          line: idx + 1,
          suggestion: 'Resolve git merge conflict manually before running integrity check',
        });
      }
    });
    return issues;
  }

  private validateSchema(filePath: string, filename: string, data: unknown): IntegrityIssue[] {
    const issues: IntegrityIssue[] = [];
    const schema = CONFIG_SCHEMAS[filename as keyof typeof CONFIG_SCHEMAS];
    if (!schema) return issues;

    const result = schema.safeParse(data);
    if (!result.success) {
      for (const err of result.error.errors) {
        const fieldPath = err.path.join('.');
        issues.push({
          file: filePath,
          errorType: err.message.includes('required') ? 'missing_required_field' : 'schema_violation',
          severity: 'critical',
          message: `Schema violation at '${fieldPath || 'root'}': ${err.message}`,
          field: fieldPath || undefined,
          suggestion: `Fix the field '${fieldPath}' to match the expected schema`,
        });
      }
    }
    return issues;
  }

  private checkRoutingWorkflowRefs(
    filePath: string,
    data: unknown,
    availableWorkflowIds: Set<string>,
  ): IntegrityIssue[] {
    const issues: IntegrityIssue[] = [];
    if (!availableWorkflowIds.size) return issues; // No workflows.json to cross-reference

    if (typeof data !== 'object' || data === null) return issues;
    const routing = data as Record<string, { action: string; workflow_id?: string }>;

    for (const [intent, entry] of Object.entries(routing)) {
      if (entry.workflow_id && !availableWorkflowIds.has(entry.workflow_id)) {
        issues.push({
          file: filePath,
          errorType: 'unknown_workflow_reference',
          severity: 'warning',
          message: `Intent '${intent}' references unknown workflow_id '${entry.workflow_id}'`,
          field: `${intent}.workflow_id`,
          suggestion: `Add workflow '${entry.workflow_id}' to workflows.json, or correct the workflow_id`,
        });
      }
    }
    return issues;
  }

  private checkCrossProfileContamination(
    filePath: string,
    rawContent: string,
    data: unknown,
  ): IntegrityIssue[] {
    const issues: IntegrityIssue[] = [];
    const filename = path.basename(filePath);
    const contentLower = rawContent.toLowerCase();

    // Check raw content for Pelangi exclusive terms
    for (const term of PELANGI_EXCLUSIVE_TERMS) {
      if (contentLower.includes(term.toLowerCase())) {
        // Find line number
        const lines = rawContent.split('\n');
        const lineIdx = lines.findIndex(l => l.toLowerCase().includes(term.toLowerCase()));
        issues.push({
          file: filePath,
          errorType: 'cross_profile_contamination',
          severity: 'critical',
          message: `Pelangi-specific term '${term}' found in ${this.profileId}/${filename}`,
          line: lineIdx >= 0 ? lineIdx + 1 : undefined,
          suggestion: `Remove or replace '${term}' — this is a Pelangi capsule hostel concept not applicable to this profile`,
        });
      }
    }

    // For intent-keywords.json: also check intent names
    if (filename === 'intent-keywords.json' && data && typeof data === 'object' && 'intents' in data) {
      const kwData = data as { intents: Array<{ intent: string }> };
      for (const entry of kwData.intents) {
        if (PELANGI_EXCLUSIVE_TERMS.includes(entry.intent)) {
          issues.push({
            file: filePath,
            errorType: 'cross_profile_contamination',
            severity: 'critical',
            message: `Pelangi-exclusive intent '${entry.intent}' found in ${this.profileId} intent-keywords`,
            field: `intents[].intent`,
            suggestion: `Remove intent '${entry.intent}' from this profile's intent-keywords.json`,
          });
        }
      }
    }

    return issues;
  }
}

// ─── Human-readable report formatter ────────────────────────────────────────

function formatReport(report: IntegrityReport): string {
  const lines: string[] = [];
  const STATUS = report.passed ? '✓ PASSED' : '✗ FAILED';

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push(`Profile Integrity Report — ${report.profile}`);
  lines.push(`Status: ${STATUS}  |  Critical: ${report.criticalCount}  |  Warnings: ${report.warningCount}`);
  lines.push(`Directory: ${report.profileDir}`);
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push('═══════════════════════════════════════════════════════════════');

  if (report.filesChecked.length > 0) {
    lines.push(`\nFiles checked (${report.filesChecked.length}):`);
    for (const f of report.filesChecked) {
      lines.push(`  ✓ ${path.basename(f)}`);
    }
  }

  if (report.issues.length === 0) {
    lines.push('\n✓ No issues found — all profile data files are valid.');
  } else {
    lines.push(`\nIssues found (${report.issues.length}):`);
    lines.push('');

    const criticals = report.issues.filter(i => i.severity === 'critical');
    const warnings = report.issues.filter(i => i.severity === 'warning');

    if (criticals.length > 0) {
      lines.push(`[CRITICAL] ${criticals.length} issue(s):`);
      for (const issue of criticals) {
        lines.push(`  ✗ [${issue.errorType}] ${path.basename(issue.file)}${issue.line ? `:${issue.line}` : ''}`);
        lines.push(`      ${issue.message}`);
        if (issue.suggestion) lines.push(`      → ${issue.suggestion}`);
      }
      lines.push('');
    }

    if (warnings.length > 0) {
      lines.push(`[WARNING] ${warnings.length} issue(s):`);
      for (const issue of warnings) {
        lines.push(`  ⚠ [${issue.errorType}] ${path.basename(issue.file)}${issue.line ? `:${issue.line}` : ''}`);
        lines.push(`      ${issue.message}`);
        if (issue.suggestion) lines.push(`      → ${issue.suggestion}`);
      }
    }
  }

  lines.push('\n═══════════════════════════════════════════════════════════════');
  return lines.join('\n');
}

// ─── CLI entrypoint ──────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  const profileIdx = args.indexOf('--profile');
  const profileId = profileIdx >= 0 ? args[profileIdx + 1] : 'data-pelangi';
  const doRepair = args.includes('--repair');
  const dryRun = args.includes('--dry-run');
  const jsonOutput = args.includes('--json');

  if (!profileId) {
    console.error('Error: --profile <profileId> is required');
    console.error('Example: npm run check:profile-integrity -- --profile data-pelangi');
    process.exit(1);
  }

  const checker = new ProfileIntegrityChecker(profileId);

  if (doRepair) {
    console.log(`\nRepairing profile: ${profileId}${dryRun ? ' (dry-run)' : ''}...\n`);
    const result = checker.repair(dryRun);

    if (result.repaired.length > 0) {
      console.log('Repaired:');
      result.repaired.forEach(r => console.log(`  ✓ ${r}`));
    }
    if (result.skipped.length > 0) {
      console.log('Skipped:');
      result.skipped.forEach(s => console.log(`  - ${s}`));
    }
    if (result.errors.length > 0) {
      console.log('Could not auto-repair (manual fix required):');
      result.errors.forEach(e => console.log(`  ✗ ${e}`));
    }
    console.log('');
  }

  const report = checker.check();

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }

  process.exit(report.passed ? 0 : 1);
}

// Run CLI if this file is the entry point
const isMain = process.argv[1] &&
  (process.argv[1].endsWith('profile-integrity-checker.ts') ||
   process.argv[1].endsWith('profile-integrity-checker.js'));

if (isMain) {
  main();
}
