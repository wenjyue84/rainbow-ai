/**
 * Pipeline Middleware: Route Validation
 *
 * Validates that incoming messages route to the correct profile and enforces
 * strict business profile separation. Logs violations to the audit trail for
 * investigation of cross-profile contamination.
 *
 * Profile separation is enforced at the conversation level:
 * - A phone number's first message establishes the profile association
 * - Subsequent messages from the same phone must arrive on the same profile
 * - Messages arriving on a different profile trigger a routing violation
 */

import type { PipelineState } from '../types.js';
import { pool } from '../../../lib/db.js';

/**
 * Routing violation event logged to audit trail
 */
export interface RoutingViolation {
  senderId: string;           // Phone number
  intendedProfile: string;    // Expected profile for this conversation
  actualProfile: string;      // Profile message actually arrived on
  timestamp: number;          // Unix ms
}

/**
 * Check if the message's resolved profile matches the conversation's profile.
 *
 * If a conversation exists for this phone with an established profileId,
 * the incoming message's profileId must match it. If they don't match,
 * it's a cross-profile routing violation.
 *
 * Returns null if valid, or a RoutingViolation if invalid.
 *
 * @param phone - Sender's phone number
 * @param incomingProfileId - Profile resolved from message's instanceId
 * @param conversationProfileId - Profile associated with existing conversation (if any)
 * @returns RoutingViolation if mismatch, null if valid
 */
export function validateRouting(
  phone: string,
  incomingProfileId: string,
  conversationProfileId: string | undefined
): RoutingViolation | null {
  // If no existing conversation or conversation has no profileId, this is first contact — always valid
  if (!conversationProfileId) {
    return null;
  }

  // If profiles match, valid
  if (incomingProfileId === conversationProfileId) {
    return null;
  }

  // Profiles mismatch — return violation
  return {
    senderId: phone,
    intendedProfile: conversationProfileId,
    actualProfile: incomingProfileId,
    timestamp: Date.now(),
  };
}

/**
 * Log a routing violation to the audit trail.
 *
 * Appends to rainbow_config_audit with:
 * - action: 'cross_profile_routing'
 * - changed_by: sender_id (phone)
 * - after_json: violation details with sender_id, intended_profile, actual_profile
 *
 * Errors are logged but don't throw (fire-and-forget).
 *
 * @param violation - Routing violation details
 */
export async function logRoutingViolation(violation: RoutingViolation): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn('[RoutingValidator] No DATABASE_URL — audit logging skipped');
    return;
  }

  try {
    await pool.query(
      `INSERT INTO rainbow_config_audit (action, changed_by, after_json, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [
        'cross_profile_routing',
        violation.senderId,
        JSON.stringify({
          sender_id: violation.senderId,
          intended_profile: violation.intendedProfile,
          actual_profile: violation.actualProfile,
        }),
      ]
    );
    console.warn(
      `[RoutingValidator] ⚠️  Cross-profile routing detected: ` +
      `${violation.senderId} attempted ${violation.actualProfile} ` +
      `but conversation is on ${violation.intendedProfile}`
    );
  } catch (err: any) {
    console.error(
      '[RoutingValidator] Failed to log routing violation:',
      err.message
    );
  }
}

/**
 * Middleware: Validate message routing against conversation profile.
 *
 * Checks if the incoming message's profile matches the conversation's
 * established profile. If a mismatch is detected:
 * 1. Logs violation to audit trail
 * 2. Returns rejection result to halt further pipeline processing
 *
 * @param state - Pipeline state with resolved profileId and convo
 * @returns {continue: false, reason} if routing violation, null if valid
 */
export async function validateMessageRouting(
  state: PipelineState
): Promise<{ continue: false; reason: string } | null> {
  const { phone, profileId, convo } = state;

  // Check if conversation has an established profile
  // Use validateRouting helper to check for mismatch
  const violation = validateRouting(phone, profileId, convo.profileId);

  if (violation) {
    // Log the violation to audit trail (fire-and-forget)
    logRoutingViolation(violation).catch(() => {});

    // Reject the message
    return {
      continue: false,
      reason: 'cross_profile_routing'
    };
  }

  // Routing is valid
  return null;
}
