/**
 * routing-audit.ts — Message Routing Integrity Audit Middleware (US-343)
 *
 * Logs every message routing decision to the routing_audit_logs table so that
 * cross-profile contamination can be detected and investigated in real-time.
 *
 * Fields logged per message:
 *   - message_id       — unique request ID
 *   - phone            — sender JID (masked in logs, stored in DB)
 *   - source_profile   — profile resolved from the incoming instanceId
 *   - target_profile   — profile the classifier routed the intent to
 *   - classifier_match_result — intent label returned by classifier
 *   - classifier_confidence   — confidence score (0.0–1.0)
 *   - is_violation     — true when source_profile !== target_profile
 */

import { db } from '../../lib/db.js';
import { routingAuditLogs } from '../../../shared/schema-tables.js';
import { createModuleLogger } from '../../lib/logger.js';

const logger = createModuleLogger('RoutingAudit');

export interface RoutingDecision {
  messageId: string;
  phone: string;
  sourceProfile: string;
  targetProfile: string;
  classifierMatchResult?: string | null;
  classifierConfidence?: number | null;
}

/**
 * Log a message routing decision to the audit table.
 * A violation is recorded whenever sourceProfile !== targetProfile.
 * Errors are silently swallowed so audit logging never breaks the hot path.
 */
export async function logRoutingDecision(decision: RoutingDecision): Promise<void> {
  const isViolation = decision.sourceProfile !== decision.targetProfile;

  if (isViolation) {
    logger.warn(
      `Cross-profile routing: msg=${decision.messageId} ` +
      `source=${decision.sourceProfile} target=${decision.targetProfile} ` +
      `intent=${decision.classifierMatchResult ?? 'unknown'} ` +
      `confidence=${decision.classifierConfidence ?? 'n/a'}`
    );
  }

  try {
    await db.insert(routingAuditLogs).values({
      messageId: decision.messageId,
      phone: decision.phone,
      sourceProfile: decision.sourceProfile,
      targetProfile: decision.targetProfile,
      classifierMatchResult: decision.classifierMatchResult ?? null,
      classifierConfidence: decision.classifierConfidence ?? null,
      isViolation,
    });
  } catch (err: any) {
    // Fire-and-forget — never let audit logging break message processing
    logger.error(`Failed to log routing decision: ${err.message}`);
  }
}
