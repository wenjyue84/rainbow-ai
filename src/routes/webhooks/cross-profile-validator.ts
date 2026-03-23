/**
 * US-263: Cross-Profile Message Routing Validator Middleware
 *
 * Validates that each incoming message's businessProfile matches the
 * currently-loaded profile from the profile registry / config. Prevents
 * runtime cross-contamination between Pelangi, Makan Moments, and
 * Southern Homestay profiles.
 *
 * This middleware runs at the webhook/entry-point layer — BEFORE the AI
 * pipeline processes the message — and rejects mismatches with a
 * detailed 400 error.
 */

import type { Request, Response, NextFunction } from 'express';
import { profileRegistry } from '../../assistant/profile-registry.js';

/**
 * Result of a cross-profile validation check.
 */
export interface CrossProfileValidationResult {
  valid: boolean;
  /** The profile specified in the incoming message payload */
  messageProfile: string | undefined;
  /** The profile currently loaded by this handler instance */
  handlerProfile: string;
  /** Human-readable error detail (only when valid === false) */
  error?: string;
}

/**
 * Validate that a message's businessProfile matches the expected handler profile.
 *
 * Pure function — no side effects. Used by both the Express middleware and
 * direct callers (tests, programmatic validation).
 *
 * @param messageProfile - The businessProfile field from the incoming message
 * @param handlerProfile - The profile this handler/server instance is configured for
 * @returns Validation result with detailed error on mismatch
 */
export function validateCrossProfile(
  messageProfile: string | undefined,
  handlerProfile: string
): CrossProfileValidationResult {
  // If the message does not carry a businessProfile, skip validation
  // (backwards compatibility — older payloads may not include it)
  if (!messageProfile) {
    return { valid: true, messageProfile, handlerProfile };
  }

  // Normalize both profile identifiers for comparison
  const normalizedMessage = messageProfile.trim().toLowerCase();
  const normalizedHandler = handlerProfile.trim().toLowerCase();

  if (normalizedMessage === normalizedHandler) {
    return { valid: true, messageProfile, handlerProfile };
  }

  return {
    valid: false,
    messageProfile,
    handlerProfile,
    error:
      `Cross-profile routing mismatch: message.businessProfile="${messageProfile}" ` +
      `does not match handler profile="${handlerProfile}". ` +
      `This message was intended for the "${messageProfile}" profile but this handler ` +
      `is serving the "${handlerProfile}" profile. The message has been rejected to ` +
      `prevent cross-contamination between business profiles.`,
  };
}

/**
 * Express middleware factory: validates message.businessProfile against
 * the currently-loaded profile from the profile registry.
 *
 * Reads the body's `businessProfile` (or `business_profile`) field and
 * compares it to the active profile. On mismatch, responds with 400
 * including detailed error information.
 *
 * @param overrideProfileId - Optional fixed profile ID. When omitted,
 *   the middleware reads the default profile from profileRegistry at
 *   request time.
 */
export function crossProfileValidator(overrideProfileId?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as Record<string, unknown> | undefined;

    // Extract businessProfile from payload (support both camelCase and snake_case)
    const messageProfile =
      (body?.businessProfile as string | undefined) ??
      (body?.business_profile as string | undefined);

    // Determine the handler's current profile
    const handlerProfile =
      overrideProfileId ??
      (profileRegistry.isInitialized()
        ? profileRegistry.getDefaultProfileId()
        : 'pelangi');

    const result = validateCrossProfile(messageProfile, handlerProfile);

    if (!result.valid) {
      console.warn(
        `[CrossProfileValidator] Rejected: ${result.error}`
      );

      res.status(400).json({
        error: 'cross_profile_mismatch',
        detail: result.error,
        messageProfile: result.messageProfile,
        handlerProfile: result.handlerProfile,
      });
      return;
    }

    next();
  };
}
