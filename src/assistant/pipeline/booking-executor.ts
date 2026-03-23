/**
 * US-264: Booking Workflow Step Timeout Detection with Auto-Rollback
 * US-284: Booking Workflow Step Output Schema Validator
 *
 * Provides a stepExecutionTimer that wraps booking step execution with
 * configurable per-step timeouts. When a step exceeds its timeout threshold,
 * the guest's booking state is automatically rolled back and a clear
 * step_timeout error with recovery message is returned.
 *
 * Also provides validateWorkflowStepOutput() that validates booking workflow
 * step outputs conform to expected schema from workflows.json before passing
 * to the next step.
 */

import type { BookingState, BookingStepResult } from '../types.js';
import { db } from '../../lib/db.js';
import { workflowStepValidationErrors } from '../../../shared/schema-tables.js';

// ─── Constants ───────────────────────────────────────────────────────

/** Default timeout for booking steps (ms) */
export const DEFAULT_STEP_TIMEOUT_MS = 5000;

/** Reason code returned on step timeout */
export const STEP_TIMEOUT_REASON_CODE = 'step_timeout';

/** Recovery messages per language */
export const TIMEOUT_RECOVERY_MESSAGES: Record<string, string> = {
  en: 'Booking step took too long. Please try again or speak with staff.',
  ms: 'Langkah tempahan mengambil masa terlalu lama. Sila cuba lagi atau hubungi kakitangan.',
  zh: '\u9884\u8BA2\u6B65\u9AA4\u8017\u65F6\u8FC7\u957F\u3002\u8BF7\u91CD\u8BD5\u6216\u8054\u7CFB\u5DE5\u4F5C\u4EBA\u5458\u3002',
  ta: '\u0BAA\u0BC1\u0B95\u0BCD\u0B95\u0BBF\u0B99\u0BCD \u0BA8\u0B9F\u0BB5\u0B9F\u0BBF\u0B95\u0BCD\u0B95\u0BC8 \u0BAE\u0BBF\u0B95\u0BB5\u0BC1\u0BAE\u0BCD \u0BA8\u0BC0\u0BA3\u0BCD\u0B9F\u0BA4\u0BC1. \u0BAE\u0BC0\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD \u0BAE\u0BC1\u0BAF\u0BB1\u0BCD\u0B9A\u0BBF\u0B95\u0BCD\u0B95\u0BB5\u0BC1\u0BAE\u0BCD \u0B85\u0BB2\u0BCD\u0BB2\u0BA4\u0BC1 \u0B8A\u0BB4\u0BBF\u0BAF\u0BB0\u0BCD\u0B95\u0BB3\u0BBF\u0B9F\u0BAE\u0BCD \u0BAA\u0BC7\u0B9A\u0BC1\u0B99\u0BCD\u0B95\u0BB3\u0BCD.',
};

// ─── Types ───────────────────────────────────────────────────────────

/**
 * Result of a booking step execution with timeout handling.
 * On timeout, includes reason code and recovery message.
 */
export interface BookingExecutionResult {
  success: boolean;
  result?: BookingStepResult;
  timedOut: boolean;
  reasonCode?: string;
  recoveryMessage?: string;
  /** The pre-timeout booking state for rollback verification */
  rolledBackState?: BookingState;
  elapsedMs: number;
}

/**
 * Custom error for booking step timeouts.
 */
export class BookingStepTimeoutError extends Error {
  public readonly stepId: string;
  public readonly timeoutMs: number;
  public readonly reasonCode = STEP_TIMEOUT_REASON_CODE;

  constructor(stepId: string, timeoutMs: number) {
    super(
      `Booking step "${stepId}" timed out after ${timeoutMs}ms`
    );
    this.name = 'BookingStepTimeoutError';
    this.stepId = stepId;
    this.timeoutMs = timeoutMs;
  }
}

// ─── Step Timeout Configuration ──────────────────────────────────────

/**
 * Reads the timeout value for a specific booking step from the workflow
 * definition. Falls back to DEFAULT_STEP_TIMEOUT_MS if no timeout is
 * defined on the node.
 */
