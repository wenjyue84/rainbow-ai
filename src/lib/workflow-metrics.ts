/**
 * US-569: Booking Workflow Step Completion Rate Tracking
 * US-623: Booking Workflow Step Duration SLA Monitoring with Batch Writes
 *
 * Tracks completion rates for booking workflow steps (date_selection, guest_info, confirmation)
 * per profile to identify dropoff points and measure workflow success.
 * Also tracks step execution durations, SLA violations, and aggregates metrics for admin API.
 */

import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('WorkflowMetrics');

// --- Types ----

export interface StepMetrics {
  step_started: number;
  step_completed: number;
  completion_rate: number;
}

export interface DurationMetrics {
  name: string;
  avgDuration_ms: number;
  p95Duration_ms: number;
  slaViolations: number;
  totalSamples: number;
  trend: 'improving' | 'degrading' | 'stable';
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

// US-623: Duration metrics storage
interface DurationSample {
  profile: string;
  step: string;
  durationMs: number;
  timestamp: number;
}

interface StepDurationStats {
  durations: number[];
  samples: number;
  violations: number;
  lastBatchedAt: number;
}

const durationMetrics: Map<string, Map<string, StepDurationStats>> = new Map([
  ['pelangi', new Map([
    ['date_selection', { durations: [], samples: 0, violations: 0, lastBatchedAt: Date.now() }],
    ['guest_info', { durations: [], samples: 0, violations: 0, lastBatchedAt: Date.now() }],
    ['confirmation', { durations: [], samples: 0, violations: 0, lastBatchedAt: Date.now() }],
  ])],
  ['southern', new Map([
    ['date_selection', { durations: [], samples: 0, violations: 0, lastBatchedAt: Date.now() }],
    ['guest_info', { durations: [], samples: 0, violations: 0, lastBatchedAt: Date.now() }],
    ['confirmation', { durations: [], samples: 0, violations: 0, lastBatchedAt: Date.now() }],
  ])],
  ['makan', new Map([
    ['date_selection', { durations: [], samples: 0, violations: 0, lastBatchedAt: Date.now() }],
    ['guest_info', { durations: [], samples: 0, violations: 0, lastBatchedAt: Date.now() }],
    ['confirmation', { durations: [], samples: 0, violations: 0, lastBatchedAt: Date.now() }],
  ])],
]);

// SLA thresholds per step (ms)
const SLA_THRESHOLDS: Record<string, number> = {
  date_selection: 30000,  // 30s
  guest_info: 40000,      // 40s
  confirmation: 25000,    // 25s
};

const COMPLETION_RATE_WARNING_THRESHOLD = 70;
const BATCH_WRITE_THRESHOLD = 300;  // Write when 300 samples collected
const BATCH_WRITE_INTERVAL_MS = 60000;  // Or every 60 seconds

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

// --- US-623: Duration Tracking & Metrics ---

/**
 * Records a step execution duration for SLA monitoring.
 * Tracks violations and maintains rolling duration samples.
 */
export function recordStepDuration(profile: string, step: string, durationMs: number): void {
  const normalized = normalizeProfileName(profile);

  // Ensure profile and step exist
  if (!durationMetrics.has(normalized)) {
    durationMetrics.set(normalized, new Map());
  }

  const profileMetrics = durationMetrics.get(normalized)!;
  if (!profileMetrics.has(step)) {
    profileMetrics.set(step, {
      durations: [],
      samples: 0,
      violations: 0,
      lastBatchedAt: Date.now(),
    });
  }

  const stats = profileMetrics.get(step)!;
  stats.durations.push(durationMs);
  stats.samples++;

  // Check SLA violation
  const threshold = SLA_THRESHOLDS[step] || 30000;
  if (durationMs > threshold) {
    stats.violations++;
    logger.warn(`SLA violation for ${normalized}/${step}: ${durationMs}ms > ${threshold}ms`);
  }

  // Keep only last 1000 samples in memory for trend calculation
  if (stats.durations.length > 1000) {
    stats.durations.shift();
  }

  logger.debug(`Recorded step duration: ${normalized}/${step} = ${durationMs}ms (samples: ${stats.samples})`);
}

/**
 * Calculate P95 (95th percentile) of duration samples.
 */
function calculateP95(durations: number[]): number {
  if (durations.length === 0) return 0;
  if (durations.length === 1) return durations[0];

  const sorted = [...durations].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Calculate trend by comparing recent samples vs older samples.
 * Returns 'improving', 'degrading', or 'stable'.
 */
function calculateTrend(durations: number[]): 'improving' | 'degrading' | 'stable' {
  if (durations.length < 20) return 'stable';

  const mid = Math.floor(durations.length / 2);
  const olderHalf = durations.slice(0, mid);
  const recentHalf = durations.slice(mid);

  const olderAvg = olderHalf.reduce((a, b) => a + b, 0) / olderHalf.length;
  const recentAvg = recentHalf.reduce((a, b) => a + b, 0) / recentHalf.length;

  const percentChange = ((recentAvg - olderAvg) / olderAvg) * 100;

  if (percentChange < -10) return 'improving';
  if (percentChange > 10) return 'degrading';
  return 'stable';
}

/**
 * Get aggregated metrics for a specific profile (US-623 admin endpoint).
 * Returns array of step metrics including duration statistics and trend.
 */
export async function getProfileMetrics(profile: string): Promise<DurationMetrics[]> {
  const normalized = normalizeProfileName(profile);

  if (!durationMetrics.has(normalized)) {
    return [];
  }

  const profileMetrics = durationMetrics.get(normalized)!;
  const result: DurationMetrics[] = [];

  for (const [stepName, stats] of profileMetrics) {
    if (stats.samples === 0) {
      result.push({
        name: stepName,
        avgDuration_ms: 0,
        p95Duration_ms: 0,
        slaViolations: 0,
        totalSamples: 0,
        trend: 'stable',
      });
      continue;
    }

    const avgDuration = stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length;
    const p95Duration = calculateP95(stats.durations);
    const trend = calculateTrend(stats.durations);

    result.push({
      name: stepName,
      avgDuration_ms: Math.round(avgDuration),
      p95Duration_ms: Math.round(p95Duration),
      slaViolations: stats.violations,
      totalSamples: stats.samples,
      trend,
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Clear duration metrics (for testing).
 */
export function clearDurationMetrics(): void {
  for (const profileMetrics of durationMetrics.values()) {
    for (const stats of profileMetrics.values()) {
      stats.durations = [];
      stats.samples = 0;
      stats.violations = 0;
      stats.lastBatchedAt = Date.now();
    }
  }
}
