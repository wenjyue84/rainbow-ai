/**
 * Per-Profile Token Bucket Rate Limiter Middleware (US-530)
 *
 * Implements per-profile message rate limiting using a token bucket algorithm.
 * Configuration is loaded from src/assistant/data/settings.json under the
 * rateLimitPerMin field.
 *
 * Returns HTTP 429 (Too Many Requests) with Retry-After header when tokens are exhausted.
 * Each profile gets its own independent token bucket keyed by profileId.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Token bucket state for a profile */
interface TokenBucket {
  tokens: number;
  lastRefillTime: number;
}

/** Configuration for the profile rate limiter */
export interface ProfileRateLimiterConfig {
  /**
   * Returns the rate limit (tokens/min) for a given profileId.
   * Return 0 or undefined to disable rate limiting for that profile.
   */
  getRateLimit: (profileId: string) => number | undefined;
}

/**
 * In-memory store for token buckets, keyed by profile ID.
 * Maps profile_id -> TokenBucket
 */
const buckets = new Map<string, TokenBucket>();

/**
 * Get or initialize a token bucket for a profile.
 * Tokens are refilled continuously based on elapsed time since last request.
 */
function getOrCreateBucket(profileId: string, tokensPerMin: number): TokenBucket {
  let bucket = buckets.get(profileId);

  if (!bucket) {
    bucket = {
      tokens: tokensPerMin,
      lastRefillTime: Date.now(),
    };
    buckets.set(profileId, bucket);
    return bucket;
  }

  // Refill tokens based on elapsed time (continuous refill)
  const now = Date.now();
  const elapsedMs = now - bucket.lastRefillTime;
  const elapsedMinutes = elapsedMs / (60 * 1000);
  const tokensToAdd = elapsedMinutes * tokensPerMin;

  bucket.tokens = Math.min(tokensPerMin, bucket.tokens + tokensToAdd);
  bucket.lastRefillTime = now;

  return bucket;
}

/**
 * Try to consume a token from the bucket.
 * Returns true if a token was consumed, false if the bucket is empty.
 */
function tryConsumeToken(bucket: TokenBucket): boolean {
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
}

/**
 * Calculate seconds until the next token will be available.
 * Used for the Retry-After response header.
 */
function getRetryAfterSeconds(tokensPerMin: number): number {
  const tokensPerSecond = tokensPerMin / 60;
  return Math.ceil(1 / tokensPerSecond);
}

/**
 * Create a per-profile rate limiter middleware using token bucket algorithm.
 *
 * Extracts profileId from req.params.profileId (the standard route param).
 * Each profile maintains its own independent token bucket.
 *
 * Usage:
 * ```ts
 * const limiter = createProfileRateLimiter({
 *   getRateLimit: (profileId) => settings.rate_limits.rateLimitPerMin ?? 60,
 * });
 * router.post('/:profileId/message', limiter, handler);
 * ```
 */
export function createProfileRateLimiter(config: ProfileRateLimiterConfig): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Extract profileId — prefer route param :profileId, then query, then header
    const profileId =
      (req.params.profileId as string | undefined) ||
      (req.params.profile as string | undefined) ||
      (req.query.profile as string | undefined) ||
      (req.headers['x-profile-id'] as string | undefined);

    if (!profileId) {
      // No profile context — skip rate limiting
      next();
      return;
    }

    const rateLimitPerMin = config.getRateLimit(profileId);

    if (!rateLimitPerMin || rateLimitPerMin <= 0) {
      // No limit configured for this profile — skip
      next();
      return;
    }

    const bucket = getOrCreateBucket(profileId, rateLimitPerMin);

    if (tryConsumeToken(bucket)) {
      next();
      return;
    }

    // Tokens exhausted — return 429 with Retry-After
    const retryAfter = getRetryAfterSeconds(rateLimitPerMin);
    res
      .status(429)
      .set('Retry-After', String(retryAfter))
      .json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded for profile "${profileId}". Limit: ${rateLimitPerMin} messages/minute.`,
        retryAfter,
      });
  };
}

/**
 * Convenience factory that reads rateLimitPerMin from settings.json rate_limits.
 * Applies the same limit to all profiles (each with its own bucket).
 *
 * @param rateLimitPerMin  Default tokens per minute (from settings.json)
 */
export function createRateLimiter(rateLimitPerMin: number): RequestHandler {
  return createProfileRateLimiter({
    getRateLimit: () => rateLimitPerMin,
  });
}

// ─── Test / Debug Helpers ────────────────────────────────────────────────────

/** Clear all token buckets — for testing only. */
export function clearAllBuckets(): void {
  buckets.clear();
}

/** Get current bucket state for a profile — for testing/debugging. */
export function getBucketState(profileId: string): TokenBucket | undefined {
  return buckets.get(profileId);
}

export default createProfileRateLimiter;
