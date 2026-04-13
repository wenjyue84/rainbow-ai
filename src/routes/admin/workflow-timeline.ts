/**
 * US-549: Workflow Execution Timeline Retrieval Routes
 *
 * GET /admin/workflows/:execution_id/timeline
 * Returns the step execution timeline for a workflow run with timing, state, and performance metrics.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { workflowTimelineStore } from '../../lib/workflow-timeline.js';
import { ok, badRequest, notFound } from './http-utils.js';

const router = Router();

/**
 * GET /admin/workflows/:execution_id/timeline
 * Retrieve the execution timeline for a workflow run.
 *
 * Returns:
 * {
 *   "execution_id": "exec_1234567890_abc123",
 *   "workflow_id": "booking_basic",
 *   "phone": "+601234567890",
 *   "profile_id": "pelangi",
 *   "started_at": 1681234567890,
 *   "completed_at": 1681234580000,
 *   "steps": [
 *     {
 *       "step_name": "step_1_greeting",
 *       "start_time": 1681234567891,
 *       "end_time": 1681234567900,
 *       "duration_ms": 9,
 *       "input": { ... },
 *       "output": { ... },
 *       "next_step": "step_2_email",
 *       "slow_step": false
 *     },
 *     ...
 *   ]
 * }
 */
router.get('/admin/workflows/:execution_id/timeline', (req: Request, res: Response) => {
  const { execution_id } = req.params;

  // Validate execution_id format
  if (!execution_id || !execution_id.startsWith('exec_')) {
    return badRequest(res, 'Invalid execution_id format');
  }

  // Retrieve timeline
  const timeline = workflowTimelineStore.getTimeline(execution_id);

  if (!timeline) {
    return notFound(res, `Timeline not found for execution_id: ${execution_id}`);
  }

  // Return timeline with steps sorted by start_time
  const sortedSteps = [...timeline.steps].sort((a, b) => a.start_time - b.start_time);

  return ok(res, {
    execution_id: timeline.execution_id,
    workflow_id: timeline.workflow_id,
    phone: timeline.phone,
    profile_id: timeline.profile_id,
    started_at: timeline.started_at,
    completed_at: timeline.completed_at,
    steps: sortedSteps
  });
});

/**
 * GET /admin/workflows/:execution_id/timeline/summary
 * Retrieve a summary of the execution timeline with performance metrics.
 *
 * Returns:
 * {
 *   "execution_id": "exec_1234567890_abc123",
 *   "workflow_id": "booking_basic",
 *   "total_duration_ms": 12109,
 *   "step_count": 3,
 *   "slow_steps": [
 *     { "step_name": "step_2_email", "duration_ms": 8234 }
 *   ],
 *   "average_step_duration_ms": 4036,
 *   "max_step_duration_ms": 8234
 * }
 */
router.get('/admin/workflows/:execution_id/timeline/summary', (req: Request, res: Response) => {
  const { execution_id } = req.params;

  // Validate execution_id format
  if (!execution_id || !execution_id.startsWith('exec_')) {
    return badRequest(res, 'Invalid execution_id format');
  }

  // Retrieve timeline
  const timeline = workflowTimelineStore.getTimeline(execution_id);

  if (!timeline) {
    return notFound(res, `Timeline not found for execution_id: ${execution_id}`);
  }

  // Calculate summary metrics
  const totalDurationMs = timeline.completed_at
    ? timeline.completed_at - timeline.started_at
    : Date.now() - timeline.started_at;

  const slowSteps = timeline.steps
    .filter(step => step.slow_step)
    .map(step => ({
      step_name: step.step_name,
      duration_ms: step.duration_ms
    }));

  const totalStepDuration = timeline.steps.reduce((sum, step) => sum + step.duration_ms, 0);
  const averageStepDuration = timeline.steps.length > 0 ? totalStepDuration / timeline.steps.length : 0;
  const maxStepDuration = timeline.steps.length > 0
    ? Math.max(...timeline.steps.map(step => step.duration_ms))
    : 0;

  return ok(res, {
    execution_id: timeline.execution_id,
    workflow_id: timeline.workflow_id,
    phone: timeline.phone,
    profile_id: timeline.profile_id,
    total_duration_ms: totalDurationMs,
    step_count: timeline.steps.length,
    slow_steps: slowSteps,
    average_step_duration_ms: Math.round(averageStepDuration),
    max_step_duration_ms: maxStepDuration,
    is_complete: !!timeline.completed_at
  });
});

export default router;
