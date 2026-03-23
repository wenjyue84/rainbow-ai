import type { SendMessageFn } from './types.js';
import { configStore } from './config-store.js';
import type { WorkflowDefinition, WorkflowStep } from './config-store.js';
import { enhanceWorkflowStep, WorkflowEnhancerContext } from './workflow-enhancer.js';
import { notifyAdminConfigError } from '../lib/admin-notifier.js';
import { executeWorkflowInTransaction, logTransactionMetrics, type TransactionMetrics } from './pipeline/workflow-transaction-handler.js';
import { executeWithTimeout, WorkflowTimeoutError, logTimeoutFailure } from './workflow-timeout-handler.js';
import { logMessage } from './conversation-logger.js';
import { recordStepMetric } from './workflow-profiler.js';
import { pool } from '../lib/db.js';
import { validateBookingPreconditions, extractBookingContext } from './booking-validator.js';
import type { HybridWorkflowDefinition } from './workflow-nodes.js';
import { isNodeBasedWorkflow, convertRawPhonesToLinks } from './workflow-nodes.js';
import {
  callAPIWrapper, syncWorkflowDataToContact, getTimeoutEscalationMessage,
  executeNodeWorkflowStep,
} from './workflow-executor-node.js';

// ─── US-313: Booking Workflow Execution Audit Trail ──────────────────

export type WorkflowExecutionStatus = 'success' | 'error' | 'timeout' | 'skipped';

/**
 * US-313: Log a booking workflow step execution to the booking_execution_audit table.
 * Inserts an audit record with the step name, input/output data, status, and timestamp.
 * Returns the step result (output) unchanged so it can be used as a transparent wrapper.
 */
