/**
 * US-121: Workflow Performance Profiler
 *
 * Collects step-level execution metrics (duration, input/output sizes, state snapshots)
 * and provides aggregated analytics for debugging workflow bottlenecks.
 */

export interface StepMetric {
  stepId: string;
  stepType: string;
  durationMs: number;
  inputSize: number;
  outputSize: number;
  stateSnapshot: Record<string, any>;
  timestamp: number;
  workflowId: string;
  conversationId?: string;
}

export interface AggregatedMetrics {
  stepId: string;
  stepType: string;
  count: number;
  avgDurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  avgInputSize: number;
  avgOutputSize: number;
  totalSlowExecutions: number; // > 2000ms
}

interface StepStorage {
  [stepId: string]: StepMetric[];
}

// In-memory storage for profiling data (per workflow instance)
const stepMetrics: StepStorage = {};
const MAX_METRICS_PER_STEP = 1000; // Keep last 1000 executions per step

/**
 * Record a single step execution metric
 */
export function recordStepMetric(metric: StepMetric): void {
  if (!stepMetrics[metric.stepId]) {
    stepMetrics[metric.stepId] = [];
  }

  stepMetrics[metric.stepId].push(metric);

  // Keep only last N metrics to prevent memory overflow
  if (stepMetrics[metric.stepId].length > MAX_METRICS_PER_STEP) {
    stepMetrics[metric.stepId] = stepMetrics[metric.stepId].slice(-MAX_METRICS_PER_STEP);
  }
}

/**
 * Calculate percentile from sorted array
 */
function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Get aggregated metrics for all steps
 */
export function getAggregatedMetrics(): AggregatedMetrics[] {
  const result: AggregatedMetrics[] = [];

  for (const [stepId, metrics] of Object.entries(stepMetrics)) {
    if (metrics.length === 0) continue;

    const durations = metrics.map(m => m.durationMs);
    const inputSizes = metrics.map(m => m.inputSize);
    const outputSizes = metrics.map(m => m.outputSize);

    const slowCount = metrics.filter(m => m.durationMs > 2000).length;

    result.push({
      stepId,
      stepType: metrics[0].stepType,
      count: metrics.length,
      avgDurationMs: durations.reduce((a, b) => a + b, 0) / durations.length,
      p95DurationMs: calculatePercentile(durations, 95),
      p99DurationMs: calculatePercentile(durations, 99),
      minDurationMs: Math.min(...durations),
      maxDurationMs: Math.max(...durations),
      avgInputSize: inputSizes.reduce((a, b) => a + b, 0) / inputSizes.length,
      avgOutputSize: outputSizes.reduce((a, b) => a + b, 0) / outputSizes.length,
      totalSlowExecutions: slowCount,
    });
  }

  return result.sort((a, b) => b.avgDurationMs - a.avgDurationMs);
}

/**
 * Get metrics for a specific workflow
 */
export function getWorkflowMetrics(workflowId: string): AggregatedMetrics[] {
  const result: AggregatedMetrics[] = [];

  for (const [stepId, metrics] of Object.entries(stepMetrics)) {
    const filtered = metrics.filter(m => m.workflowId === workflowId);
    if (filtered.length === 0) continue;

    const durations = filtered.map(m => m.durationMs);
    const inputSizes = filtered.map(m => m.inputSize);
    const outputSizes = filtered.map(m => m.outputSize);

    const slowCount = filtered.filter(m => m.durationMs > 2000).length;

    result.push({
      stepId,
      stepType: filtered[0].stepType,
      count: filtered.length,
      avgDurationMs: durations.reduce((a, b) => a + b, 0) / durations.length,
      p95DurationMs: calculatePercentile(durations, 95),
      p99DurationMs: calculatePercentile(durations, 99),
      minDurationMs: Math.min(...durations),
      maxDurationMs: Math.max(...durations),
      avgInputSize: inputSizes.reduce((a, b) => a + b, 0) / inputSizes.length,
      avgOutputSize: outputSizes.reduce((a, b) => a + b, 0) / outputSizes.length,
      totalSlowExecutions: slowCount,
    });
  }

  return result.sort((a, b) => b.avgDurationMs - a.avgDurationMs);
}

