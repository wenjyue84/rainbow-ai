/**
 * Tests for Booking Workflow Circuit Breaker (US-608)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BookingWorkflowCircuitBreaker,
  CircuitState,
  bookingWorkflowCircuitBreakerRegistry,
  type CircuitBreakerStatus
} from '../src/workflows/circuit-breaker.js';

describe('BookingWorkflowCircuitBreaker', () => {
  let breaker: BookingWorkflowCircuitBreaker;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    breaker = new BookingWorkflowCircuitBreaker('test-step-1', {
      failureThreshold: 3,
      cooldownMs: 60000,
      successThreshold: 1
    });
  });

  describe('AC1: Circuit opens after 3 consecutive failures and blocks requests for 60 seconds', () => {
    it('should remain CLOSED after 0 failures', () => {
      const status = breaker.getStatus();
      expect(status.state).toBe(CircuitState.CLOSED);
      expect(status.failureCount).toBe(0);
    });

    it('should remain CLOSED after 1 failure', () => {
      breaker.recordFailure();
      const status = breaker.getStatus();
      expect(status.state).toBe(CircuitState.CLOSED);
      expect(status.failureCount).toBe(1);
      expect(breaker.isOpen()).toBe(false);
    });

    it('should remain CLOSED after 2 failures', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      const status = breaker.getStatus();
      expect(status.state).toBe(CircuitState.CLOSED);
      expect(status.failureCount).toBe(2);
      expect(breaker.isOpen()).toBe(false);
    });

    it('should OPEN after exactly 3 failures', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      const status = breaker.getStatus();
      expect(status.state).toBe(CircuitState.OPEN);
      expect(status.failureCount).toBe(3);
      expect(breaker.isOpen()).toBe(true);
    });

    it('should block requests (isOpen returns true) when circuit is OPEN', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(true);
    });

    it('should continue blocking during 60-second cooldown period', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(true);

      // Advance time by 30 seconds (less than cooldown)
      vi.useFakeTimers();
      const startTime = Date.now();
      vi.setSystemTime(startTime + 30000);

      expect(breaker.isOpen()).toBe(true);
      const status = breaker.getStatus();
      expect(status.cooldownRemaining).toBeGreaterThan(0);
      expect(status.cooldownRemaining).toBeLessThanOrEqual(30000);

      vi.useRealTimers();
    });

    it('should transition to HALF_OPEN after 60 seconds', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(true);

      // Advance time by 60+ seconds
      vi.useFakeTimers();
      const startTime = Date.now();
      vi.setSystemTime(startTime + 61000);

      // isOpen() returns false when transitioning to HALF_OPEN
      expect(breaker.isOpen()).toBe(false);
      const status = breaker.getStatus();
      expect(status.state).toBe(CircuitState.HALF_OPEN);
      expect(status.cooldownRemaining).toBe(0);

      vi.useRealTimers();
    });
  });

  describe('AC2: Log circuit state transitions (CLOSED -> OPEN -> HALF_OPEN) with timestamp and failure count', () => {
    it('should include timestamp in lastStateTransition', () => {
      const initialStatus = breaker.getStatus();
      expect(initialStatus.lastStateTransition).toBeTruthy();
      expect(new Date(initialStatus.lastStateTransition)).toBeInstanceOf(Date);
    });

    it('should update lastStateTransition when state changes to OPEN', () => {
      const initialStatus = breaker.getStatus();
      const initialTimestamp = initialStatus.lastStateTransition;

      // Wait a bit and trigger state change
      vi.useFakeTimers();
      const startTime = Date.now();
      vi.setSystemTime(startTime + 100);

      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      const openStatus = breaker.getStatus();
      expect(openStatus.lastStateTransition).not.toBe(initialTimestamp);
      expect(new Date(openStatus.lastStateTransition).getTime()).toBeGreaterThan(
        new Date(initialTimestamp).getTime()
      );

      vi.useRealTimers();
    });

    it('should log debug messages on state transitions', () => {
      const consoleSpy = vi.spyOn(console, 'debug');

      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      // Check that debug was called for OPEN transition
      const debugCalls = consoleSpy.mock.calls.filter(call =>
        call[0]?.includes('CircuitBreaker:test-step-1')
      );
      expect(debugCalls.length).toBeGreaterThan(0);
      expect(debugCalls[debugCalls.length - 1][0]).toContain(CircuitState.OPEN);
      expect(debugCalls[debugCalls.length - 1][0]).toContain('threshold');

      consoleSpy.mockRestore();
    });

    it('should track failure count in status during transitions', () => {
      breaker.recordFailure();
      expect(breaker.getStatus().failureCount).toBe(1);

      breaker.recordFailure();
      expect(breaker.getStatus().failureCount).toBe(2);

      breaker.recordFailure();
      const status = breaker.getStatus();
      expect(status.failureCount).toBe(3);
      expect(status.state).toBe(CircuitState.OPEN);
    });
  });

  describe('AC3: Manual escalation when circuit is OPEN', () => {
    // Note: Full escalation integration tested in booking-executor.test.ts
    // Here we test the circuit breaker state transitions needed for escalation

    it('should transition from OPEN to HALF_OPEN after cooldown', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getStatus().state).toBe(CircuitState.OPEN);

      vi.useFakeTimers();
      const startTime = Date.now();
      vi.setSystemTime(startTime + 61000);

      breaker.isOpen(); // Triggers transition check
      expect(breaker.getStatus().state).toBe(CircuitState.HALF_OPEN);

      vi.useRealTimers();
    });

    it('should close circuit after successful request in HALF_OPEN state', () => {
      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      // Advance past cooldown
      vi.useFakeTimers();
      const startTime = Date.now();
      vi.setSystemTime(startTime + 61000);
      breaker.isOpen();
      vi.useRealTimers();

      // Record success in HALF_OPEN
      breaker.recordSuccess();
      const status = breaker.getStatus();
      expect(status.state).toBe(CircuitState.CLOSED);
      expect(status.failureCount).toBe(0);
    });

    it('should reopen circuit if request fails in HALF_OPEN state', () => {
      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      // Advance past cooldown
      vi.useFakeTimers();
      const startTime = Date.now();
      vi.setSystemTime(startTime + 61000);
      breaker.isOpen();
      vi.useRealTimers();

      // Record failure in HALF_OPEN
      breaker.recordFailure();
      const status = breaker.getStatus();
      expect(status.state).toBe(CircuitState.OPEN);
      expect(status.failureCount).toBe(3);
    });
  });

  describe('Circuit breaker reset', () => {
    it('should reset circuit to CLOSED state', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getStatus().state).toBe(CircuitState.OPEN);

      breaker.reset();
      const status = breaker.getStatus();
      expect(status.state).toBe(CircuitState.CLOSED);
      expect(status.failureCount).toBe(0);
      expect(status.successCount).toBe(0);
    });

    it('should clear failure and success counters on reset', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getStatus().failureCount).toBe(2);

      breaker.reset();
      const status = breaker.getStatus();
      expect(status.failureCount).toBe(0);
      expect(status.successCount).toBe(0);
    });
  });

  describe('Success resets failure counter in CLOSED state', () => {
    it('should reset failure count to 0 on success in CLOSED state', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getStatus().failureCount).toBe(2);

      breaker.recordSuccess();
      expect(breaker.getStatus().failureCount).toBe(0);
    });
  });
});

describe('BookingWorkflowCircuitBreakerRegistry', () => {
  beforeEach(() => {
    bookingWorkflowCircuitBreakerRegistry.resetAll();
  });

  describe('getOrCreate', () => {
    it('should create a new circuit breaker on first access', () => {
      const breaker = bookingWorkflowCircuitBreakerRegistry.getOrCreate('payment-check');
      expect(breaker).toBeDefined();
      expect(breaker.getStatus().state).toBe(CircuitState.CLOSED);
    });

    it('should return the same instance on subsequent access', () => {
      const breaker1 = bookingWorkflowCircuitBreakerRegistry.getOrCreate('availability-check');
      const breaker2 = bookingWorkflowCircuitBreakerRegistry.getOrCreate('availability-check');
      expect(breaker1).toBe(breaker2);
    });

    it('should create separate breakers for different step IDs', () => {
      const breaker1 = bookingWorkflowCircuitBreakerRegistry.getOrCreate('step-1');
      const breaker2 = bookingWorkflowCircuitBreakerRegistry.getOrCreate('step-2');
      expect(breaker1).not.toBe(breaker2);
    });

    it('should accept custom config', () => {
      const breaker = bookingWorkflowCircuitBreakerRegistry.getOrCreate('custom-step', {
        failureThreshold: 5,
        cooldownMs: 120000
      });

      // Record 4 failures (should not open with threshold 5)
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getStatus().state).toBe(CircuitState.CLOSED);

      // 5th failure should open
      breaker.recordFailure();
      expect(breaker.getStatus().state).toBe(CircuitState.OPEN);
    });
  });

  describe('getAllStatuses', () => {
    it('should return statuses of all registered circuit breakers', () => {
      bookingWorkflowCircuitBreakerRegistry.getOrCreate('step-a');
      bookingWorkflowCircuitBreakerRegistry.getOrCreate('step-b');
      bookingWorkflowCircuitBreakerRegistry.getOrCreate('step-c');

      const statuses = bookingWorkflowCircuitBreakerRegistry.getAllStatuses();
      expect(Object.keys(statuses)).toContain('step-a');
      expect(Object.keys(statuses)).toContain('step-b');
      expect(Object.keys(statuses)).toContain('step-c');
    });

    it('should reflect current state of each breaker', () => {
      const breakerA = bookingWorkflowCircuitBreakerRegistry.getOrCreate('step-a');
      const breakerB = bookingWorkflowCircuitBreakerRegistry.getOrCreate('step-b');

      breakerA.recordFailure();
      breakerA.recordFailure();
      breakerA.recordFailure();

      const statuses = bookingWorkflowCircuitBreakerRegistry.getAllStatuses();
      expect(statuses['step-a'].state).toBe(CircuitState.OPEN);
      expect(statuses['step-a'].failureCount).toBe(3);
      expect(statuses['step-b'].state).toBe(CircuitState.CLOSED);
    });
  });

  describe('reset', () => {
    it('should reset a specific circuit breaker', () => {
      const breaker = bookingWorkflowCircuitBreakerRegistry.getOrCreate('step-x');
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getStatus().state).toBe(CircuitState.OPEN);

      bookingWorkflowCircuitBreakerRegistry.reset('step-x');
      expect(breaker.getStatus().state).toBe(CircuitState.CLOSED);
    });

    it('should not affect other circuit breakers', () => {
      const breaker1 = bookingWorkflowCircuitBreakerRegistry.getOrCreate('step-1');
      const breaker2 = bookingWorkflowCircuitBreakerRegistry.getOrCreate('step-2');

      breaker1.recordFailure();
      breaker1.recordFailure();
      breaker1.recordFailure();
      breaker2.recordFailure();
      breaker2.recordFailure();

      bookingWorkflowCircuitBreakerRegistry.reset('step-1');
      expect(breaker1.getStatus().state).toBe(CircuitState.CLOSED);
      expect(breaker2.getStatus().state).toBe(CircuitState.CLOSED);
      expect(breaker2.getStatus().failureCount).toBe(2); // Unchanged
    });
  });

  describe('resetAll', () => {
    it('should reset all circuit breakers', () => {
      const breaker1 = bookingWorkflowCircuitBreakerRegistry.getOrCreate('step-1');
      const breaker2 = bookingWorkflowCircuitBreakerRegistry.getOrCreate('step-2');
      const breaker3 = bookingWorkflowCircuitBreakerRegistry.getOrCreate('step-3');

      breaker1.recordFailure();
      breaker1.recordFailure();
      breaker1.recordFailure();
      breaker2.recordFailure();
      breaker2.recordFailure();
      breaker2.recordFailure();
      breaker3.recordFailure();
      breaker3.recordFailure();
      breaker3.recordFailure();

      expect(breaker1.getStatus().state).toBe(CircuitState.OPEN);
      expect(breaker2.getStatus().state).toBe(CircuitState.OPEN);
      expect(breaker3.getStatus().state).toBe(CircuitState.OPEN);

      bookingWorkflowCircuitBreakerRegistry.resetAll();
      expect(breaker1.getStatus().state).toBe(CircuitState.CLOSED);
      expect(breaker2.getStatus().state).toBe(CircuitState.CLOSED);
      expect(breaker3.getStatus().state).toBe(CircuitState.CLOSED);
    });
  });
});