export async function logWorkflowExecution(
  step: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  status: WorkflowExecutionStatus,
  bookingId?: string,
): Promise<Record<string, unknown>> {
  const resolvedBookingId = bookingId || input.bookingId as string || `booking-${Date.now()}`;

  try {
    await pool.query(
      `INSERT INTO booking_execution_audit (booking_id, step_name, input, output, status, executed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        resolvedBookingId,
        step,
        JSON.stringify(input),
        JSON.stringify(output),
        status,
      ]
    );
    console.log(`[WorkflowExecutor] US-313: Audit logged for step "${step}" (booking: ${resolvedBookingId}, status: ${status})`);
  } catch (err) {
    // Non-blocking: audit logging should never break workflow execution
    console.error(`[WorkflowExecutor] US-313: Failed to log audit for step "${step}":`, err);
  }

  return output;
}


export interface WorkflowState {
  workflowId: string;
  currentStepIndex: number;
  collectedData: Record<string, string>; // step id -> user response
  startedAt: number;
  lastUpdateAt: number;
  // Node-based workflow fields (optional — only set for node workflows)
  currentNodeId?: string;            // Current position in node graph
  nodeOutputs?: Record<string, any>; // Accumulated outputs from API/action nodes
  isNodeBased?: boolean;             // Quick flag to skip format detection
}

export interface WorkflowExecutionResult {
  response: string;
  newState: WorkflowState | null; // null when workflow complete
  shouldForward?: boolean; // true on final step
  conversationSummary?: string;
  workflowId?: string;  // For conversation log edit support
  stepId?: string;      // For conversation log edit support
}

/**
 * US-135: WorkflowContext bundles the scattered parameters of executeWorkflowStep()
 * into a single context object. This reduces parameter count and makes the API
 * easier to extend without breaking callers.
 */
export interface WorkflowContext {
  language: string;
  phone?: string;
  pushName?: string;
  instanceId?: string;
  profileId?: string;  // US-054: Current profile for workflow ownership validation
}

let sendMessageFn: SendMessageFn | null = null;

export function initWorkflowExecutor(sendFn: SendMessageFn): void {
  sendMessageFn = sendFn;
}


export function createWorkflowState(workflowId: string): WorkflowState {
  // Check if this workflow uses node-based format
  const workflows = configStore.getWorkflows();
  const workflow = workflows.workflows.find(w => w.id === workflowId) as HybridWorkflowDefinition | undefined;
  const isNodes = workflow ? isNodeBasedWorkflow(workflow) : false;

  return {
    workflowId,
    currentStepIndex: 0,
    collectedData: {},
    startedAt: Date.now(),
    lastUpdateAt: Date.now(),
    // Set node-based fields if applicable
    ...(isNodes && workflow?.startNodeId ? {
      currentNodeId: workflow.startNodeId,
      nodeOutputs: {},
      isNodeBased: true,
    } : {}),
  };
}

export async function executeWorkflowStep(
  state: WorkflowState,
  userMessage: string | null,
  context: WorkflowContext
): Promise<WorkflowExecutionResult> {
  const { language, phone, pushName, instanceId } = context;
  const workflows = configStore.getWorkflows();
  const workflow = workflows.workflows.find(w => w.id === state.workflowId);

  if (!workflow) {
    return {
      response: 'Workflow not found. Please contact support.',
      newState: null
    };
  }

  // ─── US-054: Profile Ownership Validation ────────────────────────────
  // Prevent workflows from executing with wrong business profile
  const workflowProfile = (workflow as any).profileId;
  const currentProfile = context.profileId;

  if (workflowProfile && currentProfile && workflowProfile !== currentProfile) {
    const errorMessage = `ProfileMismatchError: workflow "${state.workflowId}" (profile: ${workflowProfile}) cannot execute for conversation profile: ${currentProfile}`;
    console.error(`[WorkflowExecutor] ${errorMessage}`);
    return {
      response: 'Workflow configuration error. Please contact support.',
      newState: null
    };
  }

  // ─── US-020: Cancel Workflow Detection ─────────────────────────────
  if (userMessage) {
    const cancelKeywords = [
      'cancel', 'nevermind', 'never mind', 'stop', 'forget it', 'no thanks',
      'not interested', 'skip', 'exit', 'quit', 'nah', 'nvm',
      'batal', 'tak nak', 'tak mahu', 'tak jadi', 'lupakan', 'tak payah', 'sudahlah',
      '取消', '算了', '不要了', '不用了', '不需要'
    ];
    const normalizedMsg = userMessage.toLowerCase().trim();
    if (cancelKeywords.some(kw => normalizedMsg === kw || normalizedMsg.startsWith(kw + ' '))) {
      const cancelMessages: Record<string, string> = {
        en: 'No problem! Is there anything else I can help you with?',
        ms: 'Takpe! Ada apa-apa lagi saya boleh bantu?',
        zh: '没问题！还有其他我可以帮您的吗？'
      };
      console.log(`[WorkflowExecutor] US-020: Cancel detected in workflow "${state.workflowId}" — exiting gracefully`);
      return {
        response: cancelMessages[language as keyof typeof cancelMessages] || cancelMessages.en,
        newState: null
      };
    }
  }

  // ─── Node-Based Workflow Dispatch ──────────────────────────────────
  const hybridWorkflow = workflow as unknown as HybridWorkflowDefinition;
  if (state.isNodeBased || isNodeBasedWorkflow(hybridWorkflow)) {
    return executeNodeWorkflowStep(
      hybridWorkflow, state, userMessage, context, sendMessageFn
    );
  }

  // ─── Legacy Step-Based Execution (below) ──────────────────────────
  // Validate workflow structure: steps must be a non-empty array
  if (!Array.isArray(workflow.steps)) {
    console.error(`[WorkflowExecutor] Workflow "${state.workflowId}" has invalid steps property (not an array)`);
    notifyAdminConfigError(
      `Workflow "${state.workflowId}" has invalid structure: steps is not an array.\n\n` +
      `Please check workflows.json and ensure this workflow has a valid "steps" array.`
    );
    return {
      response: 'This service is temporarily unavailable. Our team has been notified. Please contact staff directly.',
      newState: null
    };
  }

  if (workflow.steps.length === 0) {
    console.error(`[WorkflowExecutor] Workflow "${state.workflowId}" has empty steps array`);
    notifyAdminConfigError(
      `Workflow "${state.workflowId}" has no steps defined (empty array).\n\n` +
      `Please add steps to this workflow in workflows.json.`
    );
    return {
      response: 'This service is temporarily unavailable. Our team has been notified. Please contact staff directly.',
      newState: null
    };
  }

  // Auto-correct out-of-bounds step index
  if (state.currentStepIndex < 0) {
    console.warn(`[WorkflowExecutor] Workflow "${state.workflowId}" had negative step index (${state.currentStepIndex}), resetting to 0`);
    state.currentStepIndex = 0;
  } else if (state.currentStepIndex > workflow.steps.length) {
    console.warn(`[WorkflowExecutor] Workflow "${state.workflowId}" had step index ${state.currentStepIndex} beyond bounds (max ${workflow.steps.length}), clamping`);
    state.currentStepIndex = workflow.steps.length;
  }

  // If user provided a message, store it for the previous step
  // BUT only if the previous step wasn't an evaluation step (eval steps don't collect data)
  if (userMessage && state.currentStepIndex > 0) {
    const previousStep = workflow.steps[state.currentStepIndex - 1];
    if (previousStep && !previousStep.evaluation) {
      state.collectedData[previousStep.id] = userMessage;
      // US-089: Sync collected data to contact details
      syncWorkflowDataToContact(phone, state.workflowId, state.collectedData);
    }
  }

  // Check if we've completed all steps
  if (state.currentStepIndex >= workflow.steps.length) {
    // Workflow complete - prepare summary and forward
    const summary = buildConversationSummary(workflow, state);
    const adminPhone = configStore.getWorkflow().payment.forward_to || '+60127088789';

    const lastStep = workflow.steps[workflow.steps.length - 1];
    return {
      response: getStepMessage(lastStep, language),
      newState: null,
      shouldForward: true,
      conversationSummary: summary,
      workflowId: state.workflowId,
      stepId: lastStep.id
    };
  }

  const currentStep = workflow.steps[state.currentStepIndex];

  // ─── NEW: Evaluation Logic (Smart Workflows) ──────────────────────
  if (currentStep.evaluation) {
    // This is a silent step. We evaluate and jump, then RECURSE.
    console.log(`[WorkflowExecutor] Running evaluation step ${currentStep.id}...`);

    // We need history for context. Since we don't have seamless access to full DB history here,
    // we'll rely on what we have: userMessage (latest) + collectedData (previous workflow steps).
    // In a real implementation, we'd fetch full history.
    // For now, let's construct a "workflow context" string.

    const contextLines = [];
    for (const [key, val] of Object.entries(state.collectedData)) {
      contextLines.push(`Step ${key}: ${val}`);
    }
    const contextStr = contextLines.join('\n');

    // "History" for the evaluator will include the collected data as a system note
    // and the latest user message.
    const mockHistory: any[] = [
      { role: 'system', content: `Workflow Content So Far:\n${contextStr}` }
    ];

    try {
      const { evaluateWorkflowStep } = await import('./ai-client.js');
      const result = await evaluateWorkflowStep(
        currentStep.evaluation.prompt,
        mockHistory,
        userMessage || '(No new message)'
      );

      console.log(`[WorkflowExecutor] Evaluation "${currentStep.evaluation.prompt}" -> ${result}`);

      const nextStepId = currentStep.evaluation.outcomes[result] || currentStep.evaluation.defaultNextId;
      const nextStepIndex = workflow.steps.findIndex(s => s.id === nextStepId);

      if (nextStepIndex !== -1) {
        // Update state to jump
        const nextState = {
          ...state,
          currentStepIndex: nextStepIndex,
          lastUpdateAt: Date.now()
        };

        // RECURSE! Execute the target step immediately
        // Pass userMessage=null because we haven't "consumed" it yet if we're skipping
        // Wait... actually userMessage IS the current input. If we skip, we want the *next* step
        // to see it potentially? Or strictly distinct?
        // Let's assume evaluation steps are invisible. The user's input triggered the evaluation.
        // The NEXT step will be the "response" to that input.
        return executeWorkflowStep(nextState, null, context);
      } else {
        console.error(`[WorkflowExecutor] Evaluation target step ${nextStepId} not found!`);
      }
    } catch (err) {
      console.error('[WorkflowExecutor] Evaluation failed:', err);
    }

    // Fallback: just advance 1 step if evaluation fails
    // (This shouldn't happen if config is correct)
  }

  let response = getStepMessage(currentStep, language);

  // ─── US-228: Booking Precondition Validation ──────────────────────
  // Validate preconditions before executing booking workflow steps
  if (currentStep.id && (state.workflowId.includes('book') || state.workflowId.includes('booking'))) {
    try {
      const bookingContext = extractBookingContext(state, context.profileId);
      const validationResult = await validateBookingPreconditions(state, bookingContext);

      if (!validationResult.valid) {
        // Return validation errors as guest-friendly message
        const errorMessage = validationResult.errors.join('\n\n');
        console.warn(
          `[WorkflowExecutor] US-228: Booking precondition validation failed for step "${currentStep.id}": ${errorMessage}`
        );

        return {
          response: errorMessage,
          newState: null, // Complete workflow with error
          shouldForward: true, // Escalate for staff review
          workflowId: state.workflowId,
          stepId: currentStep.id
        };
      }
    } catch (err) {
      // Log validation errors but allow workflow to proceed (fail-open)
      console.error(
        `[WorkflowExecutor] US-228: Unexpected error during booking precondition validation:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Enhance step if action present and phone available
  if (currentStep.action && phone && sendMessageFn) {
    const enhancerContext: WorkflowEnhancerContext = {
      workflowId: state.workflowId,
      stepId: currentStep.id,
      userInput: userMessage,
      collectedData: state.collectedData,
      language,
      phone,
      pushName: pushName || 'Guest',
      instanceId
    };

    // US-120: Apply timeout to step execution
    const maxDurationMs = (currentStep as any).max_duration_ms || 30000;

    // US-121: Start profiling this step
    const stepStartTime = Date.now();
    const inputSize = JSON.stringify(enhancerContext).length;

    try {
      const enhanced = await executeWithTimeout(
        () => enhanceWorkflowStep(
          currentStep,
          enhancerContext,
          callAPIWrapper,
          sendMessageFn!
        ),
        currentStep.id,
        maxDurationMs
      );

      response = enhanced.message; // Use enhanced message

      // US-121: Record step execution metrics
      const stepDuration = Date.now() - stepStartTime;
      const outputSize = response.length;
      recordStepMetric({
        stepId: currentStep.id,
        stepType: currentStep.action?.type || 'unknown',
        durationMs: stepDuration,
        inputSize,
        outputSize,
        stateSnapshot: {
          collectedDataKeys: Object.keys(state.collectedData),
          workflowId: state.workflowId,
        },
        timestamp: Date.now(),
        workflowId: state.workflowId,
        conversationId: phone,
      });

      // Log metadata for debugging
      if (enhanced.metadata) {
        console.log(`[WorkflowExecutor] Step ${currentStep.id} metadata:`, enhanced.metadata);
      }
    } catch (error) {
      // US-120: Handle timeout with escalation
      if (error instanceof WorkflowTimeoutError) {
        console.error(`[WorkflowExecutor] US-120: Step timeout:`, error.message);

        // Log escalation event to rainbow_messages
        try {
          const failureLog = logTimeoutFailure(
            currentStep.id,
            error.maxDurationMs,
            error.actualDurationMs,
            state.workflowId,
            context.profileId
          );

          await logMessage(
            phone,
            pushName || 'Guest',
            'assistant',
            getTimeoutEscalationMessage(language),
            {
              messageType: 'escalation',
              workflowId: state.workflowId,
              stepId: currentStep.id,
              action: 'timeout_escalation',
              profileId: context.profileId,
              // Store timeout details in the message metadata
              source: 'workflow_timeout',
              ...(failureLog as any)
            }
          );
        } catch (logErr) {
          console.error(`[WorkflowExecutor] US-120: Failed to log timeout event:`, logErr);
        }

        // Return escalation response and complete workflow
        return {
          response: getTimeoutEscalationMessage(language),
          newState: null, // Complete the workflow
          shouldForward: true, // Escalate to staff
          workflowId: state.workflowId,
          stepId: currentStep.id
        };
      }

      // Handle other errors with graceful degradation
      console.error(`[WorkflowExecutor] Failed to enhance step ${currentStep.id}:`, error);
      // Continue with original message on error (graceful degradation)
    }
  }

  // Update state
  const newState: WorkflowState = {
    ...state,
    lastUpdateAt: Date.now()
  };

  // If this step waits for reply, keep state as-is (will advance on next message)
  // If this step doesn't wait, advance to next step immediately
  if (!currentStep.waitForReply) {
    newState.currentStepIndex = state.currentStepIndex + 1;

    // If there's a next step that also doesn't wait, we need to chain them
    // For now, we'll let the caller handle this by checking the state
  } else {
    // Advance to next step (user will reply to this one)
    newState.currentStepIndex = state.currentStepIndex + 1;
  }

  return {
    response,
    newState,
    shouldForward: false,
    workflowId: state.workflowId,
    stepId: currentStep.id
  };
}


export async function forwardWorkflowSummary(
  phone: string,
  pushName: string,
  workflow: WorkflowDefinition,
  state: WorkflowState,
  instanceId?: string
): Promise<void> {
  if (!sendMessageFn) {
    console.error('[WorkflowExecutor] SendMessage function not initialized');
    return;
  }

  const adminPhone = configStore.getWorkflow().payment.forward_to || '+60127088789';
  const summary = buildConversationSummary(workflow, state, phone, pushName);

  try {
    await sendMessageFn(adminPhone, summary, instanceId);
    console.log(`[WorkflowExecutor] Summary forwarded to ${adminPhone} for ${phone}`);
  } catch (err: any) {
    console.error(`[WorkflowExecutor] Failed to forward summary:`, err.message);
  }
}

function getStepMessage(step: WorkflowStep, language: string): string {
  // Support multi-language responses
  const messages = step.message;
  let text: string;
  if (language === 'ms' && messages.ms) text = messages.ms;
  else if (language === 'zh' && messages.zh) text = messages.zh;
  else text = messages.en;
  // Convert raw phone numbers to clickable wa.me links
  return convertRawPhonesToLinks(text);
}

function buildConversationSummary(
  workflow: WorkflowDefinition,
  state: WorkflowState,
  phone?: string,
  pushName?: string
): string {
  const lines: string[] = [];

  lines.push(`📋 *Workflow Summary: ${workflow.name}*`);
  lines.push('');

  if (phone) {
    lines.push(`👤 *Guest:* ${pushName || 'Unknown'}`);
    lines.push(`📱 *Phone:* ${phone}`);
    lines.push('');
  }

  lines.push(`🕐 *Started:* ${new Date(state.startedAt).toLocaleString()}`);
  lines.push(`⏱️ *Duration:* ${Math.round((state.lastUpdateAt - state.startedAt) / 1000)}s`);
  lines.push('');
  lines.push('*Collected Information:*');

  // Match steps with collected data
  workflow.steps.forEach((step, idx) => {
    const response = state.collectedData[step.id];
    if (response) {
      lines.push(`${idx + 1}. ${step.message.en}`);
      lines.push(`   ↳ _${response}_`);
    }
  });

  if (Object.keys(state.collectedData).length === 0) {
    lines.push('_(No responses collected)_');
  }

  lines.push('');
  lines.push('---');
  lines.push('🤖 _Generated by Rainbow AI Assistant_');

  return lines.join('\n');
}

export function hasAutoAdvanceSteps(workflow: WorkflowDefinition, fromIndex: number): boolean {
  // Check if there are consecutive steps that don't wait for reply
  for (let i = fromIndex; i < workflow.steps.length; i++) {
    if (workflow.steps[i].waitForReply) {
      return false;
    }
  }
  return true;
}


// ============================================================================
// US-082: Transaction-Wrapped Workflow Execution
// ============================================================================

/**
 * Executes a workflow step within a database transaction.
 *
 * Wraps the entire step execution in a transaction, ensuring:
 * - All database writes are atomic (all-or-nothing)
 * - On failure, all changes are rolled back
 * - Transaction isolation is READ_COMMITTED
 * - Duration is logged for deadlock detection
 *
 * This is the public-facing function that external callers should use.
 * Internal recursive calls (evaluation steps) use executeWorkflowStep directly
 * to avoid nested transactions.
 */
export async function executeWorkflowStepWithTransaction(
  state: WorkflowState,
  userMessage: string | null,
  context: WorkflowContext
): Promise<WorkflowExecutionResult> {
  const [result, metrics] = await executeWorkflowInTransaction(
    () => executeWorkflowStep(state, userMessage, context),
    state.workflowId
  );

  // Log metrics for monitoring
  logTransactionMetrics(metrics, state.workflowId);

  return result;
}
