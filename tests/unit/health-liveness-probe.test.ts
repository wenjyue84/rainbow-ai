/**
 * Tests for US-505: Liveness Probe Returns 503 When Critical Services Are Down
 *
 * Verifies that:
 * 1. Returns 503 when DB pool is exhausted
 * 2. Returns 503 when WhatsApp is disconnected >5 minutes
 * 3. Returns 200 when healthy
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock the dependencies BEFORE importing the route
vi.mock('../../src/lib/baileys-client.js', () => ({
  getWhatsAppStatus: vi.fn()
}));

vi.mock('../../src/lib/db.js', () => ({
  getPoolMetrics: vi.fn()
}));

vi.mock('../../src/lib/waba-webhook-health.js', () => ({
  getWebhookHealthState: vi.fn()
}));

// Now import mocked modules
import { getWhatsAppStatus } from '../../src/lib/baileys-client.js';
import { getPoolMetrics } from '../../src/lib/db.js';
import { getWebhookHealthState } from '../../src/lib/waba-webhook-health.js';
import healthRouter from '../../src/routes/health.js';

// Setup Express app with health router
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(healthRouter);
  return app;
}

describe('Health Liveness Probe (US-505)', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(getWhatsAppStatus).mockReturnValue({
      state: 'open',
      user: { id: '1234567890@c.us' },
      authDir: '/auth',
      qr: null
    });

    vi.mocked(getPoolMetrics).mockReturnValue({
      total: 10,
      idle: 8,
      waiting: 0
    });

    vi.mocked(getWebhookHealthState).mockReturnValue({
      webhookSubscribed: true
    });

    app = createTestApp();
  });

  describe('GET /health', () => {
    it('should return 200 when healthy', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.whatsapp).toBe('open');
    });

    it('should return 503 when DB pool is exhausted', async () => {
      // Mock DB pool exhausted (all connections waiting)
      vi.mocked(getPoolMetrics).mockReturnValue({
        total: 10,
        idle: 0,
        waiting: 10
      });

      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unhealthy');
      expect(response.body.failureReasons.dbPoolExhausted).toBe(true);
    });

    it('should return 503 when WhatsApp disconnected >5 minutes', async () => {
      // Mock WhatsApp disconnected 6 minutes ago
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();

      vi.mocked(getWhatsAppStatus).mockReturnValue({
        state: 'close',
        user: null,
        authDir: '/auth',
        qr: null,
        lastDisconnectAt: sixMinutesAgo
      });

      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unhealthy');
      expect(response.body.failureReasons.whatsappDisconnectedLong).toBe(true);
    });

    it('should return 200 when WhatsApp disconnected <5 minutes', async () => {
      // Mock WhatsApp disconnected 3 minutes ago
      const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();

      vi.mocked(getWhatsAppStatus).mockReturnValue({
        state: 'close',
        user: null,
        authDir: '/auth',
        qr: null,
        lastDisconnectAt: threeMinutesAgo
      });

      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });

    it('should return 200 when WhatsApp has no lastDisconnectAt timestamp', async () => {
      // Mock WhatsApp never connected
      vi.mocked(getWhatsAppStatus).mockReturnValue({
        state: 'close',
        user: null,
        authDir: '/auth',
        qr: null,
        lastDisconnectAt: null
      });

      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });

    it('should return 503 when both DB and WhatsApp are down', async () => {
      // Mock both failures
      vi.mocked(getPoolMetrics).mockReturnValue({
        total: 10,
        idle: 0,
        waiting: 10
      });

      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      vi.mocked(getWhatsAppStatus).mockReturnValue({
        state: 'close',
        user: null,
        authDir: '/auth',
        qr: null,
        lastDisconnectAt: sixMinutesAgo
      });

      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body.failureReasons.dbPoolExhausted).toBe(true);
      expect(response.body.failureReasons.whatsappDisconnectedLong).toBe(true);
    });

    it('should include failureReasons only when unhealthy', async () => {
      // Healthy response
      let response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.failureReasons).toBeUndefined();

      // Unhealthy response
      vi.mocked(getPoolMetrics).mockReturnValue({
        total: 10,
        idle: 0,
        waiting: 10
      });

      response = await request(app).get('/health');
      expect(response.status).toBe(503);
      expect(response.body.failureReasons).toBeDefined();
    });

    it('should track WhatsApp state correctly in response', async () => {
      vi.mocked(getWhatsAppStatus).mockReturnValue({
        state: 'open',
        user: { id: '601234567890@c.us' },
        authDir: '/auth',
        qr: null
      });

      const response = await request(app).get('/health');

      expect(response.body.whatsapp).toBe('open');
    });

    it('should include webhook health in response', async () => {
      vi.mocked(getWebhookHealthState).mockReturnValue({
        webhookSubscribed: true
      });

      const response = await request(app).get('/health');

      expect(response.body.webhookSubscribed).toBe(true);
    });
  });
});
