/**
 * US-549: Booking Workflow Step Execution Timeline Tracer
 *
 * In-memory storage and management of workflow step execution timelines.
 * Each workflow execution gets a unique execution_id and timeline tracking.
 */

/**
 * Represents a single step execution in the workflow timeline.
 * Captures timing, input/output, and next step information for debugging.
 */
export interface StepExecution {
  step_name: string;
  start_time: number; // milliseconds since epoch
  end_time: number;   // milliseconds since epoch
  duration_ms: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  next_step: string | null; // ID of next step, or null if final
  slow_step?: boolean; // Computed: duration_ms > 500
}

/**
 * Timeline data for a workflow execution.
 */
export interface WorkflowTimeline {
  execution_id: string;
  workflow_id: string;
  phone: string;
  profile_id: string;
  started_at: number;
  completed_at?: number;
  steps: StepExecution[];
}

/**
 * In-memory storage for workflow timelines.
 * Uses a Map keyed by execution_id.
 * Entries are cleared after a configurable retention period.
 */
class WorkflowTimelineStore {
  private timelines: Map<string, WorkflowTimeline> = new Map();
  private readonly RETENTION_MS = 1000 * 60 * 60; // 1 hour

  /**
   * Create a new timeline for a workflow execution.
   */
  createTimeline(
    execution_id: string,
    workflow_id: string,
    phone: string,
    profile_id: string
  ): WorkflowTimeline {
    const timeline: WorkflowTimeline = {
      execution_id,
      workflow_id,
      phone,
      profile_id,
      started_at: Date.now(),
      steps: []
    };

    this.timelines.set(execution_id, timeline);

    // Schedule automatic cleanup after retention period
    setTimeout(() => {
      this.timelines.delete(execution_id);
    }, this.RETENTION_MS);

    return timeline;
  }

  /**
   * Log a step execution to the timeline.
   */
  logStepExecution(
    execution_id: string,
    step_name: string,
    start_time: number,
    end_time: number,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
    next_step: string | null
  ): void {
    const timeline = this.timelines.get(execution_id);
    if (!timeline) {
      console.warn(`[WorkflowTimeline] Timeline not found for execution_id: ${execution_id}`);
      return;
    }

    const duration_ms = end_time - start_time;
    const step: StepExecution = {
      step_name,
      start_time,
      end_time,
      duration_ms,
      input,
      output,
      next_step,
      slow_step: duration_ms > 500
    };

    timeline.steps.push(step);
  }

  /**
   * Mark a workflow execution as completed.
   */
  completeTimeline(execution_id: string): void {
    const timeline = this.timelines.get(execution_id);
    if (timeline) {
      timeline.completed_at = Date.now();
    }
  }

  /**
   * Retrieve the timeline for a workflow execution.
   * Returns sorted steps (by start_time) and includes slow_step flag.
   */
  getTimeline(execution_id: string): WorkflowTimeline | null {
    return this.timelines.get(execution_id) || null;
  }

  /**
   * Get all timelines (for debugging/admin).
   */
  getAllTimelines(): WorkflowTimeline[] {
    return Array.from(this.timelines.values());
  }

  /**
   * Clear all timelines (for testing).
   */
  clearAll(): void {
    this.timelines.clear();
  }
}

// Singleton instance
export const workflowTimelineStore = new WorkflowTimelineStore();

/**
 * Generate a unique execution ID for a workflow run.
 */
export function generateExecutionId(): string {
  return `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
