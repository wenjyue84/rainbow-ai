/**
 * Circuit Breaker Pattern for Booking Workflow Steps
 *
 * Prevents cascading failures in booking workflow steps by "opening" the circuit
 * after repeated failures, allowing graceful degradation to manual escalation.
 *
 * States:
 * - CLOSED: Normal operation (step functioning)
 * - OPEN: Circuit broken (step failing, escalate to manual)
 * - HALF_OPEN: Testing recovery (allow 1 request to test if step recovered)
 *
 * Behavior:
 * - 3 consecutive failures → OPEN (for 60 seconds)
 * - OPEN for 60 seconds → HALF_OPEN (allow 1 test request)
 * - 1 success in HALF_OPEN → CLOSED
 * - 1 failure in HALF_OPEN → back to OPEN
 */

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerConfig {
  failureThreshold: number;  // Consecutive failures to open circuit (default: 3)
  cooldownMs: number;        // Time before testing recovery (default: 60000ms = 60s)
  successThreshold: number;  // Successes in HALF_OPEN to close circuit (default: 1)
}

export interface CircuitBreakerStatus {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  cooldownRemaining: number;
  lastStateTransition: string;
}

/**
 * Circuit breaker for a single booking workflow step
 */
export class BookingWorkflowCircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private lastStateTransition: string = new Date().toISOString();
  private config: CircuitBreakerConfig;
  private stepId: string;

  constructor(stepId: string, config?: Partial<CircuitBreakerConfig>) {
    this.stepId = stepId;
    this.config = {
      failureThreshold: config?.failureThreshold ?? 3,
      cooldownMs: config?.cooldownMs ?? 60000, // 60 seconds
      successThreshold: config?.successThreshold ?? 1
    };
    this.logStateTransition(CircuitState.CLOSED, 'Initialized');
  }

  /**
   * Check if circuit is open (should skip step and escalate)
   */
  isOpen(): boolean {
    if (this.state === CircuitState.OPEN) {
      // Check if cooldown period has elapsed
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.cooldownMs) {
        this.transitionTo(CircuitState.HALF_OPEN, `Cooldown elapsed (${elapsed}ms), testing recovery`);
        this.successCount = 0;
        return false; // Allow test request
      }
      return true; // Still in cooldown
    }
    return false;
  }

  /**
   * Record successful step execution
   */
  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED, `Recovery verified (${this.successCount} successes)`);
        this.failureCount = 0;
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Record failed step execution
   */
  recordFailure(): void {
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Failed recovery test → back to OPEN
      this.transitionTo(CircuitState.OPEN, 'Recovery test failed, reopening circuit');
      this.failureCount = this.config.failureThreshold;
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount++;
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo(CircuitState.OPEN, `Failure threshold reached (${this.failureCount} failures)`);
      }
    }
  }

  /**
   * Get current circuit state and stats (for monitoring)
   */
  getStatus(): CircuitBreakerStatus {
    const cooldownRemaining = this.state === CircuitState.OPEN
      ? Math.max(0, this.config.cooldownMs - (Date.now() - this.lastFailureTime))
      : 0;

    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      cooldownRemaining,
      lastStateTransition: this.lastStateTransition
    };
  }

  /**
   * Manually reset circuit (for testing or admin intervention)
   */
  reset(): void {
    this.transitionTo(CircuitState.CLOSED, 'Manual reset');
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }

  /**
   * Log state transition with timestamp and reason
   */
  private transitionTo(newState: CircuitState, reason: string): void {
    if (newState !== this.state) {
      this.logStateTransition(newState, reason);
      this.state = newState;
    }
  }

  /**
   * Log circuit state transitions to debug logs
   */
  private logStateTransition(state: CircuitState, reason: string): void {
    const timestamp = new Date().toISOString();
    this.lastStateTransition = timestamp;
    console.debug(`[CircuitBreaker:${this.stepId}] ${timestamp} -> ${state}: ${reason}`);
  }

  /**
   * Get current state (for testing)
   */
  getCurrentState(): CircuitState {
    return this.state;
  }
}

/**
 * Global registry of circuit breakers for booking workflow steps
 */
class BookingWorkflowCircuitBreakerRegistry {
  private breakers = new Map<string, BookingWorkflowCircuitBreaker>();

  /**
   * Get or create a circuit breaker for a booking step
   */
  getOrCreate(stepId: string, config?: Partial<CircuitBreakerConfig>): BookingWorkflowCircuitBreaker {
    let breaker = this.breakers.get(stepId);
    if (!breaker) {
      breaker = new BookingWorkflowCircuitBreaker(stepId, config);
      this.breakers.set(stepId, breaker);
    }
    return breaker;
  }

  /**
   * Get a circuit breaker by step ID
   */
  get(stepId: string): BookingWorkflowCircuitBreaker | undefined {
    return this.breakers.get(stepId);
  }

  /**
   * Reset a specific circuit breaker
   */
  reset(stepId: string): void {
    this.breakers.get(stepId)?.reset();
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Get status of all circuit breakers
   */
  getAllStatuses(): Record<string, CircuitBreakerStatus> {
    const statuses: Record<string, CircuitBreakerStatus> = {};
    for (const [stepId, breaker] of this.breakers.entries()) {
      statuses[stepId] = breaker.getStatus();
    }
    return statuses;
  }
}

export const bookingWorkflowCircuitBreakerRegistry = new BookingWorkflowCircuitBreakerRegistry();
