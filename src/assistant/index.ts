import type { AssistantDependencies } from './types.js';
import { configStore } from './config-store.js';
import { initAIClient } from './ai-client.js';
import { initIntents } from './intents.js';
import { initRateLimiter, destroyRateLimiter } from './rate-limiter.js';
import { initConversations, destroyConversations } from './conversation.js';
import { initKnowledge, destroyKnowledge } from './knowledge.js';
import { initPricing } from './pricing.js';
import { initBooking } from './booking.js';
import { initEscalation, destroyEscalation } from './escalation.js';
import { initRouter, handleIncomingMessage } from './message-router.js';
import { initKnowledgeBase } from './knowledge-base.js';
import { initMessageQueue, enqueueMessage, closeQueue, setDLQAlertHandler, setDedupTtl } from '../lib/message-queue.js';
import { initFlows } from './flows/index.js';
import { loadConsentCache } from './consent.js';
import { initCartRecovery, destroyCartRecovery } from './cart-recovery.js';
import { initPostStayReview, destroyPostStayReview } from './post-stay-review.js';
import { initPostCheckinUpsell, destroyPostCheckinUpsell } from './post-checkin-upsell.js';

export async function initAssistant(deps: AssistantDependencies): Promise<void> {
  const { registerMessageHandler, sendMessage, callAPI, getWhatsAppStatus } = deps;

  // Check WhatsApp status
  const waStatus = getWhatsAppStatus();
  if (waStatus.state !== 'open') {
    console.warn('[Assistant] WhatsApp not connected yet — handler will be registered for when it connects');
  }

  // Initialize config-store FIRST (all modules depend on it)
  configStore.init();

  // Initialize all modules
  initAIClient();
  initIntents();
  initKnowledgeBase();
  initRateLimiter();
  await initConversations();
  initKnowledge(callAPI);
  initPricing();
  initBooking(callAPI);
  initEscalation(sendMessage);
  initFlows();
  await loadConsentCache();
  initRouter(sendMessage, callAPI);

  // US-882: Abandoned cart recovery for WhatsApp sessions
  initCartRecovery(sendMessage);

  // US-018: Post-stay review request (scheduled 2h after checkout_full completes)
  initPostStayReview(sendMessage);

  // US-028: Post-checkin upsell suggestion (disabled by default, 30min after checkin_full)
  initPostCheckinUpsell(sendMessage);

  // Initialize BullMQ message queue (US-405)
  // Worker concurrency from settings, default 3
  const settings = configStore.getSettings() as any;
  const queueConcurrency = settings?.message_queue?.worker_concurrency ?? 3;
  const dedupTtl = settings?.message_queue?.dedup_ttl_seconds;
  if (dedupTtl && typeof dedupTtl === 'number') {
    setDedupTtl(dedupTtl);
  }
  const queueEnabled = await initMessageQueue(handleIncomingMessage, queueConcurrency);

  // Register DLQ depth alert handler (US-413)
  // Sends a WhatsApp staff notification when DLQ depth exceeds 10 jobs
  const esc = configStore.getWorkflow().escalation;
  if (esc?.primary_phone) {
    setDLQAlertHandler(async (depth: number) => {
      const msg = `*[SYSTEM ALERT — Dead Letter Queue]* ${depth} messages have permanently failed and are stuck in the DLQ.\n\nCheck the admin dashboard at /api/admin/dlq to inspect and replay failed jobs.\n\n_This alert fires once per 15 minutes while the DLQ depth remains above 10._`;
      await sendMessage(esc.primary_phone, msg);
      console.warn(`[MessageQueue] DLQ alert sent to staff (depth=${depth})`);
    });
  }

  // Register enqueueMessage as the Baileys handler — it enqueues to BullMQ
  // if Redis is available, otherwise falls back to direct handleIncomingMessage
  registerMessageHandler(enqueueMessage);

  console.log(`[Assistant] WhatsApp AI Assistant ready (queue: ${queueEnabled ? 'BullMQ' : 'direct'})`);
}

export async function destroyAssistant(): Promise<void> {
  await closeQueue();
  destroyCartRecovery();
  destroyPostStayReview();
  destroyPostCheckinUpsell();
  destroyRateLimiter();
  destroyConversations();
  destroyKnowledge();
  destroyEscalation();
  console.log('[Assistant] Shutdown complete');
}
