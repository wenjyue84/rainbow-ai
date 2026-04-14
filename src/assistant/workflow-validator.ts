/**
 * US-616: Per-Profile Custom Validation Rules Engine for Booking Steps
 *
 * Validates booking workflow steps against profile-specific rules.
 * Rules are loaded from src/assistant/data/booking-validators-{profile}.json
 * and executed in a sandboxed environment using vm2 for safety.
 */

import { VM } from 'vm2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Types ───────────────────────────────────────────────────────────

export interface ValidationRule {
  field: string;
  operator: 'exists' | '>' | '<' | '>=' | '<=' | '===' | '!==' | 'in' | 'regex';
  value: unknown;
  message: string;
  required?: boolean; // defaults to true if not specified
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface BookingStepData {
  [key: string]: unknown;
}

// ─── Rules Loader ────────────────────────────────────────────────────

/**
 * Load validation rules from profile-specific JSON file.
 * Looks for: src/assistant/data/booking-validators-{profile}.json
 *
 * @param profile - Profile ID (e.g., 'pelangi', 'makan')
 * @returns Array of validation rules, or empty array if file not found
 */
function loadValidationRules(profile: string): ValidationRule[] {
  try {
    const rulesPath = path.join(
      __dirname,
      'data',
      `booking-validators-${profile}.json`
    );

    if (!fs.existsSync(rulesPath)) {
      console.warn(`[WorkflowValidator] No validation rules found for profile: ${profile}`);
      return [];
    }

    const rulesContent = fs.readFileSync(rulesPath, 'utf-8');
    const rules = JSON.parse(rulesContent) as ValidationRule[];

    console.log(
      `[WorkflowValidator] Loaded ${rules.length} validation rules for profile: ${profile}`
    );

    return rules;
  } catch (err) {
    console.error(
      `[WorkflowValidator] Error loading validation rules for profile ${profile}:`,
      err
    );
    return [];
  }
}

// ─── Rule Execution ──────────────────────────────────────────────────

/**
 * Evaluate a single validation rule against booking data in a sandboxed environment.
 *
 * @param rule - The validation rule to evaluate
 * @param data - The booking step data to validate
 * @returns Error message if validation fails, null if valid
 */
function evaluateRule(rule: ValidationRule, data: BookingStepData): string | null {
  const fieldValue = data[rule.field];

  // Check if field exists (for 'exists' operator)
  if (rule.operator === 'exists') {
    const exists =
      fieldValue !== undefined &&
      fieldValue !== null &&
      (typeof fieldValue === 'string' ? fieldValue.trim() !== '' : true);

    if (!exists && rule.required !== false) {
      return rule.message;
    }
    return null; // Valid if exists or not required
  }

  // For optional fields, skip validation if not provided
  if (
    (fieldValue === undefined || fieldValue === null) &&
    rule.required === false
  ) {
    return null;
  }

  // For required fields with other operators, field must exist
  if (fieldValue === undefined || fieldValue === null) {
    return rule.message;
  }

  // Safe evaluation of comparison operators in vm2 sandbox
  try {
    const sandbox = {
      fieldValue,
      ruleValue: rule.value,
      operator: rule.operator,
    };

    const vm = new VM({
      timeout: 1000, // 1 second timeout
      sandbox,
    });

    // Build the expression based on operator and return it from the vm
    let expression: string;
    switch (rule.operator) {
      case '>':
        expression = 'fieldValue > ruleValue';
        break;
      case '<':
        expression = 'fieldValue < ruleValue';
        break;
      case '>=':
        expression = 'fieldValue >= ruleValue';
        break;
      case '<=':
        expression = 'fieldValue <= ruleValue';
        break;
      case '===':
        expression = 'fieldValue === ruleValue';
        break;
      case '!==':
        expression = 'fieldValue !== ruleValue';
        break;
      case 'in':
        expression =
          'Array.isArray(ruleValue) && ruleValue.includes(fieldValue)';
        break;
      case 'regex':
        expression =
          'typeof ruleValue === "string" && new RegExp(ruleValue).test(String(fieldValue))';
        break;
      default:
        console.warn(`[WorkflowValidator] Unknown operator: ${rule.operator}`);
        return null;
    }

    const result = vm.run(expression);

    if (!result) {
      return rule.message;
    }

    return null; // Valid
  } catch (err) {
    console.error(
      `[WorkflowValidator] Error evaluating rule for field "${rule.field}":`,
      err
    );
    // Fail-open: if rule evaluation fails, don't block the workflow
    return null;
  }
}

// ─── Main Validation Function ────────────────────────────────────────

/**
 * US-616: Validate a booking workflow step against profile-specific rules.
 *
 * Loads validation rules from src/assistant/data/booking-validators-{profile}.json,
 * executes them in a sandboxed environment, and returns validation errors.
 *
 * @param stepData - The collected booking data for this step
 * @param profile - The profile/business ID (e.g., 'pelangi', 'makan')
 * @returns ValidationResult with valid flag and error messages
 */
export function validateBookingStep(
  stepData: BookingStepData,
  profile: string = 'pelangi'
): ValidationResult {
  // Load rules for this profile
  const rules = loadValidationRules(profile);

  if (rules.length === 0) {
    // No rules defined for this profile, allow booking to proceed
    return { valid: true, errors: [] };
  }

  // Evaluate all rules
  const errors: string[] = [];

  for (const rule of rules) {
    const error = evaluateRule(rule, stepData);
    if (error) {
      errors.push(error);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Export for testing: evaluate a rule directly (bypasses sandbox for unit tests)
 */
export function evaluateRuleUnsafed(
  rule: ValidationRule,
  data: BookingStepData
): boolean {
  // For testing purposes, simple evaluation without sandbox
  const fieldValue = data[rule.field];

  if (rule.operator === 'exists') {
    return (
      fieldValue !== undefined &&
      fieldValue !== null &&
      (typeof fieldValue === 'string' ? fieldValue.trim() !== '' : true)
    );
  }

  switch (rule.operator) {
    case '>':
      return fieldValue > rule.value;
    case '<':
      return fieldValue < rule.value;
    case '>=':
      return fieldValue >= rule.value;
    case '<=':
      return fieldValue <= rule.value;
    case '===':
      return fieldValue === rule.value;
    case '!==':
      return fieldValue !== rule.value;
    case 'in':
      return (
        Array.isArray(rule.value) &&
        rule.value.includes(fieldValue)
      );
    case 'regex':
      return (
        typeof rule.value === 'string' &&
        new RegExp(rule.value).test(String(fieldValue))
      );
    default:
      return false;
  }
}
