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

import { validateAndPrepare } from './pipeline/input-validator.js';
import { handleActiveStates } from './pipeline/state-executor.js';
import { classifyAndRoute } from './pipeline/intent-classifier.js';
import { processAndSend } from './pipeline/response-processor.js';
import { emitTrace } from '../lib/trace-collector.js';

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

    // Phase 3: Intent classification & action dispatch
    await classifyAndRoute(state, ctx);

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
