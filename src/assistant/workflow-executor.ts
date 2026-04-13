import type { SendMessageFn } from './types.js';
import { configStore } from './config-store.js';
import type { WorkflowDefinition, WorkflowStep } from './config-store.js';
import { enhanceWorkflowStep, WorkflowEnhancerContext } from './workflow-enhancer.js';
import { notifyAdminConfigError } from '../lib/admin-notifier.js';
import { isValidTransition } from './workflows/booking-state-machine.js';
import { executeWorkflowInTransaction, logTransactionMetrics, type TransactionMetrics } from './pipeline/workflow-transaction-handler.js';
import { executeWithTimeout, WorkflowTimeoutError, logTimeoutFailure } from './workflow-timeout-handler.js';
import { logMessage } from './conversation-logger.js';
import { recordStepMetric } from './workflow-profiler.js';
import { pool } from '../lib/db.js';
import { validateBookingPreconditions, extractBookingContext } from './booking-validator.js';
import { checkBookingUnitAvailability } from './booking-unit-availability-check.js';
import { createProfileSanitizer, type BookingInput } from '../lib/booking-input-sanitizer.js';
import { validateBookingRules, type BookingRequest } from '../lib/booking-rules-validator.js';
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


// ─── US-379: Retry with Exponential Backoff ──────────────────────────

