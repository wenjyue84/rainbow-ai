/**
 * handoff-summary.ts — Generate AI warm handoff summaries for escalations (US-429)
 *
 * When a conversation escalates to a human agent, generates a 3-5 sentence
 * summary of the conversation context so the agent doesn't need to read
 * the full thread. Summary generation is non-fatal — escalation proceeds
 * even if the LLM call fails.
 */
import { db, pool } from './db.js';
import { escalationEvents } from '../../shared/schema-tables.js';
import { chat } from '../assistant/ai-response-generator.js';
import { eq } from 'drizzle-orm';

// Ensure summary column exists (idempotent migration)
pool.query(`ALTER TABLE escalation_events ADD COLUMN IF NOT EXISTS summary TEXT`).catch(() => {});

// US-914: Summary must be ≤150 words (AC2 requirement)
const SUMMARY_SYSTEM_PROMPT = `You are a concise conversation summarizer for a hostel customer service team.
Given a conversation between a guest and an AI assistant, write a summary for the human agent who will take over.

Include:
- What the guest wants or their issue
- Key details mentioned (dates, room types, number of guests, etc.)
- The reason for escalation
- Any promises or information already provided by the bot

Rules:
- Maximum 150 words — do not exceed this limit
- Be factual and brief
- Do not include greetings or filler
- Write in English`;

export interface HandoffSummaryInput {
  escalationEventId: number;
  guestJid: string;
  guestName: string;
  recentMessages: string[];
  escalationReason: string;
}

/**
 * Generate a warm handoff summary and store it in the escalation_events row.
 * Fire-and-forget — errors are logged but never thrown.
 */
export function generateAndStoreHandoffSummary(input: HandoffSummaryInput): void {
  setImmediate(() => {
    _generateSummary(input).catch((err: any) => {
      console.error(`[HandoffSummary] Failed to generate summary for escalation ${input.escalationEventId}:`, err.message);
    });
  });
}

async function _generateSummary(input: HandoffSummaryInput): Promise<void> {
  const { escalationEventId, guestJid, guestName, recentMessages, escalationReason } = input;

  // Build the user message with conversation context
  const last10 = recentMessages.slice(-10);
  const userMessage = [
    `Guest: ${guestName || 'Unknown'} (${guestJid})`,
    `Escalation reason: ${escalationReason}`,
    ``,
    `Conversation (last ${last10.length} messages):`,
    ...last10,
  ].join('\n');

  try {
    const summary = await chat(SUMMARY_SYSTEM_PROMPT, [], userMessage);

    if (summary && summary.trim()) {
      await db.update(escalationEvents)
        .set({ summary: summary.trim() })
        .where(eq(escalationEvents.id, escalationEventId));
      console.log(`[HandoffSummary] Stored summary for escalation ${escalationEventId} (${summary.length} chars)`);
    }
  } catch (err: any) {
    // Non-fatal — escalation already proceeded
    console.error(`[HandoffSummary] LLM call failed for escalation ${escalationEventId}:`, err.message);
  }
}
