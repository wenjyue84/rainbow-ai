/**
 * Confidence Percentile Calculator — Core analytics module
 *
 * Calculates p50, p95, p99 percentiles from confidence distributions
 * Used by intent accuracy analytics and CLI commands.
 */

/**
 * Calculate percentile from sorted array
 * @param values Sorted array of numbers (ascending)
 * @param percentile Target percentile (0-100)
 * @returns The percentile value
 */
export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  // Handle edge cases
  if (percentile <= 0) return values[0];
  if (percentile >= 100) return values[values.length - 1];

  // Linear interpolation method (common for percentile calculation)
  const index = (percentile / 100) * (values.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;

  if (lower === upper) {
    return values[lower];
  }

  return values[lower] * (1 - weight) + values[upper] * weight;
}

/**
 * Calculate p50, p95, p99 percentiles from confidence values
 * @param confidences Array of confidence values (0-1)
 * @returns Object with {p50, p95, p99, sampleCount, min, max, mean}
 */
export function calculateConfidencePercentiles(confidences: number[]) {
  if (!confidences || confidences.length === 0) {
    return {
      p50: 0,
      p95: 0,
      p99: 0,
      sampleCount: 0,
      min: 0,
      max: 0,
      mean: 0,
    };
  }

  // Sort in ascending order for percentile calculation
  const sorted = [...confidences].sort((a, b) => a - b);

  return {
    p50: calculatePercentile(sorted, 50),
    p95: calculatePercentile(sorted, 95),
    p99: calculatePercentile(sorted, 99),
    sampleCount: confidences.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: confidences.reduce((a, b) => a + b, 0) / confidences.length,
  };
}

/**
 * Group confidence values by intent type
 * @param predictions Array of intent predictions with confidence and intent type
 * @returns Map of intent -> confidences array
 */
export function groupConfidencesByIntent(
  predictions: Array<{ intentType: string; confidence: number }>
) {
  const grouped = new Map<string, number[]>();

  for (const pred of predictions) {
    if (!grouped.has(pred.intentType)) {
      grouped.set(pred.intentType, []);
    }
    grouped.get(pred.intentType)!.push(pred.confidence);
  }

  return grouped;
}

/**
 * Generate distribution report for all intents
 * @param predictions Array of predictions
 * @returns Map of intent -> percentile stats
 */
export function generateDistributionReport(
  predictions: Array<{ intentType: string; confidence: number }>
) {
  const grouped = groupConfidencesByIntent(predictions);
  const report = new Map<string, ReturnType<typeof calculateConfidencePercentiles>>();

  for (const [intent, confidences] of grouped) {
    report.set(intent, calculateConfidencePercentiles(confidences));
  }

  return report;
}
