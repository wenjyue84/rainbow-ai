/**
 * Message Router — Pipeline Orchestrator
 *
 * Reduced from 1,154 lines to ~80 lines. All logic lives in pipeline modules:
 *   1. input-validator.ts   — validation, staff commands, rate limiting, language, sentiment
 *   2. state-executor.ts    — feedback, active workflow/booking, emergency regex
 *   3. intent-classifier.ts — classification, routing, action dispatch
 *   4. response-processor.ts — confidence checks, translation, mode dispatch, feedback
 */
import type { IncomingMessage, SendMessageFn, CallAPIFn } from './types.js';
import type { RouterContext } from './pipeline/types.js';
import { failoverCoordinator } from '../lib/failover-coordinator.js';
import { configStore } from './config-store.js';
import { initWorkflowExecutor } from './workflow-executor.js';
import { maybeWriteDiary } from './memory-writer.js';
import { detectLanguage, getTemplate } from './formatter.js';
import { trackError } from '../lib/activity-tracker.js';
import { withSendRetry } from '../lib/send-retry.js';
import { isOptedOut } from './opt-out.js';
import { sendWhatsAppTypingIndicator, sendWhatsAppPausedIndicator } from '../lib/whatsapp/index.js';
import { auditLog } from '../lib/logger.js';

import { validateAndPrepare } from './pipeline/input-validator.js';
import { handleActiveStates } from './pipeline/state-executor.js';
import { classifyAndRoute } from './pipeline/intent-classifier.js';
import { processAndSend } from './pipeline/response-processor.js';
import { emitTrace } from '../lib/trace-collector.js';
import { parseCartRecoveryReply, handleCartRecoveryReply, resetCartRecovery } from './cart-recovery.js';
import { incrementQrScanByMessage } from '../routes/admin/qr-campaigns.js';
import { updateSlots } from './conversation.js';
import { enforceConversationLimit } from './pipeline/conversation-limiter.js';

// ─── Router context (shared across pipeline) ────────────────────

const ctx: RouterContext = {
  sendMessage: null as unknown as SendMessageFn,
  callAPI: null as unknown as CallAPIFn,
  jayLID: null
};

// ─── Init ────────────────────────────────────────────────────────

export function initRouter(send: SendMessageFn, api: CallAPIFn): void {
  const retrySend = withSendRetry(send);
  // Wrap with opt-out guard: never deliver outbound messages to opted-out JIDs
  ctx.sendMessage = async (phone: string, text: string, instanceId?: string) => {
    if (isOptedOut(phone)) {
      console.warn(`[Router] Outbound message suppressed — JID ${phone} is opted out`);
      return;
    }
    return retrySend(phone, text, instanceId);
  };
  ctx.callAPI = api;
  initWorkflowExecutor(ctx.sendMessage);

  configStore.on('reload', (domain: string) => {
    if (['workflow', 'settings', 'routing', 'all'].includes(domain)) {
      console.log('[Router] Config reloaded');
    }
  });
}

// ─── Main pipeline ──────────────────────────────────────────────