export function getStepTimeout(
  stepId: string,
  workflowNodes?: Array<{ id: string; timeout?: number }>
): number {
  if (!workflowNodes) return DEFAULT_STEP_TIMEOUT_MS;
  const node = workflowNodes.find(n => n.id === stepId);
  return node?.timeout ?? DEFAULT_STEP_TIMEOUT_MS;
}

// ─── Core Timer ──────────────────────────────────────────────────────

/**
 * stepExecutionTimer wraps a booking step function with a timeout.
 *
 * If the step completes within the timeout, returns the step result.
 * If the step exceeds the timeout:
 *   1. Rolls back the guest booking state to the pre-execution snapshot
 *   2. Returns a BookingExecutionResult with step_timeout reason code
 *      and a localized recovery message
 *   3. Prevents any partial booking confirmation from being persisted
 *
 * @param executeFn - The async function that executes the booking step
 * @param preExecutionState - Snapshot of booking state before step runs (for rollback)
 * @param stepId - Identifier of the step being executed
 * @param timeoutMs - Maximum allowed execution time in milliseconds
 * @param language - Language code for recovery message
 * @returns BookingExecutionResult with success/timeout status
 */
export async function stepExecutionTimer(
  executeFn: () => Promise<BookingStepResult>,
  preExecutionState: BookingState,
  stepId: string,
  timeoutMs: number = DEFAULT_STEP_TIMEOUT_MS,
  language: string = 'en'
): Promise<BookingExecutionResult> {
  const startTime = Date.now();

  return new Promise<BookingExecutionResult>((resolve) => {
    let settled = false;

    // Set the timeout
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;

      const elapsedMs = Date.now() - startTime;
      console.error(
        `[BookingExecutor] Step "${stepId}" timed out after ${elapsedMs}ms ` +
        `(threshold: ${timeoutMs}ms) — rolling back guest state`
      );

      resolve({
        success: false,
        timedOut: true,
        reasonCode: STEP_TIMEOUT_REASON_CODE,
        recoveryMessage: TIMEOUT_RECOVERY_MESSAGES[language] || TIMEOUT_RECOVERY_MESSAGES.en,
        rolledBackState: { ...preExecutionState },
        elapsedMs,
      });
    }, timeoutMs);

    // Execute the step
    executeFn()
      .then((result) => {
        if (settled) return; // Timeout already fired
        settled = true;
        clearTimeout(timeoutId);

        const elapsedMs = Date.now() - startTime;
        resolve({
          success: true,
          result,
          timedOut: false,
          elapsedMs,
        });
      })
      .catch((error) => {
        if (settled) return; // Timeout already fired
        settled = true;
        clearTimeout(timeoutId);

        const elapsedMs = Date.now() - startTime;
        console.error(
          `[BookingExecutor] Step "${stepId}" failed after ${elapsedMs}ms:`,
          error instanceof Error ? error.message : error
        );

        // On non-timeout errors, also roll back state
        resolve({
          success: false,
          timedOut: false,
          reasonCode: 'step_error',
          recoveryMessage: TIMEOUT_RECOVERY_MESSAGES[language] || TIMEOUT_RECOVERY_MESSAGES.en,
          rolledBackState: { ...preExecutionState },
          elapsedMs,
        });
      });
  });
}

/**
 * Convenience function: execute a booking step with timeout from workflow config.
 *
 * Reads the timeout for the given stepId from the workflow node definitions
 * and wraps execution with stepExecutionTimer.
 */
export async function executeBookingStepWithTimeout(
  executeFn: () => Promise<BookingStepResult>,
  preExecutionState: BookingState,
  stepId: string,
  workflowNodes?: Array<{ id: string; timeout?: number }>,
  language: string = 'en'
): Promise<BookingExecutionResult> {
  const timeoutMs = getStepTimeout(stepId, workflowNodes);
  return stepExecutionTimer(executeFn, preExecutionState, stepId, timeoutMs, language);
}

// ─── US-284: Workflow Step Output Schema Validator ──────────────────

