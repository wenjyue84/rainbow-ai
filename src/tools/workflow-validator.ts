import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export interface ValidationError {
  line: number;
  field: string;
  message: string;
  step?: { id?: string; type?: string };
  severity: 'error' | 'warning';
}

export interface RepairSuggestion {
  step_id: string;
  workflow_id: string;
  issue: string;
  suggested_fix: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  repairs: RepairSuggestion[];
  summary: {
    total_steps: number;
    error_count: number;
    warning_count: number;
    repair_count: number;
  };
}

// Valid step types that are allowed in workflows
const VALID_STEP_TYPES = [
  'verification_code_generator',
  'code_validator',
  'error_handler',
  'verification_code',
  'message',
  'action',
  'condition',
  'payment',
  'notification',
  'escalation',
  'booking_confirmation',
  'fallback'
];

// Required fields for each step
const REQUIRED_STEP_FIELDS = ['id', 'type'];

export function validateWorkflowsFile(filePath: string): ValidationReport {
  const report: ValidationReport = {
    valid: true,
    errors: [],
    warnings: [],
    repairs: [],
    summary: {
      total_steps: 0,
      error_count: 0,
      warning_count: 0,
      repair_count: 0
    }
  };

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Check for merge conflict markers
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('<<<<<<') || line.includes('======') || line.includes('>>>>>>>')) {
        report.errors.push({
          line: i + 1,
          field: 'merge_conflict',
          message: 'Merge conflict marker found in file',
          severity: 'error'
        });
        report.repairs.push({
          step_id: 'merge_conflict',
          workflow_id: 'global',
          issue: 'File contains unresolved merge conflicts',
          suggested_fix: 'Resolve merge conflicts manually or use git merge tools. Remove <<<<<<, ======, and >>>>>>> markers.',
          severity: 'critical'
        });
      }
    }

    // Parse JSON
    let workflows;
    try {
      workflows = JSON.parse(content);
    } catch (e) {
      report.errors.push({
        line: 1,
        field: 'json_parse',
        message: `JSON parse error: ${e instanceof Error ? e.message : 'Unknown error'}`,
        severity: 'error'
      });
      report.valid = false;
      report.summary.error_count = report.errors.length;
      return report;
    }

    // Validate structure
    if (!workflows.workflows || !Array.isArray(workflows.workflows)) {
      report.errors.push({
        line: 1,
        field: 'workflows_array',
        message: 'Root "workflows" must be an array',
        severity: 'error'
      });
      report.valid = false;
      report.summary.error_count = report.errors.length;
      return report;
    }

    // Validate each workflow and step
    for (const workflow of workflows.workflows) {
      if (!workflow.id) {
        report.warnings.push({
          line: 1,
          field: 'workflow_id',
          message: 'Workflow missing "id" field',
          severity: 'warning'
        });
      }

      if (!Array.isArray(workflow.steps)) {
        report.errors.push({
          line: 1,
          field: 'workflow_steps',
          message: `Workflow "${workflow.id || 'unknown'}" missing "steps" array`,
          severity: 'error'
        });
        continue;
      }

      for (const step of workflow.steps) {
        report.summary.total_steps++;

        // Check required fields
        for (const field of REQUIRED_STEP_FIELDS) {
          if (!step[field]) {
            const errorMsg = `Step missing required field "${field}"`;
            report.errors.push({
              line: 1,
              field: field,
              message: errorMsg,
              step: { id: step.id, type: step.type },
              severity: 'error'
            });
            report.repairs.push({
              step_id: step.id || 'unknown',
              workflow_id: workflow.id || 'unknown',
              issue: errorMsg,
              suggested_fix: `Add "${field}" field to step. Example: "${field}": "value"`,
              severity: 'critical'
            });
          }
        }

        // Check step type validity
        if (step.type && !VALID_STEP_TYPES.includes(step.type)) {
          const errorMsg = `Invalid step type "${step.type}"`;
          report.warnings.push({
            line: 1,
            field: 'step_type',
            message: errorMsg,
            step: { id: step.id, type: step.type },
            severity: 'warning'
          });

          // Find closest valid type
          const closest = findClosestMatch(step.type, VALID_STEP_TYPES);
          report.repairs.push({
            step_id: step.id || 'unknown',
            workflow_id: workflow.id || 'unknown',
            issue: errorMsg,
            suggested_fix: `Change type to one of: ${VALID_STEP_TYPES.join(', ')}. Did you mean "${closest}"?`,
            severity: 'high'
          });
        }

        // Check for action field consistency
        const hasAction = 'action' in step;
        const hasConfig = 'config' in step;
        if (!hasAction && !hasConfig && step.type !== 'message') {
          report.warnings.push({
            line: 1,
            field: 'action_or_config',
            message: `Step "${step.id}" has no "action" or "config" field`,
            step: { id: step.id, type: step.type },
            severity: 'warning'
          });
          report.repairs.push({
            step_id: step.id || 'unknown',
            workflow_id: workflow.id || 'unknown',
            issue: 'Step missing action definition',
            suggested_fix: 'Add "action" field to define the step behavior. Example: "action": "processPayment"',
            severity: 'high'
          });
        }

        // Check message structure
        if (step.message) {
          if (typeof step.message === 'object' && !('en' in step.message)) {
            report.warnings.push({
              line: 1,
              field: 'message_language',
              message: `Message object in step "${step.id}" missing "en" language`,
              step: { id: step.id, type: step.type },
              severity: 'warning'
            });
          }
        }
      }
    }

    // Finalize report
    report.valid = report.errors.length === 0;
    report.summary.error_count = report.errors.length;
    report.summary.warning_count = report.warnings.length;
    report.summary.repair_count = report.repairs.length;

  } catch (err) {
    report.errors.push({
      line: 1,
      field: 'file_read',
      message: `Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`,
      severity: 'error'
    });
    report.valid = false;
    report.summary.error_count = report.errors.length;
  }

  return report;
}