/**
 * US-379: Execute fn with retry loop and exponential backoff.
 * If retry is undefined, executes fn once (no retries).
 * max_attempts = total number of attempts (including the first).
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  retry: { max_attempts: number; base_delay_ms: number; backoff_multiplier: number } | undefined
): Promise<T> {
  if (!retry) return fn();

  let lastError: unknown;
  for (let attempt = 0; attempt < retry.max_attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retry.max_attempts - 1) {
        const delay = retry.base_delay_ms * Math.pow(retry.backoff_multiplier, attempt);
        if (delay > 0) {
          await new Promise<void>(resolve => setTimeout(resolve, delay));
        }
      }
    }
  }
  throw lastError;
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
  escalation_reason?: string; // US-470: reason code when booking unit check fails
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

  // ─── US-490: Booking Workflow Input Sanitizer ─────────────────────────
  // Validate and sanitize booking form inputs before passing to workflow engine
  if (currentStep.id && (state.workflowId.includes('book') || state.workflowId.includes('booking'))) {
    try {
      // Get the profile for this workflow
      const profileId = context.profileId || 'pelangi';
      const sanitizer = createProfileSanitizer(profileId);

      // Construct booking input from collected data
      const bookingInput: BookingInput = {
        profile: profileId,
        guestName: state.collectedData.guest_name,
        guestPhone: state.collectedData.guest_phone,
        guestEmail: state.collectedData.guest_email,
        checkInDate: state.collectedData.check_in_date,
        checkOutDate: state.collectedData.check_out_date,
        guestCount: state.collectedData.guest_count ? parseInt(state.collectedData.guest_count, 10) : undefined,
        unitType: state.collectedData.unit_type,
        specialRequests: state.collectedData.special_requests,
      };

      // Run sanitization
      const sanitizationResult = sanitizer(bookingInput);

      // Log violations with details
      if (sanitizationResult.violations.length > 0) {
        const violationDetails = sanitizationResult.violations.map(v =>
          `[${v.severity.toUpperCase()}] ${v.field}: ${v.issue}${v.suggestion ? ` (${v.suggestion})` : ''}`
        ).join('\n');

        console.warn(
          `[WorkflowExecutor] US-490: Booking input sanitization found ${sanitizationResult.violations.length} violation(s) for profile "${profileId}":\n${violationDetails}`
        );
      }

      // If validation fails (error-level violations), return early
      if (!sanitizationResult.valid) {
        const errorViolations = sanitizationResult.violations.filter(v => v.severity === 'error');
        const errorMessage = errorViolations.map(v => `${v.field}: ${v.issue}`).join('\n');

        return {
          response: `Booking validation errors:\n${errorMessage}\n\nPlease review your information and try again.`,
          newState: null,
          shouldForward: true,
          workflowId: state.workflowId,
          stepId: currentStep.id
        };
      }

      // Update collected data with sanitized values (for data that passed validation)
      if (sanitizationResult.sanitized) {
        if (sanitizationResult.sanitized.guestName) state.collectedData.guest_name = sanitizationResult.sanitized.guestName;
        if (sanitizationResult.sanitized.guestPhone) state.collectedData.guest_phone = sanitizationResult.sanitized.guestPhone;
        if (sanitizationResult.sanitized.guestEmail) state.collectedData.guest_email = sanitizationResult.sanitized.guestEmail;
        if (sanitizationResult.sanitized.checkInDate) state.collectedData.check_in_date = sanitizationResult.sanitized.checkInDate?.toString();
        if (sanitizationResult.sanitized.checkOutDate) state.collectedData.check_out_date = sanitizationResult.sanitized.checkOutDate?.toString();
        if (sanitizationResult.sanitized.guestCount) state.collectedData.guest_count = sanitizationResult.sanitized.guestCount.toString();
        if (sanitizationResult.sanitized.unitType) state.collectedData.unit_type = sanitizationResult.sanitized.unitType;
        if (sanitizationResult.sanitized.specialRequests) state.collectedData.special_requests = sanitizationResult.sanitized.specialRequests;
      }

      console.log(`[WorkflowExecutor] US-490: Booking input sanitization passed for profile "${profileId}"`);
    } catch (err) {
      // Log sanitization errors but allow workflow to proceed (fail-open)
      console.error(
        `[WorkflowExecutor] US-490: Unexpected error during booking input sanitization:`,
        err instanceof Error ? err.message : err
      );
    }
  }

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

  // ─── US-470: Booking Unit Availability Check ────────────────────────
  // Pre-flight validation that booking units exist and are available
  if (currentStep.id && (state.workflowId.includes('book') || state.workflowId.includes('booking'))) {
    try {
      const availabilityResult = await checkBookingUnitAvailability(state, context.profileId);

      if (!availabilityResult.available) {
        console.warn(
          `[WorkflowExecutor] US-470: Booking unit availability check failed for step "${currentStep.id}": ${availabilityResult.errors.join(', ')}`
        );

        return {
          response: availabilityResult.errors.join('\n\n'),
          newState: null,
          shouldForward: true,
          workflowId: state.workflowId,
          stepId: currentStep.id,
          escalation_reason: availabilityResult.escalation_reason || 'unit_unavailable'
        };
      }
    } catch (err) {
      // Fail-open: log error but allow workflow to proceed
      console.error(
        `[WorkflowExecutor] US-470: Unexpected error during booking unit availability check:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // ─── US-547: Profile-Specific Booking Rules Validation ──────────────
  // Validate booking request against profile constraints (capacity, dates, overlaps, pricing)
  if (currentStep.id && (state.workflowId.includes('book') || state.workflowId.includes('booking'))) {
    try {
      const profile = context.profileId || 'pelangi';

      // Build booking request from collected data
      const bookingRequest: BookingRequest = {
        guestCount: state.collectedData['guest_count'] ? parseInt(state.collectedData['guest_count'], 10) : undefined,
        guestPhone: phone,
        checkInDate: state.collectedData['check_in_date'] || state.collectedData['checkin_date'],
        checkOutDate: state.collectedData['check_out_date'] || state.collectedData['checkout_date'],
        unitType: state.collectedData['capsule'] || state.collectedData['unit'] || state.collectedData['room'],
        price: state.collectedData['price'] ? parseFloat(state.collectedData['price']) : undefined,
        profile
      };

      const rulesValidationResult = await validateBookingRules(bookingRequest, profile);

      if (!rulesValidationResult.isValid) {
        // Return validation errors as guest-friendly message
        const errorMessages = rulesValidationResult.errors.map(err => err.message);
        const errorMessage = errorMessages.join('\n\n');
        console.warn(
          `[WorkflowExecutor] US-547: Booking rules validation failed for step "${currentStep.id}": ${errorMessage}`
        );

        return {
          response: errorMessage,
          newState: null,
          shouldForward: true,
          workflowId: state.workflowId,
          stepId: currentStep.id,
          escalation_reason: 'booking_rules_validation_failed'
        };
      }

      console.log(`[WorkflowExecutor] US-547: Booking rules validation passed for step "${currentStep.id}"`);
    } catch (err) {
      // Fail-open: log error but allow workflow to proceed
      console.error(
        `[WorkflowExecutor] US-547: Unexpected error during booking rules validation:`,
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

    // US-324: timeoutMs takes precedence over max_duration_ms
    const maxDurationMs = (currentStep as any).timeoutMs || (currentStep as any).max_duration_ms || 30000;

    // US-121: Start profiling this step
    const stepStartTime = Date.now();
    const inputSize = JSON.stringify(enhancerContext).length;

    try {
      // US-379: Wrap step execution in retry loop if retry config is present
      const enhanced = await executeWithRetry(
        () => executeWithTimeout(
          () => enhanceWorkflowStep(
            currentStep,
            enhancerContext,
            callAPIWrapper,
            sendMessageFn!
          ),
          currentStep.id,
          maxDurationMs
        ),
        (currentStep as any).retry
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
      // US-120 / US-324: Handle timeout with graceful fallback
      if (error instanceof WorkflowTimeoutError) {
        console.error(`[WorkflowExecutor] US-324: Step timeout:`, error.message);

        // US-324: Use per-step fallbackResponse if configured, else generic escalation
        const fallbackResponse = (currentStep as any).fallbackResponse || getTimeoutEscalationMessage(language);
        const hasFallback = !!(currentStep as any).fallbackResponse;

        // US-324: Log to booking_workflow_events for per-step timeout metrics
        try {
          await pool.query(
            `INSERT INTO booking_workflow_events (step_name, workflow_id, profile_id, elapsed_ms, timed_out_at, fallback_used)
             VALUES ($1, $2, $3, $4, NOW(), $5)`,
            [currentStep.id, state.workflowId, context.profileId || null, error.actualDurationMs, hasFallback]
          );
        } catch (dbErr) {
          console.error(`[WorkflowExecutor] US-324: Failed to log to booking_workflow_events:`, dbErr);
        }

        // Also log escalation event to rainbow_messages (US-120 pattern)
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
            fallbackResponse,
            {
              messageType: 'escalation',
              workflowId: state.workflowId,
              stepId: currentStep.id,
              action: 'timeout_escalation',
              profileId: context.profileId,
              source: 'workflow_timeout',
              ...(failureLog as any)
            }
          );
        } catch (logErr) {
          console.error(`[WorkflowExecutor] US-324: Failed to log timeout message:`, logErr);
        }

        // Return fallback response and complete workflow
        return {
          response: fallbackResponse,
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

  // ─── US-545: Booking Workflow State Transition Validation ────────────
  // Validate that the next step is a valid transition from the current step
  // before advancing the workflow state machine
  const nextStepIndex = state.currentStepIndex + 1;
  if (nextStepIndex < workflow.steps.length) {
    const nextStep = workflow.steps[nextStepIndex];
    const currentStepId = currentStep.id || 'unknown';
    const nextStepId = nextStep.id || 'unknown';

    if (!isValidTransition(currentStepId, nextStepId)) {
      // Invalid transition detected - return clarifying error message
      const clarifyingMessages: Record<string, string> = {
        en: `I need to complete the current step first. Let me confirm your details before moving forward.`,
        ms: `Saya perlu menyelesaikan langkah semasa terlebih dahulu. Biarkan saya mengesahkan butiran anda sebelum melanjutkan.`,
        zh: `我需要先完成当前步骤。让我先确认您的详细信息后再继续。`,
        ta: `நான் முதலில் தற்போதைய நிலையை முடிக்க வேண்டும். உங்கள் விவரங்களை உறுதிப்படுத்த அனுமதிக்கவும்.`
      };

      console.warn(
        `[WorkflowExecutor] US-545: Invalid transition detected: "${currentStepId}" -> "${nextStepId}" ` +
        `in workflow "${state.workflowId}". Rejecting transition.`
      );

      // Return error response without advancing state
      return {
        response: clarifyingMessages[language as keyof typeof clarifyingMessages] || clarifyingMessages.en,
        newState: state, // Keep current state (don't advance)
        workflowId: state.workflowId,
        stepId: currentStep.id
      };
    }
  }

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
