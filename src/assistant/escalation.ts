import type { EscalationContext, EscalationReason, EscalationTracker, SendMessageFn } from './types.js';
import { getTemplate } from './formatter.js';
import { configStore } from './config-store.js';
import { updateSlots } from './conversation.js';
import { updateConversationMode } from './conversation-logger.js';
import { logEscalationEvent } from '../lib/escalation-events.js';
import { pool } from '../lib/db.js';

let sendMessageFn: SendMessageFn | null = null;

// Track pending escalations: guestPhone -> tracker
const pendingEscalations = new Map<string, EscalationTracker>();

// ─── Handoff Event Log (US-410) ─────────────────────────────────────
export interface HandoffEvent {
  phone: string;
  reason: EscalationReason | string;
  historyLength: number;
  triggeredAt: number;      // Unix ms
  resolvedAt: number | null; // Unix ms, set when staff resolves
}

const handoffLog: HandoffEvent[] = [];

export function getHandoffLog(): HandoffEvent[] {
  return handoffLog;
}

export function initEscalation(sendMessage: SendMessageFn): void {
  sendMessageFn = sendMessage;
}

export function destroyEscalation(): void {
  // Clear all timers on shutdown
  for (const tracker of pendingEscalations.values()) {
    if (tracker.timer) clearTimeout(tracker.timer);
  }
  pendingEscalations.clear();
}

/**
 * Fetch last N messages from rainbow_messages for a given phone number.
 * Returns formatted strings like "user: hello" / "assistant: hi there".
 * Falls back to empty array on DB error.
 */