export function generateRepairSuggestions(
  filePath: string,
  outputPath: string
): RepairSuggestion[] {
  const report = validateWorkflowsFile(filePath);
  writeFileSync(outputPath, JSON.stringify(report.repairs, null, 2));
  return report.repairs;
}

export function applyRepairs(
  filePath: string,
  repairs: RepairSuggestion[],
  dryRun: boolean = false
): { applied: number; skipped: number; errors: string[] } {
  const result = { applied: 0, skipped: 0, errors: [] };

  try {
    let content = readFileSync(filePath, 'utf-8');

    // Auto-repair merge conflicts is complex without manual intervention
    // So we provide guidance rather than auto-fix
    const hasMergeConflicts = repairs.some(r => r.issue.includes('merge conflict'));
    if (hasMergeConflicts) {
      result.errors.push('Cannot auto-repair merge conflicts. Please resolve manually using git merge tools.');
      return result;
    }

    // For now, just report what we found
    // Real auto-repair would need more sophisticated JSON manipulation
    result.skipped = repairs.length;

  } catch (err) {
    result.errors.push(`Error applying repairs: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  return result;
}

function findClosestMatch(input: string, validTypes: string[]): string {
  let closest = validTypes[0];
  let minDistance = levenshteinDistance(input, closest);

  for (const type of validTypes) {
    const distance = levenshteinDistance(input, type);
    if (distance < minDistance) {
      minDistance = distance;
      closest = type;
    }
  }

  return closest;
}

function levenshteinDistance(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= bLen; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= aLen; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= bLen; i++) {
    for (let j = 1; j <= aLen; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[bLen][aLen];
}

export function formatValidationReport(report: ValidationReport): string {
  let output = '';

  output += `WORKFLOW VALIDATION REPORT\n`;
  output += `${'='.repeat(50)}\n\n`;

  output += `Summary:\n`;
  output += `  Total Steps: ${report.summary.total_steps}\n`;
  output += `  Errors: ${report.summary.error_count}\n`;
  output += `  Warnings: ${report.summary.warning_count}\n`;
  output += `  Repairs Suggested: ${report.summary.repair_count}\n`;
  output += `  Status: ${report.valid ? '✓ VALID' : '✗ INVALID'}\n\n`;

  if (report.errors.length > 0) {
    output += `ERRORS:\n`;
    for (const error of report.errors) {
      output += `  Line ${error.line}: ${error.field}\n`;
      output += `    ${error.message}\n`;
      if (error.step) {
        output += `    Step: ${error.step.id || 'unknown'} (type: ${error.step.type || 'unknown'})\n`;
      }
      output += '\n';
    }
  }

  if (report.warnings.length > 0) {
    output += `WARNINGS:\n`;
    for (const warning of report.warnings) {
      output += `  Line ${warning.line}: ${warning.field}\n`;
      output += `    ${warning.message}\n`;
      if (warning.step) {
        output += `    Step: ${warning.step.id || 'unknown'} (type: ${warning.step.type || 'unknown'})\n`;
      }
      output += '\n';
    }
  }

  if (report.repairs.length > 0) {
    output += `REPAIR SUGGESTIONS:\n`;
    for (const repair of report.repairs) {
      output += `  [${repair.severity.toUpperCase()}] ${repair.issue}\n`;
      output += `    Workflow: ${repair.workflow_id}, Step: ${repair.step_id}\n`;
      output += `    Fix: ${repair.suggested_fix}\n\n`;
    }
  }

  return output;
}
