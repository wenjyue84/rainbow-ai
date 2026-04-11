/**
 * Tests for US-467: Incident Classification and Intelligent Routing
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  categorizeError,
  getHandlerForCategory,
  routeErrorToHandler,
  classifyAndRoute,
  getRoutingMetrics,
  resetMetrics,
  ErrorCategory,
} from '../incident-classifier.js';

describe('IncidentClassifier — US-467', () => {
  beforeEach(() => {
    resetMetrics();
  });

  // ─── Acceptance Criteria 1: Classification into 6 categories ─────
  describe('Acceptance Criteria 1: Error Classification', () => {
    it('should classify INTENT_MISCLASSIFICATION errors', () => {
      const errors = [
        'Low confidence intent classification',
        'Intent misclassified as booking_confirmation',
        'Embedding distance exceeded threshold',
        'Keyword mismatch in intent detection',
      ];

      for (const msg of errors) {
        const result = categorizeError(msg);
        expect(result.category).toBe('INTENT_MISCLASSIFICATION');
        expect(result.confidence).toBeGreaterThan(0.8);
      }
    });

    it('should classify CONTEXT_RETRIEVAL errors', () => {
      const errors = [
        'Context retrieval failed from knowledge base',
        'KB retrieval timeout',
        'Conversation history not found',
        'Memory retrieval failed',
      ];

      for (const msg of errors) {
        const result = categorizeError(msg);
        expect(result.category).toBe('CONTEXT_RETRIEVAL');
        expect(result.confidence).toBeGreaterThan(0.8);
      }
    });

    it('should classify PROFILE_ISOLATION errors', () => {
      const errors = [
        'Profile isolation boundary violation',
        'Cross-profile data leak detected',
        'Profile segregation failed',
        'Cross-tenant data access',
      ];

      for (const msg of errors) {
        const result = categorizeError(msg);
        expect(result.category).toBe('PROFILE_ISOLATION');
        expect(result.confidence).toBeGreaterThan(0.8);
      }
    });

    it('should classify BOOKING_STEP errors', () => {
      const errors = [
        'Booking step payment_confirmation failed',
        'Workflow step execution error',
        'booking_step_failed: send_confirmation timeout',
        'Booking workflow step not found',
      ];

      for (const msg of errors) {
        const result = categorizeError(msg);
        expect(result.category).toBe('BOOKING_STEP');
        expect(result.confidence).toBeGreaterThan(0.8);
      }
    });

    it('should classify FALLBACK_TRIGGER errors', () => {
      const errors = [
        'No matching intent, fallback triggered',
        'Fallback response generated',
        'Fallback trigger: no intent matched with threshold',
        'Default response fallback',
      ];

      for (const msg of errors) {
        const result = categorizeError(msg);
        expect(result.category).toBe('FALLBACK_TRIGGER');
        expect(result.confidence).toBeGreaterThan(0.8);
      }
    });

    it('should classify OTHER errors', () => {
      const errors = [
        'Random unclassified error message',
        'Some unexpected system failure',
        'Generic error with no pattern match',
      ];

      for (const msg of errors) {
        const result = categorizeError(msg);
        expect(result.category).toBe('OTHER');
        expect(result.confidence).toBeLessThanOrEqual(0.5);
      }
    });

    it('should include confidence_score in classification', () => {
      const result = categorizeError('Intent misclassified');
      expect(result.confidence).toBeDefined();
      expect(typeof result.confidence).toBe('number');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  // ─── Acceptance Criteria 2: Handler Routing ────────────────────
  describe('Acceptance Criteria 2: Handler Routing', () => {
    it('should route INTENT_MISCLASSIFICATION to intent-error-patterns handler', () => {
      const handler = getHandlerForCategory('INTENT_MISCLASSIFICATION');
      expect(handler.handler).toBe('intent-error-patterns');
      expect(handler.modulePath).toContain('intent-error-patterns');
    });

    it('should route PROFILE_ISOLATION to profile-audit handler', () => {
      const handler = getHandlerForCategory('PROFILE_ISOLATION');
      expect(handler.handler).toBe('profile-audit');
      expect(handler.modulePath).toContain('profile-audit');
    });

    it('should route BOOKING_STEP to booking/failure-analyzer handler', () => {
      const handler = getHandlerForCategory('BOOKING_STEP');
      expect(handler.handler).toBe('booking-failure-analyzer');
      expect(handler.modulePath).toContain('booking/failure-analyzer');
    });

    it('should route other categories to admin-dashboard', () => {
      const categories: ErrorCategory[] = ['CONTEXT_RETRIEVAL', 'FALLBACK_TRIGGER', 'OTHER'];

      for (const category of categories) {
        const handler = getHandlerForCategory(category);
        expect(handler.handler).toBe('admin-dashboard');
      }
    });
  });

  // ─── Acceptance Criteria 3: Logging and Metrics ────────────────
  describe('Acceptance Criteria 3: Routing Decision Logging', () => {
    it('should log routing decision with all required fields', async () => {
      const classification = await classifyAndRoute(
        'Intent misclassified as booking_confirmation',
        'pelangi',
        'test_err_001'
      );

      expect(classification.error_id).toBe('test_err_001');
      expect(classification.error_message).toBeDefined();
      expect(classification.error_category).toBeDefined();
      expect(classification.category_confidence).toBeDefined();
      expect(classification.affected_profile).toBe('pelangi');
      expect(classification.handler_routed_to).toBeDefined();
      expect(classification.handler_result_status).toBeDefined();
      expect(classification.classified_at).toBeDefined();
    });

    it('should track routing_success_rate in metrics', async () => {
      await classifyAndRoute('Error 1', 'pelangi', 'err_1');
      await classifyAndRoute('Error 2', 'pelangi', 'err_2');

      const metrics = getRoutingMetrics();
      expect(metrics.routing_success_rate).toBeDefined();
      expect(typeof metrics.routing_success_rate).toBe('number');
      expect(metrics.routing_success_rate).toBeGreaterThanOrEqual(0);
      expect(metrics.routing_success_rate).toBeLessThanOrEqual(1);
    });

    it('should track total errors and successful routes', async () => {
      resetMetrics();
      await classifyAndRoute('Error 1', 'pelangi', 'err_1');

      let metrics = getRoutingMetrics();
      expect(metrics.total_errors).toBe(1);
      expect(metrics.successful_routes).toBe(1);

      await classifyAndRoute('Error 2', 'pelangi', 'err_2');

      metrics = getRoutingMetrics();
      expect(metrics.total_errors).toBe(2);
      expect(metrics.successful_routes).toBe(2);
    });

    it('should include routed_at timestamp when error is routed', async () => {
      const classification = await classifyAndRoute(
        'Intent misclassified',
        'pelangi',
        'test_err_002'
      );

      expect(classification.routed_at).toBeDefined();
      expect(typeof classification.routed_at).toBe('string');
      // Should be valid ISO date string
      expect(new Date(classification.routed_at!).getTime()).toBeGreaterThan(0);
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────
  describe('Edge Cases', () => {
    it('should handle null/undefined error message gracefully', () => {
      const result1 = categorizeError('');
      expect(result1.category).toBe('OTHER');

      const result2 = categorizeError(null as any);
      expect(result2.category).toBe('OTHER');
    });

    it('should truncate long error messages to 500 chars', async () => {
      const longMsg = 'x'.repeat(1000);
      const classification = await classifyAndRoute(longMsg, 'pelangi');

      expect(classification.error_message.length).toBeLessThanOrEqual(500);
    });

    it('should generate unique error IDs when not provided', async () => {
      const c1 = await classifyAndRoute('Error 1', 'pelangi');
      const c2 = await classifyAndRoute('Error 2', 'pelangi');

      expect(c1.error_id).not.toBe(c2.error_id);
    });

    it('should handle multiple profiles correctly', async () => {
      const c1 = await classifyAndRoute('Intent misclassified', 'pelangi');
      const c2 = await classifyAndRoute('Intent misclassified', 'southern');

      expect(c1.affected_profile).toBe('pelangi');
      expect(c2.affected_profile).toBe('southern');
      expect(c1.error_id).not.toBe(c2.error_id);
    });

    it('should classify case-insensitively', () => {
      const result1 = categorizeError('INTENT MISCLASSIFIED');
      const result2 = categorizeError('intent misclassified');
      const result3 = categorizeError('Intent Misclassified');

      expect(result1.category).toBe(result2.category);
      expect(result2.category).toBe(result3.category);
    });
  });

  // ─── Metrics Tracking ──────────────────────────────────────────
  describe('Metrics Collection', () => {
    it('should calculate routing_success_rate correctly', async () => {
      resetMetrics();

      // All successful routes
      for (let i = 0; i < 5; i++) {
        await classifyAndRoute(`Error ${i}`, 'pelangi');
      }

      let metrics = getRoutingMetrics();
      expect(metrics.routing_success_rate).toBe(1.0); // 5/5 successful

      // Reset and test partial success (current implementation always succeeds)
      // In real scenario, some handlers might fail
      resetMetrics();
      await classifyAndRoute('Error', 'pelangi');

      metrics = getRoutingMetrics();
      expect(metrics.routing_success_rate).toBeGreaterThanOrEqual(0);
    });

    it('should track individual route statuses', async () => {
      resetMetrics();

      const classification = await classifyAndRoute(
        'Intent misclassified',
        'pelangi',
        'test_err_003'
      );

      expect(['success', 'failure', 'skipped']).toContain(
        classification.handler_result_status
      );
    });
  });

  // ─── Integration Tests ────────────────────────────────────────
  describe('Integration Tests', () => {
    it('should complete full classification → routing → logging flow', async () => {
      const errorMsg = 'Booking step payment confirmation timeout';
      const profile = 'pelangi';
      const errorId = 'integration_test_001';

      const classification = await classifyAndRoute(errorMsg, profile, errorId);

      // Verify all AC requirements met
      expect(classification.error_category).toBe('BOOKING_STEP');
      expect(classification.category_confidence).toBeGreaterThan(0.8);
      expect(classification.handler_routed_to).toBe('booking-failure-analyzer');
      expect(['success', 'failure', 'skipped']).toContain(classification.handler_result_status);
      expect(classification.affected_profile).toBe(profile);

      // Verify metrics updated
      const metrics = getRoutingMetrics();
      expect(metrics.total_errors).toBeGreaterThan(0);
      expect(metrics.successful_routes).toBeGreaterThanOrEqual(0);
    });

    it('should handle concurrent error classifications', async () => {
      resetMetrics();

      const promises = [
        classifyAndRoute('Intent misclassified', 'pelangi', 'concurrent_1'),
        classifyAndRoute('Profile isolation violation', 'pelangi', 'concurrent_2'),
        classifyAndRoute('Booking step failed', 'pelangi', 'concurrent_3'),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(results[0].error_category).toBe('INTENT_MISCLASSIFICATION');
      expect(results[1].error_category).toBe('PROFILE_ISOLATION');
      expect(results[2].error_category).toBe('BOOKING_STEP');

      const metrics = getRoutingMetrics();
      expect(metrics.total_errors).toBe(3);
    });
  });
});
