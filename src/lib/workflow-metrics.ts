/**
 * US-569: Booking Workflow Step Completion Rate Tracking
 *
 * Tracks completion rates for booking workflow steps (date_selection, guest_info, confirmation)
 * per profile to identify dropoff points and measure workflow success.
 */

import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('WorkflowMetrics');

// --- Types ----

export interface StepMetrics {
  step_started: number;
  step_completed: number;
  completion_rate: number;
}

export interface ProfileWorkflowMetrics {
  date_selection: StepMetrics;
  guest_info: StepMetrics;
  confirmation: StepMetrics;
  [key: string]: StepMetrics;
}

export interface WorkflowCompletionMetrics {
  pelangi?: ProfileWorkflowMetrics;
  southern?: ProfileWorkflowMetrics;
  makan?: ProfileWorkflowMetrics;
  [key: string]: ProfileWorkflowMetrics | undefined;
}

// --- In-Memory Storage ---

const workflowCounters: Map<string, Map<string, { started: number; completed: number }>> = new Map(
  [
    ['pelangi', new Map([
      ['date_selection', { started: 0, completed: 0 }],
      ['guest_info', { started: 0, completed: 0 }],
      ['confirmation', { started: 0, completed: 0 }],
    ])],
    ['southern', new Map([
      ['date_selection', { started: 0, completed: 0 }],
      ['guest_info', { started: 0, completed: 0 }],
      ['confirmation', { started: 0, completed: 0 }],
    ])],
    ['makan', new Map([
      ['date_selection', { started: 0, completed: 0 }],
      ['guest_info', { started: 0, completed: 0 }],
      ['confirmation', { started: 0, completed: 0 }],
    ])],
  ]
);

const COMPLETION_RATE_WARNING_THRESHOLD = 70;

// --- Helper Functions ---

export function normalizeProfileName(profileId: string): string {
  if (!profileId) return 'pelangi';
  const lower = profileId.toLowerCase();
  if (lower.includes('makan')) return 'makan';
  if (lower.includes('southern')) return 'southern';
  if (lower.includes('pelangi')) return 'pelangi';
  return 'pelangi';
}

function ensureProfile(profile: string): void {
  if (!workflowCounters.has(profile)) {
    workflowCounters.set(profile, new Map([
      ['date_selection', { started: 0, completed: 0 }],
      ['guest_info', { started: 0, completed: 0 }],
      ['confirmation', { started: 0, completed: 0 }],
    ]));
  }
}

function ensureStep(profile: string, step: string): void {
  ensureProfile(profile);
  const profileMap = workflowCounters.get(profile)!;
  if (!profileMap.has(step)) {
    profileMap.set(step, { started: 0, completed: 0 });
  }
}

// --- Public API ---

export function incrementStarted(profile: string, step: string): void {
  const normalized = normalizeProfileName(profile);
  ensureStep(normalized, step);

  const profileMap = workflowCounters.get(normalized)!;
  const counters = profileMap.get(step)!;
  counters.started++;

  logger.debug(`Step started: profile=${normalized}, step=${step}, started=${counters.started}`);
}

export function incrementCompleted(profile: string, step: string): void {
  const normalized = normalizeProfileName(profile);
  ensureStep(normalized, step);

  const profileMap = workflowCounters.get(normalized)!;
  const counters = profileMap.get(step)!;
  counters.completed++;

  const completionRate = getCompletionRate(normalized, step);
  logger.debug(
    `Step completed: profile=${normalized}, step=${step}, completed=${counters.completed}, completion_rate=${completionRate.toFixed(1)}%`
  );

  if (completionRate < COMPLETION_RATE_WARNING_THRESHOLD && counters.started >= 10) {
    logger.warn(
      `Low completion rate for ${normalized}/${step}: ${completionRate.toFixed(1)}% (${counters.completed}/${counters.started})`
    );
  }
}

export function getCompletionRate(profile: string, step: string): number {
  const normalized = normalizeProfileName(profile);
  ensureStep(normalized, step);

  const profileMap = workflowCounters.get(normalized)!;
  const counters = profileMap.get(step)!;

  if (counters.started === 0) {
    return 0;
  }

  return (counters.completed / counters.started) * 100;
}

export function getStepMetrics(profile: string, step: string): StepMetrics {
  const normalized = normalizeProfileName(profile);
  ensureStep(normalized, step);

  const profileMap = workflowCounters.get(normalized)!;
  const counters = profileMap.get(step)!;

  return {
    step_started: counters.started,
    step_completed: counters.completed,
    completion_rate: getCompletionRate(normalized, step),
  };
}

export function getAllMetrics(): WorkflowCompletionMetrics {
  const metrics: WorkflowCompletionMetrics = {};

  for (const [profile, profileMap] of workflowCounters) {
    const profileMetrics: ProfileWorkflowMetrics = {} as ProfileWorkflowMetrics;

    for (const [step] of profileMap) {
      profileMetrics[step] = getStepMetrics(profile, step);
    }

    if (Object.values(profileMetrics).some(m => m.step_started > 0)) {
      metrics[profile] = profileMetrics;
    }
  }

  return metrics;
}

export function getCompletionHealthStatus(): { ok: boolean; detail?: string; failingSteps?: string[] } {
  const failingSteps: string[] = [];

  for (const [profile, profileMap] of workflowCounters) {
    for (const [step] of profileMap) {
      const rate = getCompletionRate(profile, step);
      const counters = profileMap.get(step)!;

      if (counters.started >= 10 && rate < COMPLETION_RATE_WARNING_THRESHOLD) {
        failingSteps.push(`${profile}/${step} (${rate.toFixed(1)}%)`);
      }
    }
  }

  if (failingSteps.length > 0) {
    return {
      ok: false,
      detail: `Workflow completion below ${COMPLETION_RATE_WARNING_THRESHOLD}% threshold`,
      failingSteps,
    };
  }

  return {
    ok: true,
    detail: 'All workflow steps above completion threshold',
  };
}

export function clearMetrics(): void {
  for (const profileMap of workflowCounters.values()) {
    for (const counters of profileMap.values()) {
      counters.started = 0;
      counters.completed = 0;
    }
  }
}

export function getCounters(profile: string, step: string) {
  const normalized = normalizeProfileName(profile);
  ensureStep(normalized, step);
  return workflowCounters.get(normalized)!.get(step);
}
