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
import { validateBookingStep } from './workflow-validator.js';
import type { HybridWorkflowDefinition } from './workflow-nodes.js';
import { isNodeBasedWorkflow, convertRawPhonesToLinks } from './workflow-nodes.js';
import {
  callAPIWrapper, syncWorkflowDataToContact, getTimeoutEscalationMessage,
  executeNodeWorkflowStep,
} from './workflow-executor-node.js';
import { workflowTimelineStore, generateExecutionId, type StepExecution } from '../lib/workflow-timeline.js';
import { loadGuestContext } from '../tools/guest-data-injector.js';
import { getWorkflowStore } from '../lib/redis-workflow-store.js';

// ─── US-582: Workflow State Resumption from Redis ────────────────────
// Persist booking workflow state to Redis with 48-hour TTL for resumption

// ─── US-574: Booking Workflow Skip-Step Logic for Returning Guests ────
/**
 * Check if a workflow step should be skipped based on guest profile fields.
 * If skip_if_guest_field is defined and all specified fields are populated in
 * the guest profile, the step is skipped.
 *
 * @param step - Current workflow step
 * @param collectedData - Accumulated workflow data (may include guest fields)
 * @returns true if step should be skipped, false otherwise
 */
function shouldSkipStep(step: WorkflowStep, collectedData: Record<string, string>): boolean {
  if (!step.skip_if_guest_field || step.skip_if_guest_field.length === 0) {
    return false;
  }

  // Check if all specified fields are populated in collected data
  // Fields are considered populated if they exist and are non-empty strings
  return step.skip_if_guest_field.every(field => {
    const value = collectedData[field];
    return value !== undefined && value !== null && value.trim() !== '';
  });
}

// ─── US-313: Booking Workflow Execution Audit Trail ──────────────────

export type WorkflowExecutionStatus = 'success' | 'error' | 'timeout' | 'skipped';

/**
 * US-313: Log a booking workflow step execution to the booking_execution_audit table.
 * Inserts an audit record with the step name, input/output data, status, and timestamp.
 * Returns the step result (output) unchanged so it can be used as a transparent wrapper.
 * In dry-run mode (dryRun=true), skips database write but returns output unchanged.
 */
