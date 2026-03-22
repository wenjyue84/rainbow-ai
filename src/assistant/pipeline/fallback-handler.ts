/**
 * Fallback Handler (US-077)
 *
 * Tracks which fallback template was sent per JID and how many user messages
 * have been received since, enabling escalation correlation metrics.
 *
 * Usage:
 *   1. Call onUserMessageReceived(jid) at the start of each message cycle.
 *   2. Call recordFallbackUsed(jid, templateId) when a fallback response is sent.
 *   3. Call getFallbackCorrelation(jid) when logging an escalation event.
 */

interface FallbackEntry {
  templateId: string;
  msgsSinceFallback: number; // user messages received after fallback was sent
}

// In-memory per-JID fallback tracking (cleared after 2 user messages)
const fallbackTracker = new Map<string, FallbackEntry>();

/**
 * Increment the "messages since fallback" counter for this JID.
 * Call at the start of each user message processing cycle.
 * If counter exceeds 2, the entry is removed (no longer correlatable).
 */
export function onUserMessageReceived(jid: string): void {
  const entry = fallbackTracker.get(jid);
  if (entry) {
    entry.msgsSinceFallback++;
    if (entry.msgsSinceFallback > 2) {
      fallbackTracker.delete(jid);
    }
  }
}

/**
 * Record that a fallback response was sent for this JID.
 * Resets the counter so subsequent escalations can be correlated.
 */
export function recordFallbackUsed(jid: string, templateId: string): void {
  fallbackTracker.set(jid, { templateId, msgsSinceFallback: 0 });
}

/**
 * Returns fallback correlation data for escalation logging.
 * within2Msgs is true if an escalation happened within 2 user messages
 * after a fallback response was sent.
 */
export function getFallbackCorrelation(jid: string): {
  templateId: string | null;
  within2Msgs: boolean;
} {
  const entry = fallbackTracker.get(jid);
  if (!entry) return { templateId: null, within2Msgs: false };
  return { templateId: entry.templateId, within2Msgs: entry.msgsSinceFallback <= 2 };
}

/** Clear tracking for a JID (e.g. on conversation reset). */
export function clearFallbackTracking(jid: string): void {
  fallbackTracker.delete(jid);
}