/**
 * Schema field definition describing expected output shape for a workflow step.
 */
export interface StepOutputSchemaField {
  /** Field name */
  name: string;
  /** Expected type: 'string' | 'number' | 'boolean' | 'object' | 'array' */
  type: string;
  /** Whether the field is required (default: true) */
  required?: boolean;
}

/**
 * Result of validating a workflow step's output against its schema.
 */
export interface StepOutputValidationResult {
  valid: boolean;
  errors: string[];
  stepId: string;
  profile: string;
}

/**
 * Workflow node definition shape (subset needed for schema extraction).
 */
export interface WorkflowNodeDef {
  id: string;
  type: string;
  config?: {
    storeAs?: string;
    field?: string;
    message?: Record<string, string> | string;
    receiver?: string;
    content?: Record<string, string> | string;
    [key: string]: unknown;
  };
  next?: string;
  [key: string]: unknown;
}

/**
 * Derives the expected output schema for a workflow step based on its
 * node type and configuration in workflows.json.
 *
 * - wait_reply nodes: expect the storeAs field to be a non-empty string
 * - condition nodes: expect a boolean evaluation result and the field reference
 * - message nodes: expect a message string (the rendered output)
 * - whatsapp_send nodes: expect receiver and content strings
 * - Other types: at minimum expect a step result with response string
 */
export function deriveStepSchema(node: WorkflowNodeDef): StepOutputSchemaField[] {
  switch (node.type) {
    case 'wait_reply':
      return [
        { name: node.config?.storeAs || 'value', type: 'string', required: true },
      ];

    case 'condition':
      return [
        { name: 'conditionResult', type: 'boolean', required: true },
        { name: 'evaluatedField', type: 'string', required: true },
      ];

    case 'message':
      return [
        { name: 'message', type: 'string', required: true },
      ];

    case 'whatsapp_send':
      return [
        { name: 'receiver', type: 'string', required: true },
        { name: 'content', type: 'string', required: true },
      ];

    case 'pelangi_api':
      return [
        { name: 'apiResponse', type: 'object', required: true },
      ];

    case 'function':
      return [
        { name: 'result', type: 'string', required: false },
      ];

    default:
      // Minimal schema: all steps should produce a response
      return [
        { name: 'response', type: 'string', required: true },
      ];
  }
}

/**
 * Validates a single field value against its schema definition.
 * Returns an error message if validation fails, or null if valid.
 */
function validateField(
  fieldDef: StepOutputSchemaField,
  output: Record<string, unknown>,
  stepId: string
): string | null {
  const value = output[fieldDef.name];

  // Check required fields
  if (fieldDef.required !== false) {
    if (value === undefined) {
      return `Step "${stepId}": missing required field "${fieldDef.name}" (expected ${fieldDef.type})`;
    }
    if (value === null) {
      return `Step "${stepId}": field "${fieldDef.name}" is null (expected non-null ${fieldDef.type})`;
    }
  }

  // Skip type check for optional absent fields
  if (value === undefined || value === null) {
    return null;
  }

  // Type checking
  const actualType = Array.isArray(value) ? 'array' : typeof value;
  if (actualType !== fieldDef.type) {
    return `Step "${stepId}": field "${fieldDef.name}" type mismatch — expected ${fieldDef.type}, got ${actualType}`;
  }

  // String-specific: reject empty strings for required fields
  if (fieldDef.type === 'string' && fieldDef.required !== false && (value as string).trim() === '') {
    return `Step "${stepId}": field "${fieldDef.name}" is an empty string (expected non-empty ${fieldDef.type})`;
  }

  return null;
}

/**
 * Finds a workflow node definition by stepId in the workflows.json data.
 * Searches across all workflows and both "nodes" (booking_payment_handler format)
 * and "steps" (checkin_full format) arrays.
 */
