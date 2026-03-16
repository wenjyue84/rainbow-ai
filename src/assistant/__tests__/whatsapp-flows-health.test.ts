/**
 * US-934: WhatsApp Flows Health and Error Monitoring Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordFlowSuccess,
  recordFlowError,
  isFlowInFallback,
  runFlowHealthCheck,
} from '../../lib/whatsapp-flows-health.js';

describe('US-934: WhatsApp Flows Health Monitoring', () => {
  // Note: Each test uses a unique flow ID to avoid cross-test contamination
  // since the in-memory metrics persist across tests.

  it('records successful requests and computes healthy status', async () => {
    const flowId = 'test-success-' + Date.now();
    recordFlowSuccess(flowId, 150, 'INIT');
    recordFlowSuccess(flowId, 200, 'check_availability');
    recordFlowSuccess(flowId, 180, 'submit_reservation');

    const results = await runFlowHealthCheck();
    const flow = results.find(r => r.flowId === flowId);
    expect(flow).toBeDefined();
    expect(flow!.status).toBe('healthy');
    expect(flow!.totalRequests).toBe(3);
    expect(flow!.errorCount).toBe(0);
    expect(flow!.errorRate).toBe(0);
    expect(flow!.avgResponseMs).toBeGreaterThan(0);
  });

  it('records errors and computes degraded status at >5% error rate', async () => {
    const flowId = 'test-degraded-' + Date.now();
    // 10 requests total, 1 error = 10% > 5% threshold
    for (let i = 0; i < 9; i++) {
      recordFlowSuccess(flowId, 100);
    }
    recordFlowError(flowId, 'DECRYPT_FAIL', 'Decryption failed', 500);

    const results = await runFlowHealthCheck();
    const flow = results.find(r => r.flowId === flowId);
    expect(flow).toBeDefined();
    expect(flow!.totalRequests).toBe(10);
    expect(flow!.errorCount).toBe(1);
    expect(flow!.errorRate).toBeCloseTo(0.1, 1);
    expect(flow!.status).toBe('degraded');
    expect(flow!.lastFailureReason).toContain('DECRYPT_FAIL');
  });

  it('marks flow as broken when error rate exceeds 20%', async () => {
    const flowId = 'test-broken-' + Date.now();
    // 5 requests, 2 errors = 40% > 20% broken threshold
    for (let i = 0; i < 3; i++) {
      recordFlowSuccess(flowId, 100);
    }
    recordFlowError(flowId, '500', 'Server error', 1000);
    recordFlowError(flowId, '500', 'DB timeout', 2000);

    const results = await runFlowHealthCheck();
    const flow = results.find(r => r.flowId === flowId);
    expect(flow).toBeDefined();
    expect(flow!.status).toBe('broken');
  });

  it('activates text-based fallback for broken flows', async () => {
    const flowId = 'test-fallback-' + Date.now();
    expect(isFlowInFallback(flowId)).toBe(false);

    // Trigger enough errors to exceed 20% threshold
    recordFlowSuccess(flowId, 100);
    recordFlowSuccess(flowId, 100);
    recordFlowError(flowId, '500', 'Error 1', 500);
    recordFlowError(flowId, '500', 'Error 2', 500);
    recordFlowError(flowId, '500', 'Error 3', 500);

    // Run health check to evaluate and activate fallback
    await runFlowHealthCheck();
    expect(isFlowInFallback(flowId)).toBe(true);
  });

  it('deactivates fallback when flow recovers', async () => {
    const flowId = 'test-recover-' + Date.now();

    // First: break the flow
    recordFlowError(flowId, '500', 'Error', 500);
    recordFlowError(flowId, '500', 'Error', 500);
    recordFlowError(flowId, '500', 'Error', 500);
    await runFlowHealthCheck();
    expect(isFlowInFallback(flowId)).toBe(true);

    // Then: record enough successes to bring error rate below 5%
    // 3 errors + 60 successes = 63 total, 3/63 = 4.8% < 5% threshold
    for (let i = 0; i < 60; i++) {
      recordFlowSuccess(flowId, 100);
    }
    // Recovery check happens inside recordFlowSuccess
    expect(isFlowInFallback(flowId)).toBe(false);
  });

  it('logs flow endpoint failures with flow_id, screen_id, and error_code', async () => {
    const flowId = 'test-error-log-' + Date.now();
    recordFlowError(flowId, 'DECRYPT_ERROR', 'Failed to decrypt AES key', 250, 'RESERVATION_DATES');

    const results = await runFlowHealthCheck();
    const flow = results.find(r => r.flowId === flowId);
    expect(flow).toBeDefined();
    expect(flow!.errorCount).toBe(1);
    expect(flow!.lastFailureReason).toContain('DECRYPT_ERROR');
  });

  it('includes known flows (reservation, checkin) in health check', async () => {
    const results = await runFlowHealthCheck();
    const flowIds = results.map(r => r.flowId);
    expect(flowIds).toContain('reservation');
    expect(flowIds).toContain('checkin');
  });

  it('returns per-flow health record with all required fields', async () => {
    const results = await runFlowHealthCheck();
    for (const flow of results) {
      expect(flow).toHaveProperty('flowId');
      expect(flow).toHaveProperty('flowName');
      expect(flow).toHaveProperty('status');
      expect(['healthy', 'degraded', 'broken']).toContain(flow.status);
      expect(flow).toHaveProperty('totalRequests');
      expect(flow).toHaveProperty('errorCount');
      expect(flow).toHaveProperty('errorRate');
      expect(flow).toHaveProperty('avgResponseMs');
      expect(flow).toHaveProperty('lastCheckedAt');
    }
  });

  it('computes correct average response time', async () => {
    const flowId = 'test-avg-' + Date.now();
    recordFlowSuccess(flowId, 100);
    recordFlowSuccess(flowId, 200);
    recordFlowSuccess(flowId, 300);

    const results = await runFlowHealthCheck();
    const flow = results.find(r => r.flowId === flowId);
    expect(flow).toBeDefined();
    expect(flow!.avgResponseMs).toBe(200); // (100+200+300)/3
  });

  it('healthy flow has 0% error rate', async () => {
    const flowId = 'test-zero-err-' + Date.now();
    for (let i = 0; i < 10; i++) {
      recordFlowSuccess(flowId, 100 + i * 10);
    }

    const results = await runFlowHealthCheck();
    const flow = results.find(r => r.flowId === flowId);
    expect(flow!.errorRate).toBe(0);
    expect(flow!.status).toBe('healthy');
  });
});
