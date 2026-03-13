/**
 * Tests for US-504: Error response security hardening.
 *
 * Verifies that:
 * - x-powered-by header is absent
 * - Error responses never leak stack traces, file paths, or secrets
 * - 404 responses don't reveal the requested path
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'node:http';

/** Spin up a minimal Express app with the same security patterns as src/index.ts */
function createTestApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  // Route that succeeds
  app.get('/ok', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Route that throws an internal error with sensitive info
  app.get('/throw', () => {
    const err = new Error('ECONNREFUSED: connect to C:\\Users\\dev\\secrets.json failed — DATABASE_KEY=abc123');
    (err as any).stack = 'Error: fail\n    at Object.<anonymous> (/var/www/rainbow-ai/src/lib/db.ts:42:11)\n    at Module._compile (node:internal/modules/cjs/loader:1241:14)';
    throw err;
  });

  // 404 handler — same as src/index.ts
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler — same as src/index.ts
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    console.error('[ErrorHandler]', err);
    const status = typeof err.status === 'number' ? err.status : 500;
    res.status(status).json({ error: 'Internal server error' });
  });

  return app;
}

/** Helper: make an HTTP request to the test server */
function request(server: http.Server, path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
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

describe('US-504: Error response security', () => {
  let server: http.Server;

  beforeEach(async () => {
    const app = createTestApp();
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    // Suppress expected console.error from the error handler during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});

    return () => {
      vi.restoreAllMocks();
      server.close();
    };
  });

  it('does not include x-powered-by header in responses', async () => {
    const res = await request(server, '/ok');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.status).toBe(200);
  });

  it('returns generic 404 without revealing the requested path', async () => {
    const res = await request(server, '/secret-admin-panel/config');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    // Must not contain the path
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('secret-admin-panel');
    expect(bodyStr).not.toContain('/config');
  });

  it('returns generic error without leaking stack trace or err.message', async () => {
    const res = await request(server, '/throw');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    const bodyStr = JSON.stringify(res.body);
    // Must not contain any sensitive information
    expect(bodyStr).not.toContain('ECONNREFUSED');
    expect(bodyStr).not.toContain('secrets.json');
    expect(bodyStr).not.toContain('DATABASE_KEY');
    expect(bodyStr).not.toContain('C:\\Users');
    expect(bodyStr).not.toContain('/var/www');
    expect(bodyStr).not.toContain('at Object');
    expect(bodyStr).not.toContain('.ts:');
  });

  it('logs full error server-side for debugging', async () => {
    await request(server, '/throw');
    expect(console.error).toHaveBeenCalledWith(
      '[ErrorHandler]',
      expect.objectContaining({ message: expect.stringContaining('ECONNREFUSED') })
    );
  });
});
