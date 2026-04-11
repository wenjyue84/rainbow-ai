/**
 * US-466: Categorize Booking Confirmation Failures by Root Cause with Remediation Ranking
 *
 * Analyzes booking_step_failed logs from past 24h and categorizes by root cause.
 * Generates priority-ranked remediation actions to reduce booking funnel drop-off.
 */

export type FailureCategory = 'CONFIG' | 'DATA' | 'EXTERNAL' | 'UNKNOWN';

export interface FailureExample {
  timestamp: string;
  errorMessage: string;
  remediation: string;
}

export interface CategoryAnalysis {
  failure_category: FailureCategory;
  count: number;
  examples: FailureExample[];
  priority_rank: number;
}

export interface FailureAnalysisReport {
  timestamp: string;
  total_failures: number;
  categories: CategoryAnalysis[];
  remediation_summary: string;
}

/**
 * Categorizes an error message into one of: CONFIG, DATA, EXTERNAL, UNKNOWN
 *
 * CONFIG: Missing workflow step definition, missing dependency, invalid configuration
 * DATA: Guest/unit/booking record missing or corrupt, data validation failure
 * EXTERNAL: Third-party API timeout, 5xx errors, external service unavailable
 * UNKNOWN: Other errors
 */
export function categorizeError(errorMessage: string): FailureCategory {
  if (!errorMessage || typeof errorMessage !== 'string') {
    return 'UNKNOWN';
  }

  const msg = errorMessage.toLowerCase();

  // CONFIG patterns: workflow, step, definition, schema, dependency, configuration
  if (
    msg.includes('step') && (msg.includes('not found') || msg.includes('undefined') || msg.includes('missing')) ||
    msg.includes('workflow') && (msg.includes('invalid') || msg.includes('not found')) ||
    msg.includes('schema validation') ||
    msg.includes('required field') ||
    msg.includes('configuration error') ||
    msg.includes('missing dependency') ||
    msg.includes('invalid workflow') ||
    msg.includes('step definition')
  ) {
    return 'CONFIG';
  }

  // DATA patterns: not found, missing, null, corrupt, validation, record, guest, unit, booking
  if (
    msg.includes('not found') && (msg.includes('guest') || msg.includes('unit') || msg.includes('booking') || msg.includes('record')) ||
    msg.includes('missing') && (msg.includes('guest') || msg.includes('unit') || msg.includes('booking')) ||
    msg.includes('no guest') ||
    msg.includes('no unit') ||
    msg.includes('no booking') ||
    msg.includes('corrupt') ||
    msg.includes('data validation') ||
    msg.includes('invalid guest') ||
    msg.includes('invalid unit') ||
    msg.includes('record missing') ||
    msg.includes('null reference')
  ) {
    return 'DATA';
  }

  // EXTERNAL patterns: timeout, 5xx, api, external, service, unavailable, 502, 503, 504
  if (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('5xx') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('gateway') ||
    msg.includes('service unavailable') ||
    msg.includes('connection timeout') ||
    msg.includes('external api') ||
    msg.includes('third-party') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset')
  ) {
    return 'EXTERNAL';
  }

  return 'UNKNOWN';
}

/**
 * Generate a remediation suggestion based on the failure category
 */
export function generateRemediation(category: FailureCategory, stepName: string): string {
  switch (category) {
    case 'CONFIG':
      return `Validate workflows.json step definitions. Ensure step "${stepName}" is properly defined with all required dependencies.`;
    case 'DATA':
      return `Add data existence checks before step "${stepName}". Verify guest/unit/booking records exist and are not corrupt.`;
    case 'EXTERNAL':
      return `Implement retry logic with exponential backoff for external API calls in step "${stepName}". Add circuit breaker pattern.`;
    case 'UNKNOWN':
      return `Review error logs for step "${stepName}" to identify root cause pattern.`;
  }
}

/**
 * Analyze booking execution logs and categorize failures
 */
export function analyzeFailures(
  logs: Array<{ step_name: string; output: unknown; executed_at: string }>
): FailureAnalysisReport {
  const categoryMap = new Map<FailureCategory, {
    count: number;
    examples: FailureExample[];
    steps: Set<string>;
  }>();

  // Initialize all categories
  const categories: FailureCategory[] = ['CONFIG', 'DATA', 'EXTERNAL', 'UNKNOWN'];
  categories.forEach(cat => {
    categoryMap.set(cat, {
      count: 0,
      examples: [],
      steps: new Set(),
    });
  });

  // Process each log entry
  for (const log of logs) {
    const errorMessage = extractErrorMessage(log.output);
    const category = categorizeError(errorMessage);
    const entry = categoryMap.get(category)!;

    entry.count += 1;
    entry.steps.add(log.step_name);

    // Keep only top 3 most recent examples
    if (entry.examples.length < 3) {
      entry.examples.push({
        timestamp: log.executed_at,
        errorMessage: errorMessage.length > 100 ? errorMessage.slice(0, 100) + '...' : errorMessage,
        remediation: generateRemediation(category, log.step_name),
      });
    } else {
      // Replace older examples if we have newer ones
      const oldestIdx = entry.examples.findIndex(ex =>
        new Date(ex.timestamp).getTime() < new Date(log.executed_at).getTime()
      );
      if (oldestIdx !== -1) {
        entry.examples[oldestIdx] = {
          timestamp: log.executed_at,
          errorMessage: errorMessage.length > 100 ? errorMessage.slice(0, 100) + '...' : errorMessage,
          remediation: generateRemediation(category, log.step_name),
        };
      }
    }
  }

  // Convert to array and sort by frequency (count) descending
  const sortedCategories: CategoryAnalysis[] = categories
    .filter(cat => categoryMap.get(cat)!.count > 0)
    .map((cat, idx) => {
      const data = categoryMap.get(cat)!;
      return {
        failure_category: cat,
        count: data.count,
        examples: data.examples,
        priority_rank: idx + 1,
      };
    })
    .sort((a, b) => b.count - a.count)
    .map((cat, idx) => ({
      ...cat,
      priority_rank: idx + 1,
    }));

  // Generate remediation summary
  const remediationLines: string[] = [];
  for (const cat of sortedCategories) {
    const stepList = Array.from(categoryMap.get(cat.failure_category)!.steps).join(', ');
    remediationLines.push(
      `${cat.failure_category} failures: ${cat.count} instances (steps: ${stepList}) - ` +
      `${generateRemediation(cat.failure_category, stepList)}`
    );
  }
  const remediationSummary = remediationLines.join('\n');

  return {
    timestamp: new Date().toISOString(),
    total_failures: logs.length,
    categories: sortedCategories,
    remediation_summary: remediationSummary,
  };
}

/**
 * Extract error message from booking execution output
 */
export function extractErrorMessage(output: unknown): string {
  if (!output || typeof output !== 'object') {
    return 'unknown error';
  }

  const obj = output as Record<string, unknown>;

  // Try common error fields
  if (typeof obj.error === 'string') return obj.error;
  if (typeof obj.error_message === 'string') return obj.error_message;
  if (typeof obj.errorMessage === 'string') return obj.errorMessage;
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.reason === 'string') return obj.reason;
  if (typeof obj.errorCode === 'string') return obj.errorCode;

  // Fallback to JSON string
  return JSON.stringify(obj).slice(0, 100);
}
