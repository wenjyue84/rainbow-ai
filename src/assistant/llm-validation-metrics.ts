/**
 * llm-validation-metrics.ts — Track LLM response validation success/failure rates
 *
 * US-933: Schema-check structured AI responses before downstream use.
 * Records validation events (success, failure, recovery) per context
 * for the analytics pipeline. Target: < 1% validation error rate.
 */

export interface ValidationEvent {
  context: string;        // e.g. 'classifyIntent', 'classifyAndRespond', 'cart_add_item'
  success: boolean;       // true = passed Zod schema, false = failed
  recovered: boolean;     // true = partial recovery succeeded after schema failure
  timestamp: number;
  errorSummary?: string;  // brief description of what failed (path + message)
}

interface ContextMetrics {
  totalCalls: number;
  schemaPass: number;
  schemaFail: number;
  recovered: number;      // failed schema but recovered via partial parsing
}

const MAX_RECENT_EVENTS = 500;

// In-memory rolling window of recent validation events
const recentEvents: ValidationEvent[] = [];

// Per-context aggregate counters (never reset — monotonic)
const contextCounters = new Map<string, ContextMetrics>();

function getOrCreateCounters(context: string): ContextMetrics {
  let c = contextCounters.get(context);
  if (!c) {
    c = { totalCalls: 0, schemaPass: 0, schemaFail: 0, recovered: 0 };
    contextCounters.set(context, c);
  }
  return c;
}

/** Record a validation event. Called from safeParseLLMResponse and recovery paths. */
export function recordValidationEvent(
  context: string,
  success: boolean,
  recovered: boolean = false,
  errorSummary?: string
): void {
  const event: ValidationEvent = {
    context,
    success,
    recovered,
    timestamp: Date.now(),
    errorSummary: errorSummary?.slice(0, 200),
  };

  // Rolling window
  recentEvents.push(event);
  if (recentEvents.length > MAX_RECENT_EVENTS) {
    recentEvents.shift();
  }

  // Update counters
  const c = getOrCreateCounters(context);
  c.totalCalls++;
  if (success) {
    c.schemaPass++;
  } else {
    c.schemaFail++;
    if (recovered) c.recovered++;
  }
}

/** Get aggregate metrics for all contexts. */
export function getValidationMetrics(): {
  overall: { totalCalls: number; schemaPass: number; schemaFail: number; recovered: number; errorRate: number };
  byContext: Record<string, ContextMetrics & { errorRate: number }>;
  recentFailures: ValidationEvent[];
} {
  let totalCalls = 0, schemaPass = 0, schemaFail = 0, recovered = 0;
  const byContext: Record<string, ContextMetrics & { errorRate: number }> = {};

  for (const [ctx, c] of contextCounters) {
    totalCalls += c.totalCalls;
    schemaPass += c.schemaPass;
    schemaFail += c.schemaFail;
    recovered += c.recovered;
    byContext[ctx] = {
      ...c,
      errorRate: c.totalCalls > 0 ? c.schemaFail / c.totalCalls : 0,
    };
  }

  const errorRate = totalCalls > 0 ? schemaFail / totalCalls : 0;

  // Recent failures only (last 50)
  const recentFailures = recentEvents
    .filter(e => !e.success)
    .slice(-50);

  return {
    overall: { totalCalls, schemaPass, schemaFail, recovered, errorRate },
    byContext,
    recentFailures,
  };
}

/** Reset all counters — used for testing. */
export function resetValidationMetrics(): void {
  recentEvents.length = 0;
  contextCounters.clear();
}
