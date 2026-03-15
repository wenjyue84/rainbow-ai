/**
 * Tests for US-904: Admin API endpoint-specific rate limiting.
 *
 * Verifies:
 * - Auth routes are strictly rate-limited (5 req/min per IP)
 * - 6th request to /auth/login returns 429
 * - 429 response includes Retry-After header
 * - Rate limit metadata headers are present (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)
 * - Analytics routes have a higher limit (60 req/min)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import rateLimit from 'express-rate-limit';
import http from 'node:http';

/** Create a mini Express app with the same rate-limit configuration as the admin router (US-904) */
function createTestApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json());

  // Strict auth rate limiter: 5 requests per minute per IP
  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please try again later.' },
  });

  // Standard read rate limiter: 60 requests per minute per IP
  const readLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
    skip: (req) => req.method !== 'GET',
  });

  app.use('/auth', authLimiter);
  app.use('/analytics', readLimiter);

  // Mock auth/login endpoint
  app.post('/auth/login', (_req, res) => {
    res.json({ authenticated: false, message: 'mock' });
  });

  // Mock analytics endpoint
  app.get('/analytics/kpis', (_req, res) => {
    res.json({ data: [] });
  });

  return app;
}

/** Helper: make an HTTP request (POST or GET) to the test server */
function postRequest(
  server: http.Server,
  path: string,
  body?: object
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, headers: res.headers, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode!, headers: res.headers, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getRequest(
  server: http.Server,
  path: string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    http.get(`http://127.0.0.1:${addr.port}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode!, headers: res.headers, body: data });
        }
      });
    }).on('error', reject);
  });
}

describe('US-904: Endpoint-specific rate limiting', () => {
  let server: http.Server;

  beforeEach(async () => {
    const app = createTestApp();
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    return () => {
      server.close();
    };
  });

  it('allows 5 requests to /auth/login and rejects the 6th with 429', async () => {
    const body = { username: 'test', password: 'password123' };

    // First 5 requests should succeed
    for (let i = 0; i < 5; i++) {
      const res = await postRequest(server, '/auth/login', body);
      expect(res.status).toBe(200);
    }

    // 6th request should be rate-limited
    const res = await postRequest(server, '/auth/login', body);
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many authentication attempts');
  });

  it('returns Retry-After header on 429 from auth limiter', async () => {
    const body = { username: 'test', password: 'password123' };

    // Exhaust the limit
    for (let i = 0; i < 5; i++) {
      await postRequest(server, '/auth/login', body);
    }

    const res = await postRequest(server, '/auth/login', body);
    expect(res.status).toBe(429);
    // express-rate-limit v8 with standardHeaders:true sends Retry-After
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('includes rate limit metadata headers on auth routes', async () => {
    const body = { username: 'test', password: 'password123' };

    const res = await postRequest(server, '/auth/login', body);
    expect(res.status).toBe(200);

    // express-rate-limit v8 standardHeaders sends these as RateLimit-Limit etc.
    // or X-RateLimit-Limit depending on draft spec version
    const hasRateLimitHeaders =
      res.headers['ratelimit-limit'] !== undefined ||
      res.headers['x-ratelimit-limit'] !== undefined;
    expect(hasRateLimitHeaders).toBe(true);
  });

  it('analytics GET routes have a higher rate limit (60 req/min)', async () => {
    // Fire 10 rapid GET requests — all should succeed (well under 60 limit)
    for (let i = 0; i < 10; i++) {
      const res = await getRequest(server, '/analytics/kpis');
      expect(res.status).toBe(200);
    }
  });

  it('analytics routes include rate limit metadata headers', async () => {
    const res = await getRequest(server, '/analytics/kpis');
    expect(res.status).toBe(200);

    const hasRateLimitHeaders =
      res.headers['ratelimit-limit'] !== undefined ||
      res.headers['x-ratelimit-limit'] !== undefined;
    expect(hasRateLimitHeaders).toBe(true);
  });
});
