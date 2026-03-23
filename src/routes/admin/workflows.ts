/**
 * Workflow Management Admin Routes (US-290)
 *
 * POST /debug/profile/:profile/workflow-dry-run — Test workflow execution without DB writes
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { configStore } from '../../assistant/config-store.js';
import { profileRegistry } from '../../assistant/profile-registry.js';
import { ok, badRequest, notFound, serverError } from './http-utils.js';
import type { WorkflowDefinition, WorkflowStep } from '../../assistant/config-store.js';
import type { HybridWorkflowDefinition } from '../../assistant/workflow-nodes.js';
import { isNodeBasedWorkflow } from '../../assistant/workflow-nodes.js';

const router = Router();

// ─── Types ───────────────────────────────────────────────────────────

interface DryRunStep {
  stepId: string;
  stepName?: string;
  output: Record<string, unknown>;
  status: 'success' | 'error' | 'skipped';
  durationMs: number;
  errorDetails?: {
    preconditionViolations?: string[];
    message?: string;
    actionableFix?: string;
  };
}

interface DryRunResponse {
  workflowId: string;
  steps: DryRunStep[];
  totalDurationMs: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  summary?: string;
}

// ─── Helper: Execute Step-Based Workflow (Legacy Format) ──────────────

async function executeStepBasedWorkflow(
  workflow: WorkflowDefinition,
  testRequest: Record<string, unknown>,
  collectedData: Record<string, string> = {}
): Promise<DryRunStep[]> {
  const steps: DryRunStep[] = [];

  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    return [{
      stepId: 'workflow_init',
      output: {},
      status: 'error',
      durationMs: 0,
      errorDetails: {
        message: 'Invalid workflow: steps must be a non-empty array',
        actionableFix: 'Check workflows.json and ensure this workflow has a valid "steps" array.'
      }
    }];
  }

  for (let i = 0; i < workflow.steps.length; i++) {
    const currentStep = workflow.steps[i];
    const stepStartTime = Date.now();

    try {
      // ─── Check Preconditions ─────────────────────────────────────
      const preconditionViolations: string[] = [];

      // Validate step ID
      if (!currentStep.id) {
        preconditionViolations.push('Step missing required "id" field');
      }

      // For booking workflows, validate required context fields
      if (workflow.id?.includes('book')) {
        const requiredFields = ['guestName', 'guestCount', 'bookingDates'];
        for (const field of requiredFields) {
          if (!testRequest[field] && !collectedData[field]) {
            preconditionViolations.push(`Missing required booking field: ${field}`);
          }
        }
      }

      if (preconditionViolations.length > 0) {
        const durationMs = Date.now() - stepStartTime;
        steps.push({
          stepId: currentStep.id || `step_${i}`,
          stepName: currentStep.name || currentStep.label,
          output: {},
          status: 'error',
          durationMs,
          errorDetails: {
            preconditionViolations,
            message: `Step precondition validation failed`,
            actionableFix: `Ensure the following fields are provided in the test request: ${preconditionViolations.join(', ')}`
          }
        });
        continue;
      }

      // ─── Simulate Step Execution ──────────────────────────────────
      // In a dry-run, we don't actually execute actions, but we validate them
      let stepOutput: Record<string, unknown> = {};

      // Simulate data collection for this step
      if (!currentStep.evaluation && currentStep.id) {
        stepOutput = {
          stepId: currentStep.id,
          message: `[DRY-RUN] Would execute: ${currentStep.name || currentStep.label}`,
          collectedValue: testRequest[currentStep.id] || collectedData[currentStep.id]
        };
      }

      // If step has an action, simulate it
      if (currentStep.action) {
        stepOutput.action = {
          type: currentStep.action.type,
          status: 'would_execute',
          note: '[DRY-RUN] Action not actually executed'
        };
      }

      const durationMs = Date.now() - stepStartTime;
      steps.push({
        stepId: currentStep.id || `step_${i}`,
        stepName: currentStep.name || currentStep.label,
        output: stepOutput,
        status: 'success',
        durationMs
      });
    } catch (error: any) {
      const durationMs = Date.now() - stepStartTime;
      steps.push({
        stepId: currentStep.id || `step_${i}`,
        stepName: currentStep.name || currentStep.label,
        output: {},
        status: 'error',
        durationMs,
        errorDetails: {
          message: error instanceof Error ? error.message : String(error),
          actionableFix: 'Check the step definition in workflows.json for syntax errors or missing required fields'
        }
      });
    }
  }

  return steps;
}

// ─── Helper: Execute Node-Based Workflow (New Format) ──────────────────

async function executeNodeBasedWorkflow(
  workflow: HybridWorkflowDefinition,
  testRequest: Record<string, unknown>
): Promise<DryRunStep[]> {
  const steps: DryRunStep[] = [];

  if (!workflow.nodes || workflow.nodes.length === 0) {
    return [{
      stepId: 'workflow_init',
      output: {},
      status: 'error',
      durationMs: 0,
      errorDetails: {
        message: 'Invalid workflow: nodes must be a non-empty array',
        actionableFix: 'Check workflows.json and ensure this workflow has valid "nodes" array.'
      }
    }];
  }

  if (!workflow.startNodeId) {
    return [{
      stepId: 'workflow_init',
      output: {},
      status: 'error',
      durationMs: 0,
      errorDetails: {
        message: 'Invalid workflow: missing "startNodeId"',
        actionableFix: 'Check workflows.json and ensure this workflow has a valid "startNodeId" field.'
      }
    }];
  }

  // Simulate node execution graph traversal
  const visitedNodes = new Set<string>();
  let currentNodeId: string | null = workflow.startNodeId;
  const nodeOutputs: Record<string, unknown> = {};

  // Prevent infinite loops
  const maxSteps = Math.min(workflow.nodes.length * 2, 100);
  let stepCount = 0;

  while (currentNodeId && stepCount < maxSteps) {
    // Detect cycles
    if (visitedNodes.has(currentNodeId)) {
      steps.push({
        stepId: currentNodeId,
        output: {},
        status: 'error',
        durationMs: 0,
        errorDetails: {
          message: `Cycle detected: node "${currentNodeId}" was already visited`,
          actionableFix: 'Check the workflow node connections (next/trueNext/falseNext) for circular references'
        }
      });
      break;
    }

    visitedNodes.add(currentNodeId);

    const node = workflow.nodes.find((n: any) => n.id === currentNodeId);
    if (!node) {
      steps.push({
        stepId: currentNodeId,
        output: {},
        status: 'error',
        durationMs: 0,
        errorDetails: {
          message: `Node not found: "${currentNodeId}"`,
          actionableFix: 'Check the workflow definition and ensure all node IDs are defined in the nodes array'
        }
      });
      break;
    }

    const stepStartTime = Date.now();

    try {
      // Simulate node execution
      let nextNodeId: string | null = null;

      if (node.type === 'wait_reply') {
        // Simulate collecting user input
        nodeOutputs[node.id] = {
          value: testRequest[node.config?.storeAs] || '[DRY-RUN: would wait for user input]',
          storeAs: node.config?.storeAs
        };
        nextNodeId = node.next || null;
      } else if (node.type === 'condition') {
        // Simulate condition evaluation
        // In dry-run, assume condition is true
        nodeOutputs[node.id] = {
          evaluated: true,
          trueResult: true
        };
        nextNodeId = node.config?.trueNext || node.next || null;
      } else if (node.type === 'message') {
        // Simulate message node
        nodeOutputs[node.id] = {
          message: node.config?.message || '[DRY-RUN: would send message]'
        };
        nextNodeId = node.next || null;
      } else if (node.type === 'api') {
        // Simulate API call node
        nodeOutputs[node.id] = {
          apiType: node.config?.apiType,
          status: 'would_call',
          note: '[DRY-RUN] API call not actually executed'
        };
        nextNodeId = node.next || null;
      } else if (node.type === 'action') {
        // Simulate action node
        nodeOutputs[node.id] = {
          actionType: node.config?.actionType,
          status: 'would_execute',
          note: '[DRY-RUN] Action not actually executed'
        };
        nextNodeId = node.next || null;
      } else {
        // Unknown node type
        nodeOutputs[node.id] = {
          note: `[DRY-RUN] Unknown node type: ${node.type}`
        };
        nextNodeId = node.next || null;
      }

      const durationMs = Date.now() - stepStartTime;
      steps.push({
        stepId: node.id,
        stepName: node.label || `[${node.type}]`,
        output: nodeOutputs[node.id],
        status: 'success',
        durationMs
      });

      currentNodeId = nextNodeId;
      stepCount++;
    } catch (error: any) {
      const durationMs = Date.now() - stepStartTime;
      steps.push({
        stepId: node.id,
        stepName: node.label || `[${node.type}]`,
        output: {},
        status: 'error',
        durationMs,
        errorDetails: {
          message: error instanceof Error ? error.message : String(error),
          actionableFix: 'Check the node definition and ensure all required config fields are present'
        }
      });
      break;
    }
  }

  if (stepCount >= maxSteps) {
    steps.push({
      stepId: 'max_steps_exceeded',
      output: {},
      status: 'error',
      durationMs: 0,
      errorDetails: {
        message: `Workflow execution exceeded maximum step limit (${maxSteps})`,
        actionableFix: 'Check for infinite loops or excessive node connections in the workflow'
      }
    });
  }

  return steps;
}

// ─── POST /debug/profile/:profile/workflow-dry-run ──────────────────────

router.post('/debug/profile/:profile/workflow-dry-run', async (req: Request, res: Response) => {
  try {
    const { profile } = req.params;
    const { workflowId, testRequest } = req.body;

    // Validate inputs
    if (!workflowId) {
      badRequest(res, 'Missing required field: workflowId');
      return;
    }

    if (!testRequest || typeof testRequest !== 'object') {
      badRequest(res, 'Missing or invalid required field: testRequest (must be an object)');
      return;
    }

    // Load workflows for the profile
    let profileConfig = configStore;
    if (profile && profile !== 'pelangi') {
      const profileObj = profileRegistry.getProfile(profile);
      if (!profileObj) {
        notFound(res, `Profile "${profile}" not found`);
        return;
      }
      profileConfig = profileObj.configStore;
    }

    const workflows = profileConfig.getWorkflows();
    const workflow = workflows.workflows.find(w => w.id === workflowId);

    if (!workflow) {
      notFound(res, `Workflow "${workflowId}" not found for profile "${profile}"`);
      return;
    }

    const overallStartTime = Date.now();

    // Execute workflow (select format based on structure)
    let steps: DryRunStep[] = [];

    const hybridWorkflow = workflow as unknown as HybridWorkflowDefinition;
    if (isNodeBasedWorkflow(hybridWorkflow)) {
      // Node-based workflow
      steps = await executeNodeBasedWorkflow(hybridWorkflow, testRequest);
    } else {
      // Step-based workflow
      steps = await executeStepBasedWorkflow(
        workflow as WorkflowDefinition,
        testRequest,
        {} // No collected data in dry-run
      );
    }

    const totalDurationMs = Date.now() - overallStartTime;

    // Aggregate results
    const successCount = steps.filter(s => s.status === 'success').length;
    const errorCount = steps.filter(s => s.status === 'error').length;
    const skippedCount = steps.filter(s => s.status === 'skipped').length;

    const response: DryRunResponse = {
      workflowId,
      steps,
      totalDurationMs,
      successCount,
      errorCount,
      skippedCount,
      summary: `${successCount}/${steps.length} steps executed successfully`
    };

    ok(res, response);
  } catch (error: any) {
    console.error('[WorkflowDryRun] Error:', error.message);
    serverError(res, error);
  }
});

export default router;
