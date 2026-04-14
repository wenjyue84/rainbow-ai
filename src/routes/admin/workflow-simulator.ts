/**
 * US-605: Booking Workflow Dry-Run Simulator
 *
 * POST /admin/simulate/booking-workflow — Test workflow execution without DB writes
 * Accepts workflow steps and conversation context; returns simulated outputs
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, badRequest, serverError } from './http-utils.js';
import { executeWorkflowStep, createWorkflowState, type WorkflowState, type WorkflowContext } from '../../assistant/workflow-executor.js';

const router = Router();

interface SimulatorRequest {
  workflowId: string;
  conversationContext?: {
    language?: string;
    phone?: string;
    pushName?: string;
    instanceId?: string;
    profileId?: string;
  };
  initialData?: Record<string, string>;
  steps?: Array<{
    stepId: string;
    userInput?: string;
  }>;
}

interface SimulatorStepOutput {
  stepId: string;
  status: 'success' | 'error';
  response?: string;
  durationMs: number;
  error?: string;
}

interface SimulatorResponse {
  workflowId: string;
  status: 'success' | 'error';
  steps: SimulatorStepOutput[];
  totalDurationMs: number;
  successCount: number;
  errorCount: number;
  message?: string;
}

/**
 * POST /admin/simulate/booking-workflow
 * Simulates booking workflow execution without database writes
 *
 * Request body:
 * {
 *   "workflowId": "booking_check_in",
 *   "conversationContext": {
 *     "language": "en",
 *     "phone": "601234567",
 *     "profileId": "pelangi"
 *   },
 *   "initialData": {
 *     "guestName": "John Doe",
 *     "guestCount": "2"
 *   },
 *   "steps": [
 *     { "stepId": "step_1", "userInput": "John Doe" },
 *     { "stepId": "step_2", "userInput": "2" }
 *   ]
 * }
 */
router.post('/simulate/booking-workflow', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const { workflowId, conversationContext, initialData, steps } = req.body as SimulatorRequest;

    // Validate required fields
    if (!workflowId || typeof workflowId !== 'string') {
      badRequest(res, 'Missing or invalid required field: workflowId (string)');
      return;
    }

    // Build workflow context
    const context: WorkflowContext = {
      language: conversationContext?.language || 'en',
      phone: conversationContext?.phone,
      pushName: conversationContext?.pushName,
      instanceId: conversationContext?.instanceId,
      profileId: conversationContext?.profileId || 'pelangi',
    };

    // Create initial workflow state
    let state = createWorkflowState(workflowId);

    // Apply initial data to collected data
    if (initialData && typeof initialData === 'object') {
      state.collectedData = { ...initialData };
    }

    // Track step outputs
    const stepOutputs: SimulatorStepOutput[] = [];
    let successCount = 0;
    let errorCount = 0;

    // Execute steps if provided, or just the initial step
    const stepsToExecute = steps && Array.isArray(steps) && steps.length > 0
      ? steps
      : [{ stepId: '', userInput: null }]; // Initial step with no input

    for (const step of stepsToExecute) {
      const stepStartTime = Date.now();

      try {
        // Execute workflow step in dry-run mode
        const result = await executeWorkflowStep(state, step.userInput || null, context, true);

        const durationMs = Date.now() - stepStartTime;

        stepOutputs.push({
          stepId: step.stepId || state.currentStepIndex.toString(),
          status: 'success',
          response: result.response,
          durationMs,
        });

        successCount++;

        // Update state for next iteration
        if (result.newState) {
          state = result.newState;
        } else {
          // Workflow complete
          break;
        }
      } catch (stepError) {
        const durationMs = Date.now() - stepStartTime;
        const errorMessage = stepError instanceof Error ? stepError.message : String(stepError);

        stepOutputs.push({
          stepId: step.stepId || state.currentStepIndex.toString(),
          status: 'error',
          durationMs,
          error: errorMessage,
        });

        errorCount++;
      }
    }

    const totalDurationMs = Date.now() - startTime;

    const response: SimulatorResponse = {
      workflowId,
      status: errorCount === 0 ? 'success' : 'error',
      steps: stepOutputs,
      totalDurationMs,
      successCount,
      errorCount,
      message: `Executed ${stepOutputs.length} steps (${successCount} succeeded, ${errorCount} failed)`,
    };

    ok(res, response);
  } catch (error: any) {
    console.error('[WorkflowSimulator] Error:', error.message);
    serverError(res, error);
  }
});

export default router;
