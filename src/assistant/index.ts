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
import { initMessageQueue, enqueueMessage, closeQueue } from '../lib/message-queue.js';
import { initFlows } from './flows/index.js';
import { loadConsentCache } from './consent.js';

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

  // Initialize BullMQ message queue (US-405)
  // Worker concurrency from settings, default 3
  const settings = configStore.getSettings() as any;
  const queueConcurrency = settings?.message_queue?.worker_concurrency ?? 3;
  const queueEnabled = await initMessageQueue(handleIncomingMessage, queueConcurrency);

  // Register enqueueMessage as the Baileys handler — it enqueues to BullMQ
  // if Redis is available, otherwise falls back to direct handleIncomingMessage
  registerMessageHandler(enqueueMessage);

  console.log(`[Assistant] WhatsApp AI Assistant ready (queue: ${queueEnabled ? 'BullMQ' : 'direct'})`);
}

export async function destroyAssistant(): Promise<void> {
  await closeQueue();
  destroyRateLimiter();
  destroyConversations();
  destroyKnowledge();
  destroyEscalation();
  console.log('[Assistant] Shutdown complete');
}
