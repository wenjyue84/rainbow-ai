/**
 * WorkflowEngine — Dependency validation for workflow step transitions.
 * US-576: Prevents users from skipping required steps (e.g., payment before address confirmation).
 */
import type { WorkflowDefinition, WorkflowStep } from './schemas.js';

export interface DependencyValidationResult {
  valid: boolean;
  missingDependencies: string[];
  guidanceMessage: string;
}

export type ProgressResult =
  | { success: true; step: WorkflowStep }
  | { success: false; error: string; guidanceMessage: string };

export class WorkflowEngine {
  /**
   * Validates that all dependencies for a target step have been completed.
   */
  validateDependencies(
    workflow: WorkflowDefinition,
    targetStepId: string,
    completedSteps: Set<string>
  ): DependencyValidationResult {
    const steps = workflow.steps ?? [];
    const targetStep = steps.find(s => s.id === targetStepId);

    if (!targetStep) {
      return {
        valid: false,
        missingDependencies: [],
        guidanceMessage: `Step "${targetStepId}" not found in workflow "${workflow.id}".`,
      };
    }

    const deps = (targetStep as any).dependencies as string[] | undefined;
    if (!deps || deps.length === 0) {
      return { valid: true, missingDependencies: [], guidanceMessage: '' };
    }

    const missing = deps.filter(dep => !completedSteps.has(dep));

    if (missing.length === 0) {
      return { valid: true, missingDependencies: [], guidanceMessage: '' };
    }

    // Build human-readable step names for guidance
    const missingNames = missing.map(depId => {
      const depStep = steps.find(s => s.id === depId);
      return depStep ? (depStep as any).name || depId : depId;
    });

    const guidanceMessage = `Please complete the following step(s) first: ${missingNames.join(', ')}.`;

    return {
      valid: false,
      missingDependencies: missing,
      guidanceMessage,
    };
  }

  /**
   * Attempts to progress to a target step, validating dependencies first.
   */
  progressToStep(
    workflow: WorkflowDefinition,
    targetStepId: string,
    completedSteps: Set<string>
  ): ProgressResult {
    const steps = workflow.steps ?? [];
    const targetStep = steps.find(s => s.id === targetStepId);

    if (!targetStep) {
      return {
        success: false,
        error: `Step "${targetStepId}" not found in workflow "${workflow.id}".`,
        guidanceMessage: `Step "${targetStepId}" does not exist.`,
      };
    }

    const validation = this.validateDependencies(workflow, targetStepId, completedSteps);

    if (!validation.valid) {
      return {
        success: false,
        error: `Dependencies not met for step "${targetStepId}".`,
        guidanceMessage: validation.guidanceMessage,
      };
    }

    return { success: true, step: targetStep };
  }
}
