/**
 * Rate Limiter Middleware Tests (US-530)
 *
 * Test suite for token bucket rate limiting with per-profile limits.
 * Tests cover:
 * - Token refill over time
 * - Per-profile bucket isolation
 * - 429 response with Retry-After header
 * - Acceptance criteria: 70 messages in 60 seconds to 60 msg/min profile
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRateLimiter, clearAllBuckets, getBucketState, createProfileRateLimiter } from '../../src/middleware/rate-limiter.js';
import type { Request, Response } from 'express';

/**
 * Mock Express Request object
 */
function createMockRequest(overrides?: Partial<Request>): Request {
  return {
    query: {},
    params: {},
    headers: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

/**
 * Mock Express Response object
 */
function createMockResponse(): Response & { statusCode: number; headers: Record<string, string>; body: any } {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    status: function (code: number) {
      this.statusCode = code;
      return this;
    },
    set: function (key: string, value: string) {
      this.headers[key] = value;
      return this;
    },
    json: function (body: any) {
      this.body = body;
      return this;
    },
  };
  return res as any;
}

describe('Rate Limiter (US-530)', () => {
  beforeEach(() => {
    clearAllBuckets();
  });

  describe('Token Bucket Algorithm', () => {
    it('should allow requests when tokens are available', () => {
      const limiter = createRateLimiter(10);
      const req = createMockRequest({ params: { profileId: 'pelangi' } });
      const res = createMockResponse();
      let nextCalled = false;

      limiter(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBe(200);
    });

    it('should return 429 when tokens exhausted', () => {
      const limiter = createRateLimiter(2);
      const req1 = createMockRequest({ params: { profileId: 'pelangi' } });
      const res1 = createMockResponse();

      const req2 = createMockRequest({ params: { profileId: 'pelangi' } });
      const res2 = createMockResponse();

      const req3 = createMockRequest({ params: { profileId: 'pelangi' } });
      const res3 = createMockResponse();

      // First request should succeed
      let next1Called = false;
      limiter(req1, res1, () => {
        next1Called = true;
      });
      expect(next1Called).toBe(true);
      expect(res1.statusCode).toBe(200);

      // Second request should succeed
      let next2Called = false;
      limiter(req2, res2, () => {
        next2Called = true;
      });
      expect(next2Called).toBe(true);
      expect(res2.statusCode).toBe(200);

      // Third request should be rate limited
      let next3Called = false;
      limiter(req3, res3, () => {
        next3Called = true;
      });
      expect(next3Called).toBe(false);
      expect(res3.statusCode).toBe(429);
    });

    it('should include Retry-After header on 429 response', () => {
      const limiter = createRateLimiter(1);

      // Consume the single token
      const req1 = createMockRequest({ params: { profileId: 'southern' } });
      const res1 = createMockResponse();
      limiter(req1, res1, () => {});
      expect(res1.statusCode).toBe(200);

      // Next request should be rate limited
      const req2 = createMockRequest({ params: { profileId: 'southern' } });
      const res2 = createMockResponse();
      limiter(req2, res2, () => {});

      expect(res2.statusCode).toBe(429);
      expect(res2.headers['Retry-After']).toBeDefined();
      expect(parseInt(res2.headers['Retry-After'])).toBeGreaterThan(0);
    });

    it('should isolate buckets per profile', () => {
      const limiter = createRateLimiter(1);

      // Exhaust tokens for 'pelangi' profile
      const req1 = createMockRequest({ params: { profileId: 'pelangi' } });
      const res1 = createMockResponse();
      limiter(req1, res1, () => {});
      expect(res1.statusCode).toBe(200);

      // Next request to 'pelangi' should be rate limited
      const req2 = createMockRequest({ params: { profileId: 'pelangi' } });
      const res2 = createMockResponse();
      limiter(req2, res2, () => {});
      expect(res2.statusCode).toBe(429);

      // But 'southern' profile should have its own tokens
      const req3 = createMockRequest({ params: { profileId: 'southern' } });
      const res3 = createMockResponse();
      limiter(req3, res3, () => {});
      expect(res3.statusCode).toBe(200);
    });

    it('should refill tokens over time', async () => {
      const limiter = createRateLimiter(10);

      // Consume all 10 tokens
      for (let i = 0; i < 10; i++) {
        const req = createMockRequest({ params: { profileId: 'makan' } });
        const res = createMockResponse();
        limiter(req, res, () => {});
        expect(res.statusCode).toBe(200);
      }

      // Next request should be rate limited
      const reqFull = createMockRequest({ params: { profileId: 'makan' } });
      const resFull = createMockResponse();
      limiter(reqFull, resFull, () => {});
      expect(resFull.statusCode).toBe(429);

      // Verify bucket exists
      const bucket = getBucketState('makan');
      expect(bucket).toBeDefined();

      // Wait 6+ seconds to refill 1 token (60/10 = 6 seconds per token)
      await new Promise((resolve) => setTimeout(resolve, 6100));

      // Now the next request should succeed (1 token refilled)
      const reqAfterRefill = createMockRequest({ params: { profileId: 'makan' } });
      const resAfterRefill = createMockResponse();
      limiter(reqAfterRefill, resAfterRefill, () => {});
      expect(resAfterRefill.statusCode).toBe(200);
    }, 10000);
  });

  describe('Acceptance Criteria: 70 Messages in 60 Seconds', () => {
    it('should accept 60 requests and reject 10 within 1 minute for 60 msg/min limit', () => {
      const limiter = createRateLimiter(60);
      const profileId = 'test-profile';

      let acceptedCount = 0;
      let rejectedCount = 0;

      // Send 70 requests rapidly (simulating 70 messages in 60 seconds)
      for (let i = 0; i < 70; i++) {
        const req = createMockRequest({
          params: { profileId },
          body: { message: `Message ${i + 1}` },
        });
        const res = createMockResponse();
        let nextCalled = false;

        limiter(req, res, () => {
          nextCalled = true;
        });

        if (nextCalled) {
          acceptedCount++;
        } else if (res.statusCode === 429) {
          rejectedCount++;
        }
      }

      // Verify acceptance criteria: 60 accepted, 10 rejected
      expect(acceptedCount).toBe(60);
      expect(rejectedCount).toBe(10);
    });

    it('should set correct Retry-After for rejected messages', () => {
      const limiter = createRateLimiter(60);
      const profileId = 'test-acceptance';

      // Consume all 60 tokens
      for (let i = 0; i < 60; i++) {
        const req = createMockRequest({ params: { profileId } });
        const res = createMockResponse();
        limiter(req, res, () => {});
      }

      // Next request should be rate limited
      const reqRateLimited = createMockRequest({ params: { profileId } });
      const resRateLimited = createMockResponse();
      limiter(reqRateLimited, resRateLimited, () => {});

      expect(resRateLimited.statusCode).toBe(429);
      const retryAfter = parseInt(resRateLimited.headers['Retry-After']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });
  });

  describe('Profile Resolution', () => {
    it('should extract profileId from params', () => {
      const limiter = createRateLimiter(1);

      const req1 = createMockRequest({ params: { profileId: 'pelangi' } });
      const res1 = createMockResponse();
      limiter(req1, res1, () => {});
      expect(res1.statusCode).toBe(200);

      // Same profile should be rate limited
      const req2 = createMockRequest({ params: { profileId: 'pelangi' } });
      const res2 = createMockResponse();
      limiter(req2, res2, () => {});
      expect(res2.statusCode).toBe(429);
    });

    it('should fallback to profile param if profileId not in params', () => {
      const limiter = createRateLimiter(1);

      const req1 = createMockRequest({ params: { profile: 'southern' } });
      const res1 = createMockResponse();
      limiter(req1, res1, () => {});
      expect(res1.statusCode).toBe(200);

      const req2 = createMockRequest({ params: { profile: 'southern' } });
      const res2 = createMockResponse();
      limiter(req2, res2, () => {});
      expect(res2.statusCode).toBe(429);
    });

    it('should extract profileId from query parameter', () => {
      const limiter = createRateLimiter(1);

      const req1 = createMockRequest({ query: { profile: 'makan' } });
      const res1 = createMockResponse();
      limiter(req1, res1, () => {});
      expect(res1.statusCode).toBe(200);

      const req2 = createMockRequest({ query: { profile: 'makan' } });
      const res2 = createMockResponse();
      limiter(req2, res2, () => {});
      expect(res2.statusCode).toBe(429);
    });

    it('should extract profileId from X-Profile-Id header', () => {
      const limiter = createRateLimiter(1);

      const req1 = createMockRequest({ headers: { 'x-profile-id': 'test' } });
      const res1 = createMockResponse();
      limiter(req1, res1, () => {});
      expect(res1.statusCode).toBe(200);

      const req2 = createMockRequest({ headers: { 'x-profile-id': 'test' } });
      const res2 = createMockResponse();
      limiter(req2, res2, () => {});
      expect(res2.statusCode).toBe(429);
    });

    it('should skip rate limiting if no profileId specified', () => {
      const limiter = createRateLimiter(1);

      const req1 = createMockRequest({});
      const res1 = createMockResponse();
      let next1Called = false;
      limiter(req1, res1, () => {
        next1Called = true;
      });
      expect(next1Called).toBe(true);
      expect(res1.statusCode).toBe(200);

      // Without a profileId, each request should pass through
      const req2 = createMockRequest({});
      const res2 = createMockResponse();
      let next2Called = false;
      limiter(req2, res2, () => {
        next2Called = true;
      });
      expect(next2Called).toBe(true);
      expect(res2.statusCode).toBe(200);
    });
  });

  describe('Error Responses', () => {
    it('should return proper JSON error on rate limit', () => {
      const limiter = createRateLimiter(1);

      // Consume token
      const req1 = createMockRequest({ params: { profileId: 'test' } });
      const res1 = createMockResponse();
      limiter(req1, res1, () => {});

      // Rate limit
      const req2 = createMockRequest({ params: { profileId: 'test' } });
      const res2 = createMockResponse();
      limiter(req2, res2, () => {});

      expect(res2.statusCode).toBe(429);
      expect(res2.body).toBeDefined();
      expect(res2.body.error).toBe('Too Many Requests');
      expect(res2.body.message).toContain('Rate limit exceeded');
      expect(res2.body.retryAfter).toBeGreaterThan(0);
    });
  });

  describe('createProfileRateLimiter with custom getRateLimit', () => {
    it('should use custom getRateLimit function', () => {
      const getRateLimit = (profileId: string) => {
        if (profileId === 'vip') return 200;
        if (profileId === 'standard') return 60;
        return 30;
      };

      const limiter = createProfileRateLimiter({ getRateLimit });

      // VIP profile with 200 msg/min
      const vipReq = createMockRequest({ params: { profileId: 'vip' } });
      const vipRes = createMockResponse();
      let vipNext = false;
      limiter(vipReq, vipRes, () => {
        vipNext = true;
      });
      expect(vipNext).toBe(true);

      // Standard profile with 60 msg/min
      const stdReq = createMockRequest({ params: { profileId: 'standard' } });
      const stdRes = createMockResponse();
      let stdNext = false;
      limiter(stdReq, stdRes, () => {
        stdNext = true;
      });
      expect(stdNext).toBe(true);
    });

    it('should skip rate limiting if getRateLimit returns 0 or undefined', () => {
      const getRateLimit = (profileId: string) => {
        return profileId === 'unlimited' ? undefined : 1;
      };

      const limiter = createProfileRateLimiter({ getRateLimit });

      // Unlimited profile should skip rate limiting
      for (let i = 0; i < 5; i++) {
        const req = createMockRequest({ params: { profileId: 'unlimited' } });
        const res = createMockResponse();
        let nextCalled = false;
        limiter(req, res, () => {
          nextCalled = true;
        });
        expect(nextCalled).toBe(true);
      }
    });
  });
});