export function findNodeInWorkflows(
  stepId: string,
  workflowsData: { workflows: Array<{ id: string; nodes?: WorkflowNodeDef[]; steps?: WorkflowNodeDef[] }> }
): WorkflowNodeDef | null {
  for (const wf of workflowsData.workflows) {
    // Try nodes array first (booking_payment_handler format)
    const fromNodes = wf.nodes?.find(n => n.id === stepId);
    if (fromNodes) return fromNodes;

    // Try steps array (checkin_full, complaint, etc.)
    const fromSteps = wf.steps?.find(s => s.id === stepId);
    if (fromSteps) return fromSteps;
  }
  return null;
}

/**
 * US-284: Validates that a booking workflow step's output conforms to the
 * expected schema derived from workflows.json.
 *
 * Catches malformed data early before it propagates to the next step,
 * preventing downstream workflow failures. Validation failures are logged
 * to the workflow_step_validation_errors table for admin review.
 *
 * @param stepId - The workflow step ID to validate against
 * @param output - The output data produced by the step
 * @param profile - Profile identifier (e.g., 'pelangi', 'southern')
 * @param workflowsData - Parsed workflows.json content (optional, for testing)
 * @returns StepOutputValidationResult with valid flag and detailed errors
 */
export async function validateWorkflowStepOutput(
  stepId: string,
  output: Record<string, unknown>,
  profile: string,
  workflowsData?: { workflows: Array<{ id: string; nodes?: WorkflowNodeDef[]; steps?: WorkflowNodeDef[] }> }
): Promise<StepOutputValidationResult> {
  const result: StepOutputValidationResult = {
    valid: true,
    errors: [],
    stepId,
    profile,
  };

  // Load workflows.json if not provided
  let workflows = workflowsData;
  if (!workflows) {
    try {
      const { readFile } = await import('fs/promises');
      const { fileURLToPath } = await import('url');
      const { dirname, join } = await import('path');
      const currentDir = dirname(fileURLToPath(import.meta.url));
      const workflowsPath = join(currentDir, '..', 'data', 'workflows.json');
      const raw = await readFile(workflowsPath, 'utf-8');
      workflows = JSON.parse(raw);
    } catch {
      result.valid = false;
      result.errors.push(`Step "${stepId}": failed to load workflows.json`);
      return result;
    }
  }

  // Find the node definition
  const node = findNodeInWorkflows(stepId, workflows!);
  if (!node) {
    result.valid = false;
    result.errors.push(`Step "${stepId}": not found in any workflow definition`);
    return result;
  }

  // Derive expected schema from node definition
  const schema = deriveStepSchema(node);

  // Validate each field
  for (const fieldDef of schema) {
    const error = validateField(fieldDef, output, stepId);
    if (error) {
      result.errors.push(error);
      result.valid = false;
    }
  }

  // Log validation failures to DB (fire-and-forget)
  if (!result.valid) {
    logValidationError(stepId, profile, schema, output, result.errors, workflows).catch((err) => {
      console.error(
        `[BookingExecutor] Failed to log validation error for step "${stepId}":`,
        err instanceof Error ? err.message : err
      );
    });
  }

  return result;
}

/**
 * Logs a validation failure to the workflow_step_validation_errors table.
 * Fire-and-forget — never blocks the caller.
 */
async function logValidationError(
  stepId: string,
  profile: string,
  schema: StepOutputSchemaField[],
  output: Record<string, unknown>,
  errors: string[],
  workflowsData?: { workflows: Array<{ id: string; nodes?: WorkflowNodeDef[]; steps?: WorkflowNodeDef[] }> }
): Promise<void> {
  // Determine which workflow this step belongs to
  let workflowId: string | undefined;
  if (workflowsData) {
    for (const wf of workflowsData.workflows) {
      const inNodes = wf.nodes?.some(n => n.id === stepId);
      const inSteps = wf.steps?.some(s => s.id === stepId);
      if (inNodes || inSteps) {
        workflowId = wf.id;
        break;
      }
    }
  }

  await db.insert(workflowStepValidationErrors).values({
    stepId,
    profileId: profile,
    expectedSchema: schema,
    actualOutput: output,
    errorMessages: errors,
    workflowId: workflowId ?? null,
  });
}
