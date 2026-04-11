import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import {
  validateWorkflowsFile,
  generateRepairSuggestions,
  formatValidationReport,
  ValidationReport
} from '../../src/tools/workflow-validator.js';

const TEST_DIR = resolve('test-workflows');
const TEST_FILE = resolve(TEST_DIR, 'test-workflows.json');

beforeEach(() => {
  try {
    mkdirSync(TEST_DIR, { recursive: true });
  } catch (e) {
    // Directory might already exist
  }
});

afterEach(() => {
  try {
    unlinkSync(TEST_FILE);
  } catch (e) {
    // File might not exist
  }
  try {
    unlinkSync(resolve(TEST_DIR, 'repair-suggestions.json'));
  } catch (e) {
    // File might not exist
  }
});

describe('Workflow Validator', () => {
  describe('Valid Workflows', () => {
    it('should validate a well-formed workflow', () => {
      const workflows = {
        workflows: [
          {
            id: 'test_workflow',
            name: 'Test Workflow',
            steps: [
              {
                id: 'step1',
                type: 'verification_code',
                action: 'generateCode',
                message: { en: 'Please verify' }
              }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
      expect(report.summary.total_steps).toBe(1);
    });

    it('should pass workflow with all valid step types', () => {
      const validTypes = [
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

      const steps = validTypes.map((type, idx) => ({
        id: `step_${idx}`,
        type: type,
        action: `action_${idx}`
      }));

      const workflows = {
        workflows: [
          {
            id: 'test_all_types',
            name: 'All Types Test',
            steps: steps
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.errors.filter(e => e.field === 'step_type')).toHaveLength(0);
    });
  });

  describe('Missing Required Fields', () => {
    it('should detect missing step id', () => {
      const workflows = {
        workflows: [
          {
            id: 'test',
            steps: [
              {
                type: 'message',
                action: 'process'
              }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors.some(e => e.field === 'id')).toBe(true);
      expect(report.valid).toBe(false);
    });

    it('should detect missing step type', () => {
      const workflows = {
        workflows: [
          {
            id: 'test',
            steps: [
              {
                id: 'step1',
                action: 'process'
              }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors.some(e => e.field === 'type')).toBe(true);
    });
  });

  describe('Invalid Step Types', () => {
    it('should warn on invalid step type', () => {
      const workflows = {
        workflows: [
          {
            id: 'test',
            steps: [
              {
                id: 'step1',
                type: 'invalid_type_xyz',
                action: 'process'
              }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.warnings.length).toBeGreaterThan(0);
      expect(report.warnings.some(e => e.field === 'step_type')).toBe(true);
    });

    it('should suggest closest valid type for typos', () => {
      const workflows = {
        workflows: [
          {
            id: 'test',
            steps: [
              {
                id: 'step1',
                type: 'verificaton_code', // typo: verificaton -> verification
                action: 'process'
              }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.repairs.length).toBeGreaterThan(0);
      const repair = report.repairs.find(r => r.issue.includes('Invalid step type'));
      expect(repair).toBeDefined();
      expect(repair!.suggested_fix).toContain('verification_code');
    });
  });

  describe('Merge Conflict Detection', () => {
    it('should detect merge conflict markers', () => {
      const content = `{
  "workflows": [
<<<<<<< Updated upstream
    {"id": "test"}
=======
    {"id": "other"}
>>>>>>> Stashed changes
  ]
}`;

      writeFileSync(TEST_FILE, content);
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors.some(e => e.field === 'merge_conflict')).toBe(true);
      expect(report.valid).toBe(false);
    });

    it('should mark merge conflicts as critical severity', () => {
      const content = `{
  "workflows": [
<<<<<<< Updated upstream
    {"id": "test"}
=======
    {"id": "other"}
>>>>>>> Stashed changes
  ]
}`;

      writeFileSync(TEST_FILE, content);
      const report = validateWorkflowsFile(TEST_FILE);

      const repair = report.repairs.find(r => r.severity === 'critical');
      expect(repair).toBeDefined();
      expect(repair?.issue).toContain('merge conflict');
    });
  });

  describe('Action/Config Validation', () => {
    it('should warn when action and config are both missing', () => {
      const workflows = {
        workflows: [
          {
            id: 'test',
            steps: [
              {
                id: 'step1',
                type: 'payment',
                message: { en: 'Pay' }
              }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.warnings.some(w => w.field === 'action_or_config')).toBe(true);
    });

    it('should allow step with action field', () => {
      const workflows = {
        workflows: [
          {
            id: 'test',
            steps: [
              {
                id: 'step1',
                type: 'payment',
                action: 'processPayment'
              }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      const actionWarnings = report.warnings.filter(w => w.field === 'action_or_config');
      expect(actionWarnings).toHaveLength(0);
    });

    it('should allow step with config field', () => {
      const workflows = {
        workflows: [
          {
            id: 'test',
            steps: [
              {
                id: 'step1',
                type: 'verification_code',
                config: { codeLength: 6 }
              }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      const actionWarnings = report.warnings.filter(w => w.field === 'action_or_config');
      expect(actionWarnings).toHaveLength(0);
    });
  });

  describe('Message Validation', () => {
    it('should accept message with en language', () => {
      const workflows = {
        workflows: [
          {
            id: 'test',
            steps: [
              {
                id: 'step1',
                type: 'message',
                message: { en: 'Hello' }
              }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      const langWarnings = report.warnings.filter(w => w.field === 'message_language');
      expect(langWarnings).toHaveLength(0);
    });

    it('should warn when message object missing en language', () => {
      const workflows = {
        workflows: [
          {
            id: 'test',
            steps: [
              {
                id: 'step1',
                type: 'message',
                message: { ms: 'Halo' }
              }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.warnings.some(w => w.field === 'message_language')).toBe(true);
    });
  });

  describe('Structure Validation', () => {
    it('should reject invalid root structure (missing workflows array)', () => {
      const workflows = { steps: [] };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.valid).toBe(false);
      expect(report.errors.some(e => e.field === 'workflows_array')).toBe(true);
    });

    it('should reject workflow with non-array steps', () => {
      const workflows = {
        workflows: [
          {
            id: 'test',
            steps: 'not an array'
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.valid).toBe(false);
      expect(report.errors.some(e => e.field === 'workflow_steps')).toBe(true);
    });

    it('should handle invalid JSON gracefully', () => {
      writeFileSync(TEST_FILE, '{ invalid json }');
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.valid).toBe(false);
      expect(report.errors.some(e => e.field === 'json_parse')).toBe(true);
    });
  });

  describe('Repair Suggestion Generation', () => {
    it('should generate repair suggestions file', () => {
      const workflows = {
        workflows: [
          {
            id: 'test',
            steps: [
              {
                id: 'step1',
                type: 'invalid_type'
              }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));

      const repairsPath = resolve(TEST_DIR, 'test-repairs.json');
      const repairs = generateRepairSuggestions(TEST_FILE, repairsPath);

      expect(repairs.length).toBeGreaterThan(0);
      expect(repairs[0]).toHaveProperty('step_id');
      expect(repairs[0]).toHaveProperty('suggested_fix');

      // Clean up
      try {
        unlinkSync(repairsPath);
      } catch (e) {
        // ignore
      }
    });

    it('repair suggestions should have severity levels', () => {
      const workflows = {
        workflows: [
          {
            id: 'test',
            steps: [
              {
                type: 'message'
              }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));

      const repairsPath = resolve(TEST_DIR, 'test-repairs.json');
      const repairs = generateRepairSuggestions(TEST_FILE, repairsPath);

      for (const repair of repairs) {
        expect(['critical', 'high', 'medium', 'low']).toContain(repair.severity);
      }

      // Clean up
      try {
        unlinkSync(repairsPath);
      } catch (e) {
        // ignore
      }
    });
  });

  describe('Report Formatting', () => {
    it('should format report as readable text', () => {
      const report: ValidationReport = {
        valid: false,
        errors: [
          {
            line: 10,
            field: 'type',
            message: 'Step missing required field "type"',
            severity: 'error'
          }
        ],
        warnings: [],
        repairs: [
          {
            step_id: 'step1',
            workflow_id: 'test',
            issue: 'Missing type',
            suggested_fix: 'Add type field',
            severity: 'critical'
          }
        ],
        summary: {
          total_steps: 1,
          error_count: 1,
          warning_count: 0,
          repair_count: 1
        }
      };

      const formatted = formatValidationReport(report);

      expect(formatted).toContain('WORKFLOW VALIDATION REPORT');
      expect(formatted).toContain('✗ INVALID');
      expect(formatted).toContain('ERRORS:');
      expect(formatted).toContain('REPAIR SUGGESTIONS:');
      expect(formatted).toContain('Missing type');
    });
  });

  describe('Multiple Workflows', () => {
    it('should validate multiple workflows in one file', () => {
      const workflows = {
        workflows: [
          {
            id: 'workflow1',
            steps: [
              { id: 'step1', type: 'message' }
            ]
          },
          {
            id: 'workflow2',
            steps: [
              { id: 'step2', type: 'verification_code', action: 'verify' },
              { id: 'step3', type: 'payment', action: 'charge' }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.summary.total_steps).toBe(3);
    });

    it('should track errors across multiple workflows', () => {
      const workflows = {
        workflows: [
          {
            id: 'workflow1',
            steps: [
              { id: 'step1', type: 'invalid1' }
            ]
          },
          {
            id: 'workflow2',
            steps: [
              { type: 'message' }, // missing id
              { id: 'step3', type: 'invalid2' }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.warnings.filter(w => w.field === 'step_type').length).toBe(2);
      expect(report.errors.filter(e => e.field === 'id').length).toBeGreaterThan(0);
    });
  });

  describe('Real World Scenarios', () => {
    it('should validate workflow with nested config objects', () => {
      const workflows = {
        workflows: [
          {
            id: 'booking_flow',
            steps: [
              {
                id: 'generate_code',
                type: 'verification_code_generator',
                action: 'generateVerificationCode',
                timeout: 10000,
                message: { en: 'Code sent' },
                sms_provider: {
                  primary: 'twilio',
                  fallback: 'aws-sns',
                  maxRetries: 3,
                  initialDelayMs: 500
                },
                code_config: {
                  length: 6,
                  expiryMinutes: 15,
                  format: 'numeric'
                }
              }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });

    it('should handle workflow with multi-language messages', () => {
      const workflows = {
        workflows: [
          {
            id: 'multilang',
            steps: [
              {
                id: 'greeting',
                type: 'message',
                message: {
                  en: 'Hello',
                  ms: 'Halo',
                  zh: '你好'
                }
              }
            ]
          }
        ]
      };

      writeFileSync(TEST_FILE, JSON.stringify(workflows));
      const report = validateWorkflowsFile(TEST_FILE);

      expect(report.valid).toBe(true);
    });
  });
});
