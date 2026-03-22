import { describe, it, expect } from 'vitest';
import {
  validateWorkflowStepDependencies,
  validateAllWorkflows,
  WorkflowValidationError,
} from '../workflowValidator.js';

describe('validateWorkflowStepDependencies', () => {
  describe('valid workflows', () => {
    it('should pass a simple linear workflow', () => {
      const result = validateWorkflowStepDependencies({
        id: 'linear_flow',
        startNodeId: 'step_a',
        nodes: [
          { id: 'step_a', type: 'wait_reply', next: 'step_b' },
          { id: 'step_b', type: 'message', next: 'step_c' },
          { id: 'step_c', type: 'message' },
        ],
      });
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should pass with condition branching and no cycle', () => {
      const result = validateWorkflowStepDependencies({
        id: 'branch_flow',
        nodes: [
          { id: 'check', type: 'condition', config: { trueNext: 'success', falseNext: 'failure' } },
          { id: 'success', type: 'message' },
          { id: 'failure', type: 'message' },
        ],
      });
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should pass with no nodes', () => {
      const result = validateWorkflowStepDependencies({ id: 'empty_flow', nodes: [] });
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should pass with null next', () => {
      const result = validateWorkflowStepDependencies({
        id: 'null_next',
        nodes: [{ id: 'step_a', type: 'message', next: null }],
      });
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('safe reprompt loops - warnings only', () => {
    it('should warn but not throw for cycle through wait_reply', () => {
      const result = validateWorkflowStepDependencies({
        id: 'reprompt_flow',
        nodes: [
          { id: 'ask_dates', type: 'wait_reply', next: 'validate' },
          { id: 'validate', type: 'condition', config: { trueNext: 'confirm', falseNext: 'error_msg' } },
          { id: 'error_msg', type: 'message', next: 'ask_dates' },
          { id: 'confirm', type: 'message' },
        ],
      });
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Reprompt loop');
    });

    it('should warn for cycle through collect_input', () => {
      const result = validateWorkflowStepDependencies({
        id: 'collect_loop',
        nodes: [
          { id: 'collect', type: 'collect_input', next: 'process' },
          { id: 'process', type: 'message', next: 'collect' },
        ],
      });
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Reprompt loop');
    });
  });

  describe('circular dependency detection - throws', () => {
    it('should detect non-blocking cycle A-B-A', () => {
      expect(() =>
        validateWorkflowStepDependencies({
          id: 'cycle_flow',
          nodes: [
            { id: 'step_a', type: 'message', next: 'step_b' },
            { id: 'step_b', type: 'message', next: 'step_a' },
          ],
        })
      ).toThrow(WorkflowValidationError);
    });

    it('should detect longer cycle A-B-C-A', () => {
      let caughtError: WorkflowValidationError | null = null;
      try {
        validateWorkflowStepDependencies({
          id: 'long_cycle',
          nodes: [
            { id: 'a', type: 'message', next: 'b' },
            { id: 'b', type: 'condition', config: { trueNext: 'c', falseNext: 'c' } },
            { id: 'c', type: 'function', next: 'a' },
          ],
        });
      } catch (err) {
        if (err instanceof WorkflowValidationError) caughtError = err;
      }
      expect(caughtError).not.toBeNull();
      expect(caughtError!.details.some(d => d.includes('Circular'))).toBe(true);
    });

    it('should detect self-loop via condition trueNext', () => {
      expect(() =>
        validateWorkflowStepDependencies({
          id: 'condition_cycle',
          nodes: [
            { id: 'check', type: 'condition', config: { trueNext: 'check', falseNext: 'end' } },
            { id: 'end', type: 'message' },
          ],
        })
      ).toThrow(WorkflowValidationError);
    });

    it('should detect cycle via falseNext without blocking node', () => {
      expect(() =>
        validateWorkflowStepDependencies({
          id: 'false_cycle',
          nodes: [
            { id: 'a', type: 'condition', config: { trueNext: 'b', falseNext: 'c' } },
            { id: 'b', type: 'message' },
            { id: 'c', type: 'condition', config: { trueNext: 'a', falseNext: 'b' } },
          ],
        })
      ).toThrow(WorkflowValidationError);
    });
  });

  describe('invalid state references', () => {
    it('should detect reference to undefined node via next', () => {
      let caughtError: WorkflowValidationError | null = null;
      try {
        validateWorkflowStepDependencies({
          id: 'missing_ref',
          nodes: [{ id: 'step_a', type: 'message', next: 'nonexistent_node' }],
        });
      } catch (err) {
        if (err instanceof WorkflowValidationError) caughtError = err;
      }
      expect(caughtError).not.toBeNull();
      expect(caughtError!.details.some(d => d.includes('nonexistent_node'))).toBe(true);
    });

    it('should detect undefined node in condition trueNext', () => {
      let caughtError: WorkflowValidationError | null = null;
      try {
        validateWorkflowStepDependencies({
          id: 'bad_condition',
          nodes: [
            { id: 'check', type: 'condition', config: { trueNext: 'missing_true', falseNext: 'end' } },
            { id: 'end', type: 'message' },
          ],
        });
      } catch (err) {
        if (err instanceof WorkflowValidationError) caughtError = err;
      }
      expect(caughtError).not.toBeNull();
      expect(caughtError!.details.some(d => d.includes('missing_true'))).toBe(true);
    });

    it('should detect missing startNodeId', () => {
      let caughtError: WorkflowValidationError | null = null;
      try {
        validateWorkflowStepDependencies({
          id: 'bad_start',
          startNodeId: 'no_such_node',
          nodes: [{ id: 'step_a', type: 'message' }],
        });
      } catch (err) {
        if (err instanceof WorkflowValidationError) caughtError = err;
      }
      expect(caughtError).not.toBeNull();
      expect(caughtError!.details.some(d => d.includes('startNodeId'))).toBe(true);
    });
  });

  describe('error structure', () => {
    it('should set workflowId and name on the error', () => {
      let caughtError: WorkflowValidationError | null = null;
      try {
        validateWorkflowStepDependencies({
          id: 'my_workflow',
          nodes: [
            { id: 'a', type: 'message', next: 'b' },
            { id: 'b', type: 'message', next: 'a' },
          ],
        });
      } catch (err) {
        if (err instanceof WorkflowValidationError) caughtError = err;
      }
      expect(caughtError?.workflowId).toBe('my_workflow');
      expect(caughtError?.name).toBe('WorkflowValidationError');
    });
  });
});

describe('validateAllWorkflows', () => {
  it('should return empty report when all valid', () => {
    const report = validateAllWorkflows({
      workflows: [
        { id: 'wf1', nodes: [{ id: 'a', type: 'message', next: 'b' }, { id: 'b', type: 'message' }] },
        { id: 'wf2', nodes: [{ id: 'x', type: 'message' }] },
      ],
    });
    expect(report.errors).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });

  it('should return errors and warnings separately', () => {
    const report = validateAllWorkflows({
      workflows: [
        { id: 'good_wf', nodes: [{ id: 'a', type: 'message' }] },
        {
          id: 'bad_wf_cycle',
          nodes: [
            { id: 'a', type: 'message', next: 'b' },
            { id: 'b', type: 'message', next: 'a' },
          ],
        },
        {
          id: 'warn_wf_reprompt',
          nodes: [
            { id: 'ask', type: 'wait_reply', next: 'process' },
            { id: 'process', type: 'message', next: 'ask' },
          ],
        },
      ],
    });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].workflowId).toBe('bad_wf_cycle');
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0].workflowId).toBe('warn_wf_reprompt');
  });

  it('should handle empty workflows array', () => {
    const report = validateAllWorkflows({ workflows: [] });
    expect(report.errors).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });
});
