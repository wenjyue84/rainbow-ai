/**
 * webhook-signature.ts — HMAC-SHA256 signature validation middleware
 *
 * Validates inbound webhook requests using X-Hub-Signature-256 header,
 * matching Meta's Cloud API signature scheme exactly.
 *
 * US-442: Implement webhook signature validation for inbound admin API calls
 */

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// ─── rawBody capture ────────────────────────────────────────────────────────
// Attach the raw request buffer to req so the HMAC middleware can read it.
// Must be registered as the `verify` callback in express.json() options BEFORE
// body parsing runs, so req.rawBody is available to downstream middleware.
export function captureRawBody(
  req: Request & { rawBody?: Buffer },
  _res: Response,
  buf: Buffer
): void {
  req.rawBody = buf;
}

// ─── Middleware factory ─────────────────────────────────────────────────────

/**
 * Returns an Express middleware that validates X-Hub-Signature-256.
 *
 * If WEBHOOK_SECRET is not set, logs a startup warning (once) and skips
 * validation (permissive mode) so existing flows aren't broken in dev.
 *
 * @param secret  Shared secret string.  Pass `process.env.WEBHOOK_SECRET ?? ''`
 *                at route registration time so the warning fires at startup.
 */
export function validateWebhookSignature(
  secret: string
): (req: Request, res: Response, next: NextFunction) => void {
  if (!secret) {
    console.warn(
      '[webhook-signature] WARNING: WEBHOOK_SECRET is not set. ' +
        'Signature validation is DISABLED — all inbound webhooks are accepted. ' +
        'Set WEBHOOK_SECRET in your environment to enable HMAC verification.'
    );
    // Return a pass-through middleware when no secret configured
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  return (req: Request & { rawBody?: Buffer }, res: Response, next: NextFunction): void => {
    const sigHeader = req.headers['x-hub-signature-256'];

    if (!sigHeader || typeof sigHeader !== 'string') {
      res.status(401).json({ error: 'Missing X-Hub-Signature-256 header' });
      return;
    }

    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      // This happens if captureRawBody was not wired into express.json()
      res.status(400).json({ error: 'Request body not available for signature check' });
      return;
    }

    // Compute expected signature
    const expectedSig = 'sha256=' +
      crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    // Timing-safe comparison to prevent timing attacks
    const sigBuf = Buffer.from(sigHeader);
    const expectedBuf = Buffer.from(expectedSig);

    if (
      sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    next();
  };
}

// ─── Meta Cloud API signature validation (US-844) ────────────────────────────

/**
 * Returns an Express middleware that validates X-Hub-Signature-256 for
 * Meta Cloud API webhook events using META_APP_SECRET.
 *
 * Differences from the general validateWebhookSignature:
 *  - Uses META_APP_SECRET env var (Meta's own app secret)
 *  - Returns HTTP 403 on rejection (not 401)
 *  - Logs rejections at WARN level with source IP
 *
 * If META_APP_SECRET is not set, validation is skipped with a startup WARNING.
 */
export function validateMetaSignature(
  secret: string
): (req: Request, res: Response, next: NextFunction) => void {
  if (!secret) {
    console.warn(
      '[webhook-signature] WARNING: META_APP_SECRET is not set. ' +
        'Meta webhook signature validation is DISABLED — all inbound Meta webhooks are accepted. ' +
        'Set META_APP_SECRET in your environment to enable HMAC verification.'
    );
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  return (req: Request & { rawBody?: Buffer }, res: Response, next: NextFunction): void => {
    const sigHeader = req.headers['x-hub-signature-256'];
    const sourceIp = req.ip || req.socket?.remoteAddress || 'unknown';

    if (!sigHeader || typeof sigHeader !== 'string') {
      console.warn(
        `[webhook-signature:meta] REJECTED: Missing X-Hub-Signature-256 header from IP=${sourceIp}`
      );
      res.status(403).json({ error: 'Missing X-Hub-Signature-256 header' });
      return;
    }

    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      console.warn(
        `[webhook-signature:meta] REJECTED: No raw body available for signature check from IP=${sourceIp}`
      );
      res.status(403).json({ error: 'Request body not available for signature check' });
      return;
    }

    // Compute expected HMAC-SHA256 signature
    const expectedSig = 'sha256=' +
      crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    // Constant-time comparison to prevent timing attacks
    const sigBuf = Buffer.from(sigHeader);
    const expectedBuf = Buffer.from(expectedSig);

    if (
      sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      console.warn(
        `[webhook-signature:meta] REJECTED: Invalid signature from IP=${sourceIp}`
      );
      res.status(403).json({ error: 'Invalid webhook signature' });
      return;
    }

    next();
  };
}
