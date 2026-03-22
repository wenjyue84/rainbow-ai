/**
 * escalation-events.ts — Log escalation events to database (US-428, US-429)
 *
 * Provides fire-and-forget logging of escalation triggers to the
 * escalation_events table for analytics and auditing.
 * US-429: Also triggers warm handoff summary generation after insert.
 */
import { db } from './db.js';
import { escalationEvents } from '../../shared/schema-tables.js';
import { generateAndStoreHandoffSummary } from './handoff-summary.js';

export interface EscalationEventInput {
  jid: string;
  profileId: string;
  trigger: string;
  count?: number;
  metadata?: Record<string, any>;
  /** US-077: Fallback template that preceded this escalation */
  fallbackResponseTemplateId?: string | null;
  /** US-077: True if escalation occurred within 2 user messages of a fallback */
  escalationWithin2Msgs?: boolean;
  /** US-429: Optional context for warm handoff summary generation */
  summaryContext?: {
    guestName: string;
    recentMessages: string[];
    escalationReason: string;
  };
}

/**
 * Log an escalation event to the database (fire-and-forget).
 * Errors are caught and logged but never thrown to avoid blocking the response.
 * US-429: If summaryContext is provided, triggers async LLM summary generation.
 */
export function logEscalationEvent(input: EscalationEventInput): void {
  db.insert(escalationEvents)
    .values({
      jid: input.jid,
      profileId: input.profileId,
      trigger: input.trigger,
      count: input.count ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      fallbackResponseTemplateId: input.fallbackResponseTemplateId ?? null,
      escalationWithin2Msgs: input.escalationWithin2Msgs ?? null,
    })
    .returning({ id: escalationEvents.id })
    .then((rows) => {
      const insertedId = rows[0]?.id;
      console.log(`[EscalationEvents] Logged: trigger=${input.trigger} jid=${input.jid} count=${input.count} id=${insertedId}`);

      // US-429: Trigger warm handoff summary generation
      if (insertedId && input.summaryContext) {
        generateAndStoreHandoffSummary({
          escalationEventId: insertedId,
          guestJid: input.jid,
          guestName: input.summaryContext.guestName,
          recentMessages: input.summaryContext.recentMessages,
          escalationReason: input.summaryContext.escalationReason,
        });
      }
    })
    .catch((err: any) => {
      console.error(`[EscalationEvents] Failed to log event:`, err.message);
    });
}
