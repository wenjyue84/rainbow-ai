/**
 * compliance-audit.ts — US-942: WhatsApp task-specific chatbot compliance audit log
 *
 * Records which intent categories handled each conversation for WABA policy review.
 * Fire-and-forget logging — errors are caught and logged, never thrown.
 */
import { db } from './db.js';
import { complianceAuditLog } from '../../shared/schema-tables.js';

/** Intent categories for compliance classification */
const OFF_TOPIC_INTENTS = new Set(['off_topic']);
const ESCALATION_INTENTS = new Set(['contact_staff', 'billing_dispute']);
const ESCALATION_ACTIONS = new Set(['escalate', 'workflow']);

/**
 * Classify an intent into a compliance category.
 * Returns 'off_topic' for out-of-scope requests,
 * 'escalation' for human handoff paths,
 * 'in_scope' for allowed business functions.
 */
export function classifyIntentCategory(
  intent: string,
  routedAction?: string
): 'in_scope' | 'off_topic' | 'escalation' {
  if (OFF_TOPIC_INTENTS.has(intent)) return 'off_topic';
  if (ESCALATION_INTENTS.has(intent)) return 'escalation';
  if (routedAction && ESCALATION_ACTIONS.has(routedAction) && intent.includes('complaint')) return 'in_scope';
  return 'in_scope';
}

export interface ComplianceAuditInput {
  jid: string;
  profileId: string;
  intent: string;
  routedAction?: string;
  confidence?: number;
  userMessage?: string;
}

/**
 * Log a compliance audit entry (fire-and-forget).
 * Errors are caught and logged but never thrown.
 */
export function logComplianceAudit(input: ComplianceAuditInput): void {
  const intentCategory = classifyIntentCategory(input.intent, input.routedAction);

  db.insert(complianceAuditLog)
    .values({
      jid: input.jid,
      profileId: input.profileId,
      intent: input.intent,
      intentCategory,
      routedAction: input.routedAction ?? null,
      confidence: input.confidence ?? null,
      userMessage: input.userMessage ? input.userMessage.slice(0, 200) : null,
    })
    .then(() => {
      if (intentCategory === 'off_topic') {
        console.log(`[ComplianceAudit] Off-topic request logged: jid=${input.jid} intent=${input.intent}`);
      }
    })
    .catch((err: any) => {
      console.error(`[ComplianceAudit] Failed to log:`, err.message);
    });
}
