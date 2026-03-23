/**
 * Tests for US-291: Booking Workflow Failure Hotspot Analyzer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  extractFailureReason,
  calculateFailureMetrics,
  type FailureReasonCount,
  type StepFailureMetrics,
} from '../analytics-booking-failures.js';

describe('US-291: Booking Workflow Failure Hotspot Analyzer', () => {
  // ─── extractFailureReason tests ─────────────────────────────────────

  describe('extractFailureReason', () => {
    it('should extract errorCode from output', () => {
      const output = { errorCode: 'room-not-available', message: 'Room unavailable' };
      expect(extractFailureReason(output)).toBe('room-not-available');
    });

    it('should extract error field if errorCode missing', () => {
      const output = { error: 'payment_failed', extra: 'data' };
      expect(extractFailureReason(output)).toBe('payment_failed');
    });

    it('should extract reason field if error missing', () => {
      const output = { reason: 'timeout_occurred', data: 'test' };
      expect(extractFailureReason(output)).toBe('timeout_occurred');
    });

    it('should detect timeout in message field', () => {
      const output = { message: 'Request timeout after 5000ms', code: 500 };
      expect(extractFailureReason(output)).toBe('timeout');
    });

    it('should return first 50 chars of message if no error fields', () => {
      const longMessage = 'This is a very long message that exceeds fifty characters in length';
      const output = { message: longMessage };
      expect(extractFailureReason(output)).toBe(longMessage.slice(0, 50));
    });

    it('should return "unknown" if output is null', () => {
      expect(extractFailureReason(null)).toBe('unknown');
    });

    it('should return "unknown" if output is not an object', () => {
      expect(extractFailureReason('string' as any)).toBe('unknown');
    });

    it('should return "unknown" if output has no recognized error fields', () => {
      const output = { foo: 'bar', baz: 'qux' };
      expect(extractFailureReason(output)).toBe('unknown');
    });
  });

  // ─── calculateFailureMetrics tests ──────────────────────────────────

  describe('calculateFailureMetrics', () => {
    it('should calculate correct failure rate as percentage', () => {
      const reasons: FailureReasonCount[] = [];
      const metrics = calculateFailureMetrics(10, 100, reasons);
      expect(metrics.rate).toBe('10.0%');
    });

    it('should return 0.0% when no failures', () => {
      const reasons: FailureReasonCount[] = [];
      const metrics = calculateFailureMetrics(0, 100, reasons);
      expect(metrics.rate).toBe('0.0%');
    });

    it('should return 0.0% when attempts is zero', () => {
      const reasons: FailureReasonCount[] = [{ reason: 'timeout', count: 5 }];
      const metrics = calculateFailureMetrics(0, 0, reasons);
      expect(metrics.rate).toBe('0.0%');
    });

    it('should include failures and attempts counts', () => {
      const reasons: FailureReasonCount[] = [];
      const metrics = calculateFailureMetrics(5, 50, reasons);
      expect(metrics.failures).toBe(5);
      expect(metrics.attempts).toBe(50);
    });

    it('should return top 3 failure reasons sorted by count descending', () => {
      const reasons: FailureReasonCount[] = [
        { reason: 'timeout', count: 8 },
        { reason: 'validation', count: 15 },
        { reason: 'unavailable', count: 2 },
        { reason: 'network', count: 5 },
      ];
      const metrics = calculateFailureMetrics(30, 100, reasons);
      expect(metrics.top_reasons).toHaveLength(3);
      expect(metrics.top_reasons[0]).toEqual({ reason: 'validation', count: 15 });
      expect(metrics.top_reasons[1]).toEqual({ reason: 'timeout', count: 8 });
      expect(metrics.top_reasons[2]).toEqual({ reason: 'network', count: 5 });
    });

    it('should include fewer than 3 reasons if less available', () => {
      const reasons: FailureReasonCount[] = [
        { reason: 'timeout', count: 5 },
        { reason: 'validation', count: 3 },
      ];
      const metrics = calculateFailureMetrics(8, 50, reasons);
      expect(metrics.top_reasons).toHaveLength(2);
    });

    it('should return correct types', () => {
      const reasons: FailureReasonCount[] = [{ reason: 'test', count: 1 }];
      const metrics = calculateFailureMetrics(1, 10, reasons);
      expect(typeof metrics.failures).toBe('number');
      expect(typeof metrics.attempts).toBe('number');
      expect(typeof metrics.rate).toBe('string');
      expect(Array.isArray(metrics.top_reasons)).toBe(true);
    });
  });

  // ─── Integration-style tests ────────────────────────────────────────

  describe('Failure analysis workflow', () => {
    it('should handle a complete failure scenario', () => {
      // Scenario: 100 attempts at "check-availability", 10 failures
      const reasons: FailureReasonCount[] = [
        { reason: 'unavailable', count: 8 },
        { reason: 'timeout', count: 2 },
      ];
      const metrics = calculateFailureMetrics(10, 100, reasons);

      expect(metrics.failures).toBe(10);
      expect(metrics.attempts).toBe(100);
      expect(metrics.rate).toBe('10.0%');
      expect(metrics.top_reasons[0].reason).toBe('unavailable');
    });

    it('should correctly identify hotspot (high failure rate)', () => {
      // A hotspot: 80% failure rate
      const reasons: FailureReasonCount[] = [
        { reason: 'validation', count: 70 },
        { reason: 'network', count: 10 },
      ];
      const metrics = calculateFailureMetrics(80, 100, reasons);

      const failureRate = parseFloat(metrics.rate);
      expect(failureRate).toBe(80.0);
    });

    it('should handle steps with no failures', () => {
      const reasons: FailureReasonCount[] = [];
      const metrics = calculateFailureMetrics(0, 50, reasons);

      expect(metrics.failures).toBe(0);
      expect(metrics.rate).toBe('0.0%');
      expect(metrics.top_reasons).toHaveLength(0);
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle very high failure rates', () => {
      const reasons: FailureReasonCount[] = [{ reason: 'critical', count: 100 }];
      const metrics = calculateFailureMetrics(100, 100, reasons);
      expect(metrics.rate).toBe('100.0%');
    });

    it('should handle very low failure rates with many attempts', () => {
      const reasons: FailureReasonCount[] = [{ reason: 'rare', count: 1 }];
      const metrics = calculateFailureMetrics(1, 10000, reasons);
      const rate = parseFloat(metrics.rate);
      // 1/10000 = 0.01%, formatted to 1 decimal place = "0.0%"
      expect(rate).toBeLessThan(0.1);
    });

    it('should handle reason with same count values', () => {
      const reasons: FailureReasonCount[] = [
        { reason: 'error-a', count: 5 },
        { reason: 'error-b', count: 5 },
        { reason: 'error-c', count: 5 },
        { reason: 'error-d', count: 5 },
      ];
      const metrics = calculateFailureMetrics(20, 100, reasons);
      // Should return first 3 (order preserved from input)
      expect(metrics.top_reasons).toHaveLength(3);
    });
  });

  // ─── Real-world scenarios ───────────────────────────────────────────

  describe('Real-world booking workflow scenarios', () => {
    it('should analyze a typical booking workflow step', () => {
      // "select-room" step over 7 days: 1000 attempts, 50 failures
      const reasons: FailureReasonCount[] = [
        { reason: 'room-not-available', count: 40 },
        { reason: 'validation-error', count: 8 },
        { reason: 'timeout', count: 2 },
      ];
      const metrics = calculateFailureMetrics(50, 1000, reasons);

      expect(metrics.failures).toBe(50);
      expect(metrics.attempts).toBe(1000);
      expect(metrics.rate).toBe('5.0%');
      expect(metrics.top_reasons).toHaveLength(3);
      expect(metrics.top_reasons[0].reason).toBe('room-not-available');
    });

    it('should identify a problem step with high failure rate', () => {
      // "process-payment" step: 150 attempts, 45 failures (30% failure rate)
      const reasons: FailureReasonCount[] = [
        { reason: 'payment-gateway-error', count: 30 },
        { reason: 'insufficient-funds', count: 10 },
        { reason: 'invalid-card', count: 5 },
      ];
      const metrics = calculateFailureMetrics(45, 150, reasons);

      expect(metrics.rate).toBe('30.0%');
      expect(metrics.top_reasons[0].reason).toBe('payment-gateway-error');
    });
  });

  // ─── Acceptance Criteria Tests ──────────────────────────────────────

  describe('Acceptance Criteria', () => {
    it('AC1: Returns step with failure_count, attempt_count, failure_rate%, top reasons', () => {
      const reasons: FailureReasonCount[] = [
        { reason: 'room-not-available', count: 5 },
      ];
      const metrics = calculateFailureMetrics(10, 100, reasons);

      // Has all required fields
      expect(metrics).toHaveProperty('failures');
      expect(metrics).toHaveProperty('attempts');
      expect(metrics).toHaveProperty('rate');
      expect(metrics).toHaveProperty('top_reasons');

      // Rate is formatted as percentage
      expect(metrics.rate).toMatch(/^\d+\.\d%$/);
    });

    it('AC2: Correctly calculates 10.0% rate for 10 failures out of 100 attempts', () => {
      const reasons: FailureReasonCount[] = [];
      const metrics = calculateFailureMetrics(10, 100, reasons);
      expect(metrics.rate).toBe('10.0%');
    });

    it('AC3: Groups failure reasons by count and includes top 3', () => {
      const reasons: FailureReasonCount[] = [
        { reason: 'room-not-available', count: 5 },
        { reason: 'timeout', count: 3 },
        { reason: 'validation', count: 1 },
        { reason: 'network', count: 1 },
      ];
      const metrics = calculateFailureMetrics(10, 100, reasons);

      expect(metrics.top_reasons.length).toBeLessThanOrEqual(3);
      expect(metrics.top_reasons[0].count).toBeGreaterThanOrEqual(
        metrics.top_reasons[1]?.count ?? 0
      );
    });
  });
});