async function fetchLastDbMessages(phone: string, limit: number): Promise<string[]> {
  try {
    const result = await pool.query(
      `SELECT role, content FROM rainbow_messages
       WHERE phone = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [phone, limit]
    );
    // Reverse so oldest is first (chronological order)
    return (result.rows as Array<{ role: string; content: string }>)
      .reverse()
      .map(r => `${r.role}: ${r.content}`);
  } catch (err: any) {
    console.warn('[Escalation] Failed to fetch DB messages for handoff, using in-memory:', err.message);
    return [];
  }
}

export async function escalateToStaff(context: EscalationContext): Promise<string> {
  if (!sendMessageFn) {
    console.error('[Escalation] sendMessage not initialized');
    return getTemplate('error', 'en');
  }

  const esc = configStore.getWorkflow().escalation;

  const reasonLabels: Record<EscalationReason, string> = {
    human_request: 'Guest requested human assistance',
    complaint: 'Guest complaint',
    unknown_repeated: 'Bot unable to understand (3+ attempts)',
    group_booking: 'Group booking request (5+ guests)',
    error: 'System error during conversation',
    config_error: 'Configuration error (missing route/workflow)'
  };

  const label = reasonLabels[context.reason] || 'Unknown reason';

  // US-813: Fetch last 5 messages from DB; fallback to in-memory slice
  const dbMessages = await fetchLastDbMessages(context.phone, 5);
  const historyMessages = dbMessages.length > 0
    ? dbMessages
    : context.recentMessages.slice(-5);
  const recentMsgs = historyMessages.map(m => `> ${m}`).join('\n');

  // US-813: Build admin panel deep-link
  const adminBaseUrl = (process.env.DIGIMAN_API_URL || process.env.PELANGI_API_URL || '').replace(/\/+$/, '');
  const profileId = context.profileId || 'pelangi';
  const deepLink = adminBaseUrl
    ? `${adminBaseUrl}/admin#conversations?profileId=${profileId}&phone=${context.phone}`
    : '';

  // US-813: Include trigger detail (intent/keyword) if provided
  const triggerLine = context.triggerDetail
    ? `*Trigger:* ${context.triggerDetail}`
    : '';

  const staffMessage = [
    `*[ESCALATION — BOT PAUSED]* ${label}`,
    ``,
    `*Guest:* ${context.pushName} (+${context.phone})`,
    `*Reason:* ${label}`,
    triggerLine,
    `*Last message:* ${context.originalMessage}`,
    deepLink ? `*View conversation:* ${deepLink}` : '',
    ``,
    `*Conversation history (last ${historyMessages.length}):*`,
    recentMsgs,
    ``,
    `_Bot is paused for this guest. Reply !resolve ${context.phone} to resume AI._`
  ].filter(line => line !== '').join('\n');

  // US-410: Set conversation to manual mode (freeze bot)
  updateSlots(context.phone, { responseMode: 'manual' });
  updateConversationMode(context.phone, 'manual').catch(() => { });
  console.log(`[Handoff] Bot paused for ${context.phone} — reason: ${context.reason}`);

  // US-410: Log handoff event
  handoffLog.push({
    phone: context.phone,
    reason: context.reason,
    historyLength: historyMessages.length,
    triggeredAt: Date.now(),
    resolvedAt: null
  });

  // US-429: Log escalation event with summary context for warm handoff
  logEscalationEvent({
    jid: context.phone,
    profileId: 'pelangi',
    trigger: context.reason,
    metadata: context.metadata,
    summaryContext: {
      guestName: context.pushName,
      recentMessages: historyMessages.map(m => m),
      escalationReason: label,
    },
  });

  // US-410: Send holding message to guest
  try {
    await sendMessageFn(context.phone, "I've connected you with our team, they will respond shortly.", context.instanceId);
  } catch (err: any) {
    console.error('[Handoff] Failed to send holding message:', err.message);
  }

  // Step 1: Send to primary (Alston)
  try {
    await sendMessageFn(esc.primary_phone, staffMessage, context.instanceId);
    console.log(`[Escalation] Forwarded to primary (${esc.primary_phone}): ${context.reason} from +${context.phone}`);
  } catch (err: any) {
    console.error('[Escalation] Failed to forward to primary:', err.message);
  }

  // Step 2: Set timer for secondary fallback
  const existing = pendingEscalations.get(context.phone);
  if (existing?.timer) clearTimeout(existing.timer);

  const timer = setTimeout(async () => {
    try {
      const currentEsc = configStore.getWorkflow().escalation;
      const fallbackMsg = [
        `*[ESCALATION — FOLLOW-UP]* ${label}`,
        ``,
        `Primary was notified ${Math.round(currentEsc.timeout_ms / 60000)} minutes ago — no response yet.`,
        ``,
        `*Guest:* ${context.pushName} (+${context.phone})`,
        `*Reason:* ${label}`,
        triggerLine,
        `*Last message:* ${context.originalMessage}`,
        deepLink ? `*View conversation:* ${deepLink}` : '',
        ``,
        `*Recent conversation:*`,
        recentMsgs
      ].filter(line => line !== '').join('\n');

      if (sendMessageFn) {
        await sendMessageFn(currentEsc.secondary_phone, fallbackMsg, context.instanceId);
        console.log(`[Escalation] Fallback to secondary (${currentEsc.secondary_phone}): ${context.reason} from +${context.phone}`);
      }

      const tracker = pendingEscalations.get(context.phone);
      if (tracker) tracker.secondaryNotified = true;
    } catch (err: any) {
      console.error('[Escalation] Failed to forward to secondary (fallback):', err.message);
    }
  }, esc.timeout_ms);

  pendingEscalations.set(context.phone, {
    guestPhone: context.phone,
    guestName: context.pushName,
    reason: context.reason,
    primaryNotifiedAt: Date.now(),
    secondaryNotified: false,
    timer,
    originalMessage: context.originalMessage
  });

  return getTemplate('escalating', 'en');
}

// US-410: Resolve handoff — resume AI for a guest phone
export async function resolveHandoff(guestPhone: string): Promise<boolean> {
  // Set conversation back to autopilot
  updateSlots(guestPhone, { responseMode: 'autopilot' });
  await updateConversationMode(guestPhone, 'autopilot');

  // Mark handoff event as resolved
  const event = handoffLog.find(e => e.phone === guestPhone && e.resolvedAt === null);
  if (event) {
    event.resolvedAt = Date.now();
  }

  // Clear pending escalation timer
  const tracker = pendingEscalations.get(guestPhone);
  if (tracker?.timer) clearTimeout(tracker.timer);
  pendingEscalations.delete(guestPhone);

  console.log(`[Handoff] Resolved for ${guestPhone} — AI resumed`);
  return true;
}

// Called from message-router when a staff phone sends a message — clears the timer
export function handleStaffReply(phone: string): void {
  const staffNumber = phone.replace(/[^0-9]/g, '');
  const esc = configStore.getWorkflow().escalation;

  if (staffNumber.includes(esc.primary_phone) || staffNumber.includes(esc.secondary_phone)) {
    // Clear all pending escalations (staff is actively responding)
    for (const [guestPhone, tracker] of pendingEscalations.entries()) {
      if (tracker.timer) {
        clearTimeout(tracker.timer);
        console.log(`[Escalation] Timer cleared — staff replied, guest: +${guestPhone}`);
      }
      pendingEscalations.delete(guestPhone);
    }
  }
}

export function shouldEscalate(
  reason: EscalationReason | null,
  unknownCount: number,
  guestCount?: number
): EscalationReason | null {
  const threshold = configStore.getWorkflow().escalation.unknown_threshold;
  if (reason === 'human_request' || reason === 'complaint') return reason;
  if (unknownCount >= threshold) return 'unknown_repeated';
  if (guestCount && guestCount >= 5) return 'group_booking';
  return null;
}