export async function handleIncomingMessage(msg: IncomingMessage): Promise<void> {
  // Standby mode: receive WA messages but do not respond
  if (!failoverCoordinator.isActive()) return;

  // Phase 1: Validate & preprocess
  const validation = await validateAndPrepare(msg, ctx);
  if (!validation.continue) return;

  const state = validation.state;
  const { phone, text } = state;

  const rid = state.requestId;

  // US-155: Auto opt-in on inbound message (implicit consent)
  setImplicitWhatsAppOptIn(phone, state.profileId).catch(err => {
    console.error(`[US-155] Failed to set implicit opt-in for ${phone}:`, err);
  });

  // US-882: Intercept cart recovery replies ("Resume order" / "Clear cart")
  const recoveryAction = parseCartRecoveryReply(text);
  if (recoveryAction) {
    const handled = await handleCartRecoveryReply(phone, recoveryAction, ctx.sendMessage, state.profileId);
    if (handled) return;
  }

  // US-882: Any incoming message from a WhatsApp user resets their cart idle timer
  resetCartRecovery(phone);

  // US-919: QR code deep-link detection — track scan, set session context, route to flow
  if (text.startsWith('ORDER:') || text.startsWith('CHECKIN:') || text.startsWith('CAMPAIGN:')) {
    const qrContext = await incrementQrScanByMessage(text).catch(() => null);
    const contextValue = qrContext?.contextValue || '';
    console.log(`[QR] Deep-link detected from ${phone}: ${text} → context=${contextValue}`);

    if (text.startsWith('ORDER:')) {
      // Table/room order QR → route to menu/ordering flow
      const tableRef = text.substring('ORDER:'.length).trim() || contextValue;
      updateSlots(phone, { tableNumber: tableRef, qrSource: 'order', qrCampaign: text }, state.profileId);
      state.processText = 'show me the menu to order food';
    } else if (text.startsWith('CHECKIN:')) {
      // Room check-in QR → route to check-in flow
      const roomRef = text.substring('CHECKIN:'.length).trim() || contextValue;
      updateSlots(phone, { roomNumber: roomRef, qrSource: 'checkin', qrCampaign: text }, state.profileId);
      state.processText = 'I want to check in to my room';
    } else if (text.startsWith('CAMPAIGN:')) {
      // Marketing campaign QR → extract message or default greeting
      const campaignMsg = text.substring('CAMPAIGN:'.length).trim();
      updateSlots(phone, { qrSource: 'campaign', qrCampaign: text }, state.profileId);
      state.processText = campaignMsg || 'hello';
    }
  }

  // US-829: Typing indicator — send 'composing' before pipeline dispatch
  const typingCfg = (state.profileConfig.getSettings() as any).typingIndicator;
  const typingEnabled = typingCfg?.enabled !== false;
  let typingRefresh: ReturnType<typeof setInterval> | null = null;

  if (typingEnabled) {
    // Fire-and-forget composing presence
    sendWhatsAppTypingIndicator(phone, msg.instanceId).catch(() => {});
    // Re-send every 20s to prevent WhatsApp's 25-second auto-dismiss
    typingRefresh = setInterval(() => {
      sendWhatsAppTypingIndicator(phone, msg.instanceId).catch(() => {});
    }, 20_000);
  }

  try {
    // Phase 2: Active state handling (feedback, workflow, booking, emergency)
    const stateResult = await handleActiveStates(state, ctx);
    if (stateResult.handled) return;

    // US-571: Check conversation turn limit before classification
    const limitResult = await enforceConversationLimit(
      state.convo,
      state.profileId,
      ctx.sendMessage
    );
    if (limitResult.escalated) {
      console.log(`[Router] Conversation escalated due to turn limit: ${limitResult.reason}`);
      return;
    }

    // Phase 3: Intent classification & action dispatch
    await classifyAndRoute(state, ctx);

    // US-156: Log to conversation audit trail for PDPA compliance (fire-and-forget)
    auditLog({
      phone: state.phone,
      message: state.text,
      intent: state.diaryEvent.intent,
      confidence: state.diaryEvent.confidence,
      actionTaken: state.diaryEvent.action,
      tier: state.devMetadata.source,
      profileId: state.profileId,
    }).catch(err => {
      console.error('[US-156] Audit log failed:', err);
    });

    // Phase 4: Response processing & delivery
    await processAndSend(state, ctx);

    // US-427: Emit structured trace event (fire-and-forget, after response sent)
    const traceCfg = (state.profileConfig.getSettings() as any).traces;
    if (traceCfg) {
      const { devMetadata, diaryEvent } = state;
      emitTrace(
        {
          jid: state.phone,
          profileId: state.profileId,
          devMetadataSource: devMetadata.source,
          intent: diaryEvent.intent ?? null,
          model: devMetadata.model,
          promptTokens: devMetadata.usage?.prompt_tokens,
          completionTokens: devMetadata.usage?.completion_tokens,
          responseTimeMs: devMetadata.responseTime,
          traceStart: state.traceStart,
        },
        traceCfg
      );
    }

    // Auto-diary: write noteworthy events
    try {
      maybeWriteDiary(state.diaryEvent);
    } catch {
      // Non-fatal — never crash the router over diary writes
    }
  } catch (err: any) {
    console.error(`[Router] [${rid}] Error processing message from ${phone}:`, err.message);
    trackError('message-router', `[${rid}] ${err.message}`);
    try {
      const lang = detectLanguage(text);
      await ctx.sendMessage(phone, getTemplate('error', lang), msg.instanceId);
    } catch {
      // Can't even send error message — give up silently
    }
  } finally {
    // Clear typing indicator refresh and send 'paused' presence
    if (typingRefresh) clearInterval(typingRefresh);
    if (typingEnabled) {
      sendWhatsAppPausedIndicator(phone, msg.instanceId).catch(() => {});
    }
  }
}

/**
 * US-155: Auto opt-in on inbound message
 * When a guest sends a message to the WhatsApp Business account,
 * they implicitly give consent to receive messages.
 */
async function setImplicitWhatsAppOptIn(phone: string, profileId: string): Promise<void> {
  try {
    // Dynamic import to avoid circular dependencies
    const { recordWhatsAppOptIn } = await import('../lib/whatsapp/consent-enforcement.js');
    await recordWhatsAppOptIn(phone, profileId);
  } catch (error) {
    // Don't throw — this is best-effort background task
    console.error(`[US-155] Error setting implicit opt-in for ${phone}:`, error);
  }
}