/**
 * Generate a timing heatmap and optimization suggestions
 */
export function generateOptimizationReport(): {
  heatmap: Array<{ stepId: string; avgDurationMs: number; bottleneckRank: number }>;
  suggestions: Array<{ stepId: string; reason: string; estimatedGain: string }>;
} {
  const metrics = getAggregatedMetrics();
  const totalTime = metrics.reduce((sum, m) => sum + m.avgDurationMs, 0);

  const heatmap = metrics.map((m, i) => ({
    stepId: m.stepId,
    avgDurationMs: m.avgDurationMs,
    bottleneckRank: i + 1,
    percentOfTotal: totalTime > 0 ? ((m.avgDurationMs / totalTime) * 100).toFixed(2) : '0.00',
  }));

  // Generate suggestions based on metrics
  const suggestions: Array<{ stepId: string; reason: string; estimatedGain: string }> = [];

  metrics.forEach(m => {
    if (m.avgDurationMs > 2000) {
      suggestions.push({
        stepId: m.stepId,
        reason: `Step exceeds 2000ms threshold (${m.avgDurationMs.toFixed(0)}ms)`,
        estimatedGain: `${Math.round((m.avgDurationMs - 2000) * (m.count || 1))}ms if reduced to 2000ms`,
      });
    }

    if (m.totalSlowExecutions > m.count * 0.3) {
      suggestions.push({
        stepId: m.stepId,
        reason: `${m.totalSlowExecutions}/${m.count} executions slow (>2000ms, ${((m.totalSlowExecutions / m.count) * 100).toFixed(0)}%)`,
        estimatedGain: `Optimize to reduce p99 latency from ${m.p99DurationMs.toFixed(0)}ms`,
      });
    }
  });

  return { heatmap: heatmap.slice(0, 10), suggestions };
}

/**
 * Clear all profiling data
 */
export function clearMetrics(): void {
  Object.keys(stepMetrics).forEach(key => delete stepMetrics[key]);
}

/**
 * Get metrics for a specific conversation
 */
export function getConversationMetrics(conversationId: string): StepMetric[] {
  const result: StepMetric[] = [];

  for (const metrics of Object.values(stepMetrics)) {
    result.push(...metrics.filter(m => m.conversationId === conversationId));
  }

  return result.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Get recent step metrics (last N minutes)
 */
export function getRecentMetrics(minutesAgo: number = 60): AggregatedMetrics[] {
  const now = Date.now();
  const cutoff = now - minutesAgo * 60 * 1000;

  const filtered: StepStorage = {};

  for (const [stepId, metrics] of Object.entries(stepMetrics)) {
    const recentMetrics = metrics.filter(m => m.timestamp > cutoff);
    if (recentMetrics.length > 0) {
      filtered[stepId] = recentMetrics;
    }
  }

  const result: AggregatedMetrics[] = [];

  for (const [stepId, metrics] of Object.entries(filtered)) {
    if (metrics.length === 0) continue;

    const durations = metrics.map(m => m.durationMs);
    const inputSizes = metrics.map(m => m.inputSize);
    const outputSizes = metrics.map(m => m.outputSize);

    const slowCount = metrics.filter(m => m.durationMs > 2000).length;

    result.push({
      stepId,
      stepType: metrics[0].stepType,
      count: metrics.length,
      avgDurationMs: durations.reduce((a, b) => a + b, 0) / durations.length,
      p95DurationMs: calculatePercentile(durations, 95),
      p99DurationMs: calculatePercentile(durations, 99),
      minDurationMs: Math.min(...durations),
      maxDurationMs: Math.max(...durations),
      avgInputSize: inputSizes.reduce((a, b) => a + b, 0) / inputSizes.length,
      avgOutputSize: outputSizes.reduce((a, b) => a + b, 0) / outputSizes.length,
      totalSlowExecutions: slowCount,
    });
  }

  return result.sort((a, b) => b.avgDurationMs - a.avgDurationMs);
}
