/**
 * Prompt Injection Logger (US-998)
 *
 * Persists blocked prompt injection attempts to the prompt_injection_events table.
 * Original message text is PII-redacted before storage.
 * Sends a staff WhatsApp alert when 3+ attempts from the same JID occur within 1 hour.
 */

import { db, dbReady } from './db.js';
import { promptInjectionEvents } from '../../shared/schema-tables.js';
import { redactPii } from '../assistant/pii-redactor.js';
import { notifyAdminInjectionBurst } from './admin-notifier.js';
import { sql, and, gt, eq } from 'drizzle-orm';

const BURST_THRESHOLD = 3;
const BURST_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Log a blocked prompt injection attempt.
 * PII-redacts the message text before DB write.
 * Checks burst threshold and sends admin alert if exceeded.
 */
export async function logPromptInjectionEvent(
  jid: string,
  profileId: string,
  originalText: string,
  matchedPattern: string,
  actionTaken: string = 'blocked'
): Promise<void> {
  const ready = await dbReady;
  if (!ready) return;

  // AC5: PII-redact before DB write
  const { redacted } = redactPii(originalText);

  try {
    await db.insert(promptInjectionEvents).values({
      jid,
      profileId,
      originalMessageText: redacted,
      matchedPattern,
      actionTaken,
    });
  } catch (err: any) {
    console.error('[PromptInjectionLogger] Failed to log event:', err.message);
    return;
  }

  // AC4: Check burst threshold (3+ from same JID within 1 hour)
  try {
    const windowStart = new Date(Date.now() - BURST_WINDOW_MS);
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(promptInjectionEvents)
      .where(and(
        eq(promptInjectionEvents.jid, jid),
        gt(promptInjectionEvents.createdAt, windowStart)
      ));

    const count = Number(countResult?.count ?? 0);
    if (count >= BURST_THRESHOLD) {
      notifyAdminInjectionBurst(jid, profileId, count).catch((err: any) => {
        console.error('[PromptInjectionLogger] Failed to send burst alert:', err.message);
      });
    }
  } catch (err: any) {
    console.error('[PromptInjectionLogger] Failed to check burst threshold:', err.message);
  }
}
