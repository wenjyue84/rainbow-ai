/**
 * Unit tests for Per-Profile Token Bucket Rate Limiter (US-530)
 *
 * Tests that the token bucket correctly allows up to rateLimitPerMin requests
 * and returns 429 with Retry-After header for excess requests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import type { Request, Response } from 'express';
import request from 'supertest';
import {
  createProfileRateLimiter,
  createRateLimiter,
  clearAllBuckets,
  getBucketState,
} from '../../../src/middleware/rate-limiter.js';

// ─── Test App Factory ────────────────────────────────────────────────────────

function makeApp(rateLimitPerMin: number) {
  const app = express();
  app.use(express.json());

  const limiter = createProfileRateLimiter({
    getRateLimit: () => rateLimitPerMin,
  });

  app.post('/:profileId/message', limiter, (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Token Bucket Rate Limiter', () => {
  beforeEach(() => {
    clearAllBuckets();
  });

  it('allows requests up to the configured limit', async () => {
    const app = makeApp(5);

    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/test-profile/message').send({});
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 when limit is exceeded', async () => {
    const app = makeApp(5);

    // Exhaust the bucket
    for (let i = 0; i < 5; i++) {
      await request(app).post('/test-profile/message').send({});
    }

    // Next request should be rejected
    const res = await request(app).post('/test-profile/message').send({});
    expect(res.status).toBe(429);
  });

  it('includes Retry-After header on 429 response', async () => {
    const app = makeApp(60);

    // Exhaust the bucket
    for (let i = 0; i < 60; i++) {
      await request(app).post('/pelangi/message').send({});
    }

    const res = await request(app).post('/pelangi/message').send({});
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('US-530 acceptance: 70 messages with 60/min limit — 10 return 429', async () => {
    const RATE_LIMIT = 60;
    const TOTAL_MESSAGES = 70;
    const EXPECTED_REJECTIONS = 10;

    const app = makeApp(RATE_LIMIT);

    let allowed = 0;
    let rejected = 0;

    for (let i = 0; i < TOTAL_MESSAGES; i++) {
      const res = await request(app).post('/test-profile/message').send({ message: `msg-${i}` });
      if (res.status === 200) {
        allowed++;
      } else if (res.status === 429) {
        rejected++;
      }
    }

    expect(allowed).toBe(RATE_LIMIT);
    expect(rejected).toBe(EXPECTED_REJECTIONS);
  });

  it('maintains separate buckets per profile', async () => {
    const app = makeApp(2);

    // Profile A: exhaust its bucket
    await request(app).post('/profile-a/message').send({});
    await request(app).post('/profile-a/message').send({});
    const rejectedA = await request(app).post('/profile-a/message').send({});
    expect(rejectedA.status).toBe(429);

    // Profile B: still has tokens
    const allowedB = await request(app).post('/profile-b/message').send({});
    expect(allowedB.status).toBe(200);
  });

  it('skips rate limiting when no profileId is present', async () => {
    const app = express();
    app.use(express.json());

    // Route without :profileId param
    const limiter = createProfileRateLimiter({ getRateLimit: () => 1 });
    app.post('/message', limiter, (_req: Request, res: Response) => {
      res.status(200).json({ ok: true });
    });

    // Should never be rate limited (no profileId)
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/message').send({});
      expect(res.status).toBe(200);
    }
  });

  it('skips rate limiting when getRateLimit returns undefined', async () => {
    const app = express();
    app.use(express.json());

    const limiter = createProfileRateLimiter({ getRateLimit: () => undefined });
    app.post('/:profileId/message', limiter, (_req: Request, res: Response) => {
      res.status(200).json({ ok: true });
    });

    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/test/message').send({});
      expect(res.status).toBe(200);
    }
  });

  it('createRateLimiter convenience factory works correctly', async () => {
    const app = express();
    app.use(express.json());

    const limiter = createRateLimiter(3);
    app.post('/:profileId/message', limiter, (_req: Request, res: Response) => {
      res.status(200).json({ ok: true });
    });

    const results = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/test/message').send({});
      results.push(res.status);
    }

    expect(results.filter(s => s === 200).length).toBe(3);
    expect(results.filter(s => s === 429).length).toBe(2);
  });

  it('getBucketState returns current token count', async () => {
    const app = makeApp(10);

    await request(app).post('/bucket-test/message').send({});
    await request(app).post('/bucket-test/message').send({});

    const state = getBucketState('bucket-test');
    expect(state).toBeDefined();
    // tokens should be close to 8 (10 - 2 consumed), allowing for tiny time-based refill
    expect(state!.tokens).toBeCloseTo(8, 0);
  });
});