export async function logWorkflowExecution(
  step: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  status: WorkflowExecutionStatus,
  bookingId?: string,
  dryRun: boolean = false,
): Promise<Record<string, unknown>> {
  const resolvedBookingId = bookingId || input.bookingId as string || `booking-${Date.now()}`;

  // Skip database write in dry-run mode
  if (dryRun) {
    console.log(`[WorkflowExecutor] US-313: [DRY-RUN] Would log audit for step "${step}" (booking: ${resolvedBookingId}, status: ${status})`);
    return output;
  }

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


// ─── US-560: Input Validation with Regex Patterns ──────────────────────

/**
 * US-560: Validates user input against an optional regex pattern.
 * Returns { valid: true } if validation passes or no regex is defined.
 * Returns { valid: false, error: string } if validation fails.
 */
export function validateStepInputRegex(
  userInput: string | undefined,
  regexPattern: string | undefined,
  stepId: string
): { valid: boolean; error?: string } {
  // No regex pattern defined - validation passes
  if (!regexPattern) {
    return { valid: true };
  }

  // User input is required if regex is defined
  if (!userInput || userInput.trim() === '') {
    return {
      valid: false,
      error: `Step "${stepId}" requires input. Please provide a response.`
    };
  }

  try {
    // Compile regex pattern - add case-insensitive flag for user-friendly matching
    const regex = new RegExp(regexPattern, 'i');
    const matches = regex.test(userInput);

    if (!matches) {
      return {
        valid: false,
        error: `Input validation failed for step "${stepId}". Please check your response format and try again.`
      };
    }

    return { valid: true };
  } catch (err) {
    console.error(
      `[WorkflowExecutor] US-560: Invalid regex pattern for step "${stepId}": ${regexPattern}`,
      err
    );

    // Fail-open: if regex is malformed, allow the input through
    return { valid: true };
  }
}


export interface WorkflowState {
  workflowId: string;
  currentStepIndex: number;
  collectedData: Record<string, string>; // step id -> user response
  startedAt: number;
  lastUpdateAt: number;
  // US-549: Execution timeline tracking
  executionId?: string;              // Unique ID for this workflow execution (for timeline retrieval)
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
  timeline?: StepExecution[]; // US-549: Step execution timeline for this step
  executionId?: string; // US-549: Execution ID for retrieving full timeline
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

  // US-549: Generate execution ID for timeline tracking
  const executionId = generateExecutionId();

  return {
    workflowId,
    currentStepIndex: 0,
    collectedData: {},
    startedAt: Date.now(),
    lastUpdateAt: Date.now(),
    executionId,
    // Set node-based fields if applicable
    ...(isNodes && workflow?.startNodeId ? {
      currentNodeId: workflow.startNodeId,
      nodeOutputs: {},
      isNodeBased: true,
    } : {}),
  };
}

/**
 * US-582: Load workflow state from Redis or create new
 *
 * AC2: On new user message, check Redis for active workflow state and resume from last completed step
 *
 * Attempts to load workflow state from Redis for the conversation.
 * If not found (TTL expired or new conversation), creates fresh state.
 *
 * @param workflowId - Workflow to load/create
 * @param conversationId - Phone number or unique conversation identifier
 * @returns Persisted state if found, otherwise new state
 */
export async function loadOrCreateWorkflowState(
  workflowId: string,
  conversationId?: string
): Promise<WorkflowState> {
  // If no conversation ID, create fresh state (cannot resume)
  if (!conversationId) {
    return createWorkflowState(workflowId);
  }

  // Try to load from Redis
  const store = getWorkflowStore();
  const persistedState = await store.load(conversationId, workflowId);

  if (persistedState) {
    console.log(
      `[WorkflowExecutor] US-582: Resumed workflow "${workflowId}" for ${conversationId} ` +
      `from Redis (step ${persistedState.currentStepIndex})`
    );
    // Update timestamps but preserve other state
    persistedState.lastUpdateAt = Date.now();
    return persistedState;
  }

  // No persisted state found, create new
  console.log(
    `[WorkflowExecutor] US-582: No persisted state for ${conversationId}/${workflowId}, ` +
    `creating fresh workflow`
  );
  return createWorkflowState(workflowId);
}

/**
 * US-582: Persist workflow state to Redis after each step
 *
 * AC1: Workflow executor saves state hash to Redis (conversation_id key) after each step with 48h TTL
 *
 * Saves the workflow state to Redis with 48-hour TTL.
 * This allows resumption if the conversation is re-engaged within the TTL window.
 *
 * @param conversationId - Phone number or unique conversation identifier
 * @param state - WorkflowState to persist
 */
export async function persistWorkflowState(
  conversationId: string | undefined,
  state: WorkflowState
): Promise<void> {
  if (!conversationId) {
    // Cannot persist without a conversation identifier
    return;
  }

  const store = getWorkflowStore();
  await store.save(conversationId, state.workflowId, state);
}

export async function executeWorkflowStep(
  state: WorkflowState,
  userMessage: string | null,
  context: WorkflowContext,
  dryRun: boolean = false
): Promise<WorkflowExecutionResult> {
  const { language, phone, pushName, instanceId } = context;
  const workflows = configStore.getWorkflows();
  const workflow = workflows.workflows.find(w => w.id === state.workflowId);

  // US-549: Initialize execution timeline if not present
  const executionId = state.executionId || generateExecutionId();
  if (!state.executionId) {
    workflowTimelineStore.createTimeline(
      executionId,
      state.workflowId,
      phone || 'unknown',
      context.profileId || 'unknown'
    );
  }

  if (!workflow) {
    return {
      response: 'Workflow not found. Please contact support.',
      newState: null,
      executionId
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
      newState: null,
      executionId
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
        newState: null,
        executionId
      };
    }
  }

  // ─── US-550: Guest Context Quick-Lookup Pre-Population ──────────────
  // If guest_id is present in collected data, load full guest context and populate workflow variables
  if (state.collectedData.guest_id && currentProfile) {
    try {
      const guestContext = await loadGuestContext(currentProfile, state.collectedData.guest_id);
      // Populate workflow variables with guest context (only if not already set by user)
      if (!state.collectedData.guest_name) {
        state.collectedData.guest_name = guestContext.name;
      }
      if (!state.collectedData.unit) {
        state.collectedData.unit = guestContext.unit;
      }
      if (!state.collectedData.check_in_date) {
        state.collectedData.check_in_date = guestContext.arrival_date;
      }
      if (!state.collectedData.check_out_date) {
        state.collectedData.check_out_date = guestContext.departure_date;
      }
      if (!state.collectedData.nights) {
        state.collectedData.nights = guestContext.nights.toString();
      }
      console.log(`[WorkflowExecutor] US-550: Pre-populated workflow variables for guest ${state.collectedData.guest_id}`);
    } catch (err: any) {
      console.warn(`[WorkflowExecutor] US-550: Guest context lookup failed for ${state.collectedData.guest_id}: ${err.message}`);
      // Non-blocking: missing guest context doesn't stop workflow execution
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
      newState: null,
      executionId
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
      newState: null,
      executionId
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
      // ─── US-560: Validate user input against regex pattern ────────
      const validationResult = validateStepInputRegex(
        userMessage,
        (previousStep as any).inputValidationRegex,
        previousStep.id
      );

      if (!validationResult.valid) {
        console.warn(
          `[WorkflowExecutor] US-560: Input validation failed for step "${previousStep.id}": ${validationResult.error}`
        );

        // Return validation error without advancing the workflow
        return {
          response: validationResult.error || 'Invalid input. Please try again.',
          newState: state, // Keep current state so user can retry
          executionId
        };
      }

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

    // US-549: Mark timeline as complete and retrieve it
    workflowTimelineStore.completeTimeline(executionId);
    const timeline = workflowTimelineStore.getTimeline(executionId);

    return {
      response: getStepMessage(lastStep, language),
      newState: null,
      shouldForward: true,
      conversationSummary: summary,
      workflowId: state.workflowId,
      stepId: lastStep.id,
      executionId,
      timeline: timeline?.steps || []
    };
  }

  const currentStep = workflow.steps[state.currentStepIndex];

  // ─── US-574: Skip Step Logic for Returning Guest Express Path ──────
  // Check if current step should be skipped based on guest profile fields
  // Loop to handle consecutive skippable steps
  let stepIndex = state.currentStepIndex;
  let finalStep = currentStep;
  while (stepIndex < workflow.steps.length) {
    const step = workflow.steps[stepIndex];
    if (shouldSkipStep(step, state.collectedData)) {
      console.log(`[WorkflowExecutor] US-574: Skipping step "${step.id}" - required guest fields already populated`);
      stepIndex++;
    } else {
      finalStep = step;
      break;
    }
  }

  // If all remaining steps are skipped, workflow is complete
  if (stepIndex >= workflow.steps.length) {
    const summary = buildConversationSummary(workflow, state);
    const lastStep = workflow.steps[workflow.steps.length - 1];

    workflowTimelineStore.completeTimeline(executionId);
    const timeline = workflowTimelineStore.getTimeline(executionId);

    console.log(`[WorkflowExecutor] US-574: Express path completed - all remaining steps skipped`);

    return {
      response: getStepMessage(lastStep, language),
      newState: null,
      shouldForward: true,
      conversationSummary: summary,
      workflowId: state.workflowId,
      stepId: lastStep.id,
      executionId,
      timeline: timeline?.steps || []
    };
  }

  // Update state to point to non-skipped step (if we skipped any)
  state.currentStepIndex = stepIndex;

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
        return executeWorkflowStep(nextState, null, context, dryRun);
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
          stepId: currentStep.id,
          executionId
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
          stepId: currentStep.id,
          executionId
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
          escalation_reason: availabilityResult.escalation_reason || 'unit_unavailable',
          executionId
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
          escalation_reason: 'booking_rules_validation_failed',
          executionId
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

  // ─── US-616: Per-Profile Custom Validation Rules Engine ──────────────
  // Execute profile-specific validation rules against booking step data
  if (currentStep.id && (state.workflowId.includes('book') || state.workflowId.includes('booking'))) {
    try {
      const profile = context.profileId || 'pelangi';
      const validationResult = validateBookingStep(state.collectedData, profile);

      if (!validationResult.valid) {
        // Return validation errors as guest-friendly message
        const errorMessage = validationResult.errors.join('\n\n');
        console.warn(
          `[WorkflowExecutor] US-616: Custom validation rules failed for step "${currentStep.id}": ${errorMessage}`
        );

        return {
          response: errorMessage,
          newState: null,
          shouldForward: true,
          workflowId: state.workflowId,
          stepId: currentStep.id,
          escalation_reason: 'validation_error',
          executionId
        };
      }

      console.log(`[WorkflowExecutor] US-616: Custom validation rules passed for step "${currentStep.id}"`);
    } catch (err) {
      // Fail-open: log error but allow workflow to proceed
      console.error(
        `[WorkflowExecutor] US-616: Unexpected error during custom validation rules:`,
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

    // US-121 / US-549: Start profiling this step and timeline recording
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

      const stepEndTime = Date.now();

      // US-121: Record step execution metrics
      const stepDuration = stepEndTime - stepStartTime;
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

      // US-549: Log step execution to timeline
      const nextStepIndex = state.currentStepIndex + 1;
      const nextStepId = nextStepIndex < workflow.steps.length ? workflow.steps[nextStepIndex].id : null;
      workflowTimelineStore.logStepExecution(
        executionId,
        currentStep.id || `step_${state.currentStepIndex}`,
        stepStartTime,
        stepEndTime,
        enhancerContext,
        { message: response, ...enhanced.metadata },
        nextStepId
      );

      // Log metadata for debugging
      if (enhanced.metadata) {
        console.log(`[WorkflowExecutor] Step ${currentStep.id} metadata:`, enhanced.metadata);
      }
    } catch (error) {
      // US-120 / US-324: Handle timeout with graceful fallback
      if (error instanceof WorkflowTimeoutError) {
        console.error(`[WorkflowExecutor] US-324: Step timeout:`, error.message);

        const stepEndTime = Date.now();

        // US-324: Use per-step fallbackResponse if configured, else generic escalation
        const fallbackResponse = (currentStep as any).fallbackResponse || getTimeoutEscalationMessage(language);
        const hasFallback = !!(currentStep as any).fallbackResponse;

        // US-549: Log timeout step to timeline
        const nextStepIndex = state.currentStepIndex + 1;
        const nextStepId = nextStepIndex < workflow.steps.length ? workflow.steps[nextStepIndex].id : null;
        workflowTimelineStore.logStepExecution(
          executionId,
          currentStep.id || `step_${state.currentStepIndex}`,
          stepStartTime,
          stepEndTime,
          enhancerContext,
          { error: 'timeout', message: fallbackResponse },
          nextStepId
        );

        // US-324: Log to booking_workflow_events for per-step timeout metrics
        if (!dryRun) {
          try {
            await pool.query(
              `INSERT INTO booking_workflow_events (step_name, workflow_id, profile_id, elapsed_ms, timed_out_at, fallback_used)
               VALUES ($1, $2, $3, $4, NOW(), $5)`,
              [currentStep.id, state.workflowId, context.profileId || null, error.actualDurationMs, hasFallback]
            );
          } catch (dbErr) {
            console.error(`[WorkflowExecutor] US-324: Failed to log to booking_workflow_events:`, dbErr);
          }
        } else {
          console.log(`[WorkflowExecutor] US-324: [DRY-RUN] Would log timeout event for step "${currentStep.id}"`);
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
          stepId: currentStep.id,
          executionId
        };
      }

      // Handle other errors with graceful degradation
      console.error(`[WorkflowExecutor] Failed to enhance step ${currentStep.id}:`, error);
      // Continue with original message on error (graceful degradation)
    }
  }

  // Update state
  // US-549: Preserve executionId for timeline tracking across steps
  const newState: WorkflowState = {
    ...state,
    executionId,
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
      const errorState = { ...state, executionId };
      await persistWorkflowState(phone, errorState);

      return {
        response: clarifyingMessages[language as keyof typeof clarifyingMessages] || clarifyingMessages.en,
        newState: errorState,
        workflowId: state.workflowId,
        stepId: currentStep.id,
        executionId
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

  // US-582: Persist workflow state to Redis with 48h TTL
  // This enables resumption if the conversation is re-engaged within the TTL window
  if (newState) {
    await persistWorkflowState(phone, newState);
  }

  return {
    response,
    newState,
    shouldForward: false,
    workflowId: state.workflowId,
    stepId: currentStep.id,
    executionId
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
  context: WorkflowContext,
  dryRun: boolean = false
): Promise<WorkflowExecutionResult> {
  // Skip transaction wrapping in dry-run mode (no DB writes to commit/rollback)
  if (dryRun) {
    return executeWorkflowStep(state, userMessage, context, dryRun);
  }

  const [result, metrics] = await executeWorkflowInTransaction(
    () => executeWorkflowStep(state, userMessage, context, dryRun),
    state.workflowId
  );

  // Log metrics for monitoring
  logTransactionMetrics(metrics, state.workflowId);

  return result;
}
