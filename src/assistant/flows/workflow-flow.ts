/**
 * US-408: WorkflowFlow — Adapter wrapping existing workflow logic as a Flow.
 *
 * Delegates to executeWorkflowStep/createWorkflowState from ../workflow-executor.ts.
 * Handles forwarding summaries on workflow completion.
 */
import type { Flow, FlowContext, FlowStepResult } from '../pipeline/types.js';
import type { WorkflowState, WorkflowContext } from '../workflow-executor.js';
import {
  executeWorkflowStep, createWorkflowState, forwardWorkflowSummary,
} from '../workflow-executor.js';

export const workflowFlow: Flow = {
  type: 'workflow',

  async start(context: FlowContext, initialInput?: string | null): Promise<FlowStepResult> {
    // WorkflowFlow.start() is not used via the unified path — workflows are
    // started from action-dispatch with a specific workflowId. This method
    // exists to satisfy the Flow interface for completeness.
    throw new Error('WorkflowFlow.start() requires a workflowId — use action-dispatch instead');
  },

  async executeStep(state: WorkflowState, userMessage: string, context: FlowContext): Promise<FlowStepResult> {
    const wfCtx: WorkflowContext = {
      language: context.language,
      phone: context.phone,
      pushName: context.pushName,
      instanceId: context.instanceId,
    };

    const result = await executeWorkflowStep(state, userMessage, wfCtx);

    // Handle forwarding on workflow completion
    if (!result.newState && result.shouldForward && result.conversationSummary) {
      const workflows = context.profileConfig.getWorkflows();
      const workflow = workflows.workflows.find((w: any) => w.id === state.workflowId);
      if (workflow) {
        await forwardWorkflowSummary(
          context.phone, context.pushName, workflow, state, context.instanceId
        );
      }
    }

    return {
      response: result.response,
      newState: result.newState,
      shouldForward: result.shouldForward,
      conversationSummary: result.conversationSummary,
      metadata: {
        workflowId: result.workflowId,
        stepId: result.stepId,
      },
    };
  },

  isComplete(_state: WorkflowState): boolean {
    // WorkflowState is set to null when complete, so if we have state it's active.
    // This method is called with the stored state which only exists while active.
    return false;
  },
};
