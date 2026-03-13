/**
 * escalation-events.ts — Log escalation events to database (US-428)
 *
 * Provides fire-and-forget logging of escalation triggers to the
 * escalation_events table for analytics and auditing.
 */
import { db } from './db.js';
import { escalationEvents } from '../../shared/schema-tables.js';

export interface EscalationEventInput {
  jid: string;
  profileId: string;
  trigger: string;
  count?: number;
  metadata?: Record<string, any>;
}

/**
 * Log an escalation event to the database (fire-and-forget).
 * Errors are caught and logged but never thrown to avoid blocking the response.
 */
export function logEscalationEvent(input: EscalationEventInput): void {
  db.insert(escalationEvents)
    .values({
      jid: input.jid,
      profileId: input.profileId,
      trigger: input.trigger,
      count: input.count ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    })
    .then(() => {
      console.log(`[EscalationEvents] Logged: trigger=${input.trigger} jid=${input.jid} count=${input.count}`);
    })
    .catch((err: any) => {
      console.error(`[EscalationEvents] Failed to log event:`, err.message);
    });
}
