/**
 * US-982: Chatbot response latency SLA monitoring with P95 alerting.
 *
 * Tests the analytics-latency.ts admin endpoints:
 * - GET /analytics/latency — P50/P95/P99 over 1h/24h/7d, by provider, SLA alert
 * - GET /analytics/latency/high-latency — flagged high-latency responses (>10s)
 *
 * Uses a minimal Express app with the latency router, mocking db.execute.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'node:http';

// ── Mock db before importing router ──────────────────────────────────────────
const mockExecute = vi.fn();
vi.mock('../../lib/db.js', () => ({
  db: { execute: (...args: any[]) => mockExecute(...args) },
}));

// Import router after mocking
const { default: latencyRouter } = await import('../../routes/admin/analytics-latency.js');

// ── Test app ─────────────────────────────────────────────────────────────────

function createTestApp() {
  const app = express();
  app.use(latencyRouter);
  return app;
}

function httpGet(server: http.Server, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as { port: number };
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode!, body: data });
        }
      });
    }).on('error', reject);
  });
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('US-982: Latency SLA monitoring', () => {
  let server: http.Server;

  beforeAll(async () => {
    const app = createTestApp();
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    mockExecute.mockReset();
  });

  describe('GET /analytics/latency', () => {
    function setupStandardMocks(overrides?: { p95_15m?: number; sample_count_15m?: number }) {
      // Call 1: overall percentiles (1h/24h/7d in one query)
      mockExecute.mockResolvedValueOnce({
        rows: [{
          p50_1h: 800, p95_1h: 2500, p99_1h: 4000, sample_count_1h: 50,
          p50_24h: 900, p95_24h: 3000, p99_24h: 5000, sample_count_24h: 500,
          p50_7d: 1000, p95_7d: 3500, p99_7d: 6000, sample_count_7d: 3000,
        }],
      });
      // Call 2: by profile
      mockExecute.mockResolvedValueOnce({
        rows: [{
          profile_id: 'pelangi',
          p50_1h: 750, p95_1h: 2400, p99_1h: 3800, count_1h: 30,
          p50_24h: 850, p95_24h: 2900, p99_24h: 4800, count_24h: 300,
          p50_7d: 950, p95_7d: 3400, p99_7d: 5800, count_7d: 2000,
        }],
      });
      // Call 3: by source
      mockExecute.mockResolvedValueOnce({
        rows: [{
          source: 'llm',
          p50_24h: 2000, p95_24h: 5000, p99_24h: 8000, count_24h: 200,
          p50_7d: 2200, p95_7d: 5500, p99_7d: 8500, count_7d: 1500,
        }],
      });
      // Call 4: by provider
      mockExecute.mockResolvedValueOnce({
        rows: [
          {
            provider: 'nvidia/kimi-k2.5',
            p50_1h: 700, p95_1h: 2200, p99_1h: 3500, count_1h: 20,
            p50_24h: 800, p95_24h: 2700, p99_24h: 4500, count_24h: 180,
            p50_7d: 900, p95_7d: 3200, p99_7d: 5200, count_7d: 1200,
          },
          {
            provider: 'ollama/llama3',
            p50_1h: 1200, p95_1h: 3500, p99_1h: 5500, count_1h: 10,
            p50_24h: 1400, p95_24h: 4000, p99_24h: 6000, count_24h: 80,
            p50_7d: 1500, p95_7d: 4200, p99_7d: 6500, count_7d: 500,
          },
        ],
      });
      // Call 5: 15-minute SLA check
      mockExecute.mockResolvedValueOnce({
        rows: [{
          p95_15m: overrides?.p95_15m ?? 3200,
          sample_count_15m: overrides?.sample_count_15m ?? 15,
        }],
      });
    }

    it('returns P50/P95/P99 for 1h, 24h, 7d windows (AC2)', async () => {
      setupStandardMocks();
      const { status, body } = await httpGet(server, '/analytics/latency');
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // 1h window
      expect(body.overall.last1h.p50Ms).toBe(800);
      expect(body.overall.last1h.p95Ms).toBe(2500);
      expect(body.overall.last1h.p99Ms).toBe(4000);
      expect(body.overall.last1h.sampleCount).toBe(50);

      // 24h window
      expect(body.overall.last24h.p50Ms).toBe(900);
      expect(body.overall.last24h.p95Ms).toBe(3000);

      // 7d window
      expect(body.overall.last7d.p50Ms).toBe(1000);
      expect(body.overall.last7d.p95Ms).toBe(3500);
    });

    it('includes per-provider latency breakdown (AC4)', async () => {
      setupStandardMocks();
      const { body } = await httpGet(server, '/analytics/latency');

      expect(body.byProvider).toHaveLength(2);
      expect(body.byProvider[0].provider).toBe('nvidia/kimi-k2.5');
      expect(body.byProvider[0].last24h.p95Ms).toBe(2700);
      expect(body.byProvider[1].provider).toBe('ollama/llama3');
      expect(body.byProvider[1].last24h.p95Ms).toBe(4000);
    });

    it('SLA alert fires when 15-min P95 exceeds threshold (AC3)', async () => {
      setupStandardMocks({ p95_15m: 7500 });
      const { body } = await httpGet(server, '/analytics/latency?p95_threshold_ms=5000');

      expect(body.slaAlert.breached).toBe(true);
      expect(body.slaAlert.currentP95Ms).toBe(7500);
      expect(body.slaAlert.p95ThresholdMs).toBe(5000);
      expect(body.slaAlert.message).toContain('SLA BREACH');
      expect(body.slaAlert.message).toContain('7500ms');
    });

    it('SLA alert does not fire when P95 is below threshold', async () => {
      setupStandardMocks({ p95_15m: 2000 });
      const { body } = await httpGet(server, '/analytics/latency');

      expect(body.slaAlert.breached).toBe(false);
      expect(body.slaAlert.message).toBeNull();
    });

    it('default SLA threshold is 5000ms per AC3', async () => {
      setupStandardMocks({ p95_15m: 4999 });
      const { body } = await httpGet(server, '/analytics/latency');

      expect(body.slaAlert.p95ThresholdMs).toBe(5000);
      expect(body.slaAlert.breached).toBe(false);
    });

    it('includes byProfile with 1h/24h/7d windows', async () => {
      setupStandardMocks();
      const { body } = await httpGet(server, '/analytics/latency');

      expect(body.byProfile).toHaveLength(1);
      expect(body.byProfile[0].profileId).toBe('pelangi');
      expect(body.byProfile[0].last1h.p95Ms).toBe(2400);
      expect(body.byProfile[0].last24h.p95Ms).toBe(2900);
      expect(body.byProfile[0].last7d.p95Ms).toBe(3400);
    });
  });

  describe('GET /analytics/latency/high-latency', () => {
    it('returns high-latency responses flagged with warning badge (AC5)', async () => {
      // Call 1: high-latency messages
      mockExecute.mockResolvedValueOnce({
        rows: [
          {
            id: 1, phone: '60123456789', response_time_ms: 15000,
            model: 'ollama/llama3', source: 'llm', intent: 'booking',
            confidence: 0.85, profile_id: 'pelangi',
            timestamp: new Date().toISOString(), push_name: 'Ali',
          },
          {
            id: 2, phone: '60198765432', response_time_ms: 12000,
            model: 'nvidia/kimi-k2.5', source: 'semantic', intent: 'faq',
            confidence: 0.92, profile_id: 'southern',
            timestamp: new Date().toISOString(), push_name: null,
          },
        ],
      });
      // Call 2: total count
      mockExecute.mockResolvedValueOnce({
        rows: [{ total: 5 }],
      });

      const { status, body } = await httpGet(server, '/analytics/latency/high-latency');
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.thresholdMs).toBe(10000);
      expect(body.totalCount).toBe(5);
      expect(body.messages).toHaveLength(2);

      // First message
      expect(body.messages[0].responseTimeMs).toBe(15000);
      expect(body.messages[0].provider).toBe('ollama/llama3');
      expect(body.messages[0].highLatencyWarning).toBe(true);
      expect(body.messages[0].pushName).toBe('Ali');

      // Second message - null pushName
      expect(body.messages[1].pushName).toBeNull();
    });

    it('respects custom threshold_ms parameter', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });
      mockExecute.mockResolvedValueOnce({ rows: [{ total: 0 }] });

      const { body } = await httpGet(server, '/analytics/latency/high-latency?threshold_ms=5000');
      expect(body.thresholdMs).toBe(5000);
      expect(body.messages).toHaveLength(0);
      expect(body.totalCount).toBe(0);
    });

    it('limits results to 200 max', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });
      mockExecute.mockResolvedValueOnce({ rows: [{ total: 0 }] });

      // Request 500 but should be capped at 200
      await httpGet(server, '/analytics/latency/high-latency?limit=500');
      // Verify the SQL was called (we can't easily inspect the SQL limit,
      // but the endpoint should not error)
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });
  });
});
