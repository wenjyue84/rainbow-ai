/**
 * latency-slo-tracker.ts — Per-provider latency SLO tracking with automatic demotion (US-996)
 *
 * Maintains a rolling window of response latencies per provider.
 * When P95 exceeds a configurable threshold, the provider is demoted below all healthy providers.
 * Provider is restored once P95 drops below threshold for a recovery window of consecutive calls.
 */

// ─── Configuration ──────────────────────────────────────────────────

export interface LatencySLOConfig {
  /** Number of recent calls to keep in the rolling window (default: 20) */
  windowSize: number;
  /** P95 threshold in ms — provider is demoted when exceeded (default: 3000) */
  slowThresholdMs: number;
  /** Number of consecutive fast calls needed to restore priority (default: 5) */
  recoveryWindow: number;
}

const DEFAULT_CONFIG: LatencySLOConfig = {
  windowSize: 20,
  slowThresholdMs: 3000,
  recoveryWindow: 5,
};

// ─── Per-Provider State ─────────────────────────────────────────────

interface ProviderLatencyState {
  /** Rolling window of recent latencies (ms) */
  latencies: number[];
  /** Whether provider is currently demoted */
  demoted: boolean;
  /** Count of consecutive fast calls while demoted (for recovery) */
  consecutiveFastCalls: number;
  /** Timestamp of last demotion */
  demotedAt: number | null;
  /** Current P95 value (cached) */
  currentP95: number | null;
}

// ─── Tracker Class ──────────────────────────────────────────────────

export class LatencySLOTracker {
  private states = new Map<string, ProviderLatencyState>();
  private config: LatencySLOConfig;

  constructor(config?: Partial<LatencySLOConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Get or initialize state for a provider */
  private getState(providerId: string): ProviderLatencyState {
    let state = this.states.get(providerId);
    if (!state) {
      state = {
        latencies: [],
        demoted: false,
        consecutiveFastCalls: 0,
        demotedAt: null,
        currentP95: null,
      };
      this.states.set(providerId, state);
    }
    return state;
  }

  /**
   * Record a successful call's latency for a provider.
   * Evaluates demotion/recovery after recording.
   */
  recordLatency(providerId: string, latencyMs: number): void {
    const state = this.getState(providerId);

    // Add to rolling window, evict oldest if full
    state.latencies.push(latencyMs);
    if (state.latencies.length > this.config.windowSize) {
      state.latencies.shift();
    }

    // Recalculate P95
    state.currentP95 = this.calculateP95(state.latencies);

    // Evaluate demotion or recovery
    if (!state.demoted) {
      // Check if provider should be demoted
      if (state.latencies.length >= 3 && state.currentP95 > this.config.slowThresholdMs) {
        state.demoted = true;
        state.demotedAt = Date.now();
        state.consecutiveFastCalls = 0;
        console.log(
          `[LatencySLO] Provider "${providerId}" DEMOTED — P95=${state.currentP95.toFixed(0)}ms exceeds ${this.config.slowThresholdMs}ms threshold`
        );
      }
    } else {
      // Check if provider should recover
      if (latencyMs < this.config.slowThresholdMs) {
        state.consecutiveFastCalls++;
        if (state.consecutiveFastCalls >= this.config.recoveryWindow) {
          state.demoted = false;
          state.demotedAt = null;
          state.consecutiveFastCalls = 0;
          console.log(
            `[LatencySLO] Provider "${providerId}" RESTORED — ${this.config.recoveryWindow} consecutive fast calls (P95=${state.currentP95.toFixed(0)}ms)`
          );
        }
      } else {
        // Slow call resets recovery counter
        state.consecutiveFastCalls = 0;
      }
    }
  }

  /** Check if a provider is currently demoted */
  isDemoted(providerId: string): boolean {
    return this.getState(providerId).demoted;
  }

  /** Get the current P95 for a provider (null if no data) */
  getP95(providerId: string): number | null {
    return this.getState(providerId).currentP95;
  }

  /**
   * Get status for all tracked providers (for admin dashboard).
   */
  getAllStatuses(): Record<string, {
    demoted: boolean;
    p95Ms: number | null;
    sampleCount: number;
    consecutiveFastCalls: number;
    demotedAt: number | null;
    thresholdMs: number;
  }> {
    const result: Record<string, any> = {};
    for (const [id, state] of this.states.entries()) {
      result[id] = {
        demoted: state.demoted,
        p95Ms: state.currentP95,
        sampleCount: state.latencies.length,
        consecutiveFastCalls: state.consecutiveFastCalls,
        demotedAt: state.demotedAt,
        thresholdMs: this.config.slowThresholdMs,
      };
    }
    return result;
  }

  /** Get status for a single provider */
  getStatus(providerId: string): {
    demoted: boolean;
    p95Ms: number | null;
    sampleCount: number;
    consecutiveFastCalls: number;
    demotedAt: number | null;
    thresholdMs: number;
  } {
    const state = this.getState(providerId);
    return {
      demoted: state.demoted,
      p95Ms: state.currentP95,
      sampleCount: state.latencies.length,
      consecutiveFastCalls: state.consecutiveFastCalls,
      demotedAt: state.demotedAt,
      thresholdMs: this.config.slowThresholdMs,
    };
  }

  /** Get current config */
  getConfig(): LatencySLOConfig {
    return { ...this.config };
  }

  /** Update config at runtime */
  updateConfig(partial: Partial<LatencySLOConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /** Reset a single provider's tracking state */
  reset(providerId: string): void {
    this.states.delete(providerId);
  }

  /** Reset all providers */
  resetAll(): void {
    this.states.clear();
  }

  // ─── Internal Helpers ───────────────────────────────────────────────

  /** Calculate P95 of a sorted-copy of the latencies array */
  private calculateP95(latencies: number[]): number {
    if (latencies.length === 0) return 0;
    const sorted = [...latencies].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.max(0, index)];
  }
}

// ─── Singleton Instance ─────────────────────────────────────────────

export const latencySLOTracker = new LatencySLOTracker();
