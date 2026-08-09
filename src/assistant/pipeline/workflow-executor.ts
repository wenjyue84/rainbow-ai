/**
 * US-354: Workflow Step Input Validation
 *
 * Validates booking workflow step inputs against expected schemas defined in workflows.json.
 * Provides early type checking with actionable error messages for debugging.
 */

import type { WorkflowStep } from '../schemas.js';

/**
 * Represents the result of input schema validation.
 * success: true if input matches expected schema
 * error: Human-readable error message with expected vs actual fields
 */
export interface ValidationResult {
  success: boolean;
  error?: string;
  expectedFields?: Record<string, string>;
  actualFields?: Record<string, string>;
}

/**
 * Validates workflow step input against the step's inputSchema.
 *
 * Checks:
 * - All required fields are present
 * - Field types match expected types
 * - Extra unexpected fields are logged as warnings
 *
 * Returns ValidationResult with:
 * - success=true if validation passes
 * - success=false with error message if validation fails
 * - expectedFields and actualFields for debugging
 *
 * Example error:
 * "Step check-availability expects {roomType: string, checkIn: Date} but received {roomType: string, checkIn: "2026-03-24"}"
 */
export function validateStepInput(step: WorkflowStep, input: unknown): ValidationResult {
  // If no inputSchema defined, skip validation (optional feature)
  if (!step.inputSchema || Object.keys(step.inputSchema).length === 0) {
    return { success: true };
  }

  // Type guard: input must be an object
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      success: false,
      error: `Step "${step.id}" expects an object but received ${getTypeName(input)}`,
      expectedFields: step.inputSchema,
      actualFields: {}
    };
  }

  const inputObj = input as Record<string, unknown>;
  const actualFields: Record<string, string> = {};
  const errors: string[] = [];

  // Check each expected field
  for (const [fieldName, expectedType] of Object.entries(step.inputSchema)) {
    const actualValue = inputObj[fieldName];
    const actualType = getTypeName(actualValue);

    actualFields[fieldName] = actualType;

    // Check if field is missing
    if (actualValue === undefined) {
      errors.push(`missing "${fieldName}" (expected ${expectedType})`);
      continue;
    }

    // Type mismatch check (loose comparison: "Date" strings are acceptable as string type)
    if (!isTypeMatch(actualValue, expectedType)) {
      errors.push(`"${fieldName}" is ${actualType} but expected ${expectedType}`);
    }
  }

  // Warn about extra unexpected fields
  const extraFields = Object.keys(inputObj).filter(key => !step.inputSchema![key]);
  if (extraFields.length > 0) {
    console.warn(`[WorkflowValidator] Step "${step.id}" received unexpected fields: ${extraFields.join(', ')}`);
  }

  if (errors.length > 0) {
    const errorMessage = `Step "${step.id}" input validation failed:\n  Expected: ${JSON.stringify(step.inputSchema)}\n  Received: ${JSON.stringify(actualFields)}\n  Issues: ${errors.join('; ')}`;
    return {
      success: false,
      error: errorMessage,
      expectedFields: step.inputSchema,
      actualFields
    };
  }

  return { success: true };
}

/**
 * Helper: Get human-readable type name for a value
 */
function getTypeName(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'Date';
  return typeof value;
}

/**
 * Helper: Check if a value matches an expected type string
 * Supports: 'string', 'number', 'boolean', 'Date', 'array', 'object', 'any'
 */
function isTypeMatch(value: unknown, expectedType: string): boolean {
  if (expectedType === 'any') return true;

  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'Date':
      return value instanceof Date || typeof value === 'string'; // Accept ISO string as Date
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      // Unknown type — be permissive (pass validation)
      return true;
  }
}
