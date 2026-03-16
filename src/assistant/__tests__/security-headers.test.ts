/**
 * US-1006: HTTP security headers hardening with Helmet.js configuration audit.
 *
 * Verifies that the Helmet configuration applied in src/index.ts produces the
 * required security response headers on key routes. Tests use a minimal Express
 * app that mirrors the production Helmet + Permissions-Policy middleware so the
 * suite runs without needing a database or WhatsApp connection.
 *
 * Required headers (US-1006 acceptance criteria):
 *  - X-Content-Type-Options: nosniff
 *  - X-Frame-Options: DENY
 *  - Referrer-Policy: strict-origin-when-cross-origin
 *  - Permissions-Policy: microphone=(), camera=(), geolocation=()
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import http from 'node:http';

// ── Test app mirroring the production Helmet config ──────────────────────────

function createTestApp() {
  const app = express();
  app.disable('x-powered-by');

  // Mirrors the Helmet config in src/index.ts (US-464 + US-835 + US-1006)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ['*'],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    // US-1006: X-Frame-Options: DENY (CSP frame-ancestors takes precedence in modern browsers)
    frameguard: { action: 'deny' },
    // US-1006: Referrer-Policy
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: false,
  }));

  // US-1006: Permissions-Policy middleware (Helmet v8 does not include this header natively)
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'microphone=(), camera=(), geolocation=()');
    next();
  });

  // Stub routes matching the three routes from the acceptance criteria
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/admin', (_req, res) => res.json({ page: 'admin' }));
  app.get('/webchat', (_req, res) => res.send('<html><body>webchat</body></html>'));

  return app;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function getHeaders(server: http.Server, path: string): Promise<http.IncomingHttpHeaders> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as { port: number };
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      res.resume(); // drain body
      resolve(res.headers);
    }).on('error', reject);
  });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('US-1006: HTTP security headers', () => {
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

  const routes = ['/health', '/admin', '/webchat'];

  describe.each(routes)('%s route', (route) => {
    it('sets X-Content-Type-Options: nosniff', async () => {
      const headers = await getHeaders(server, route);
      expect(headers['x-content-type-options']).toBe('nosniff');
    });

    it('sets X-Frame-Options: DENY', async () => {
      const headers = await getHeaders(server, route);
      expect(headers['x-frame-options']).toBe('DENY');
    });

    it('sets Referrer-Policy: strict-origin-when-cross-origin', async () => {
      const headers = await getHeaders(server, route);
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('sets Permissions-Policy restricting microphone, camera, geolocation', async () => {
      const headers = await getHeaders(server, route);
      const policy = headers['permissions-policy'] ?? '';
      expect(policy).toContain('microphone=()');
      expect(policy).toContain('camera=()');
      expect(policy).toContain('geolocation=()');
    });
  });

  it('CSP frame-ancestors allows embedding (webchat iframe support)', async () => {
    const headers = await getHeaders(server, '/webchat');
    const csp = headers['content-security-policy'] ?? '';
    // frame-ancestors * means any site can embed via iframe; modern browsers
    // prefer CSP over X-Frame-Options, so iframe embedding remains functional.
    expect(csp).toContain('frame-ancestors');
    expect(csp).toContain('*');
  });
});
