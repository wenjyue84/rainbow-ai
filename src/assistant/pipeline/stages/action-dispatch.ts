/**
 * Pipeline Stage 6: Action Dispatch
 *
 * Routes to the correct handler based on routedAction:
 * - static_reply: Pre-written response (with complaint/problem/repeat overrides)
 * - start_booking: Initialize booking workflow
 * - escalate: Forward to staff
 * - forward_payment: Forward payment proof to admin
 * - workflow: Start multi-step workflow
 * - llm_reply/reply/default: Use LLM response directly
 */

import type { IPipelineContext } from '../pipeline-context.js';
import type { PipelineState, FlowContext } from '../types.js';
import type { ClassificationResult } from './tier-classification.js';
import type { RoutingResult } from './routing.js';
import { buildListMessage } from '../../formatter.js';
import { interpolate, buildInterpolationContext } from '../../interpolate.js';
import { fetchMenuItems } from '../../../tools/fnb-menu.js';
import {
  handleMenuBrowseInteractive, handleMenuFilterPrice,
  handleMenuSpecials, handleMenuRecommend,
} from './action-dispatch-menu.js';
import {
  buildTier1RephraseMessage, buildTier2DefaultCapabilities,
  buildFallbackSuggestionResponse, getGreetingMenuItems,
  logLanguageResolution,
} from './action-dispatch-helpers.js';
import { flowRegistry } from '../../flows/index.js';
import { createServiceRequest, markStaffNotified } from '../../../lib/service-requests.js';
import {
  buildProductMessage, buildProductCardButtons, productCardToText,
  extractItemNameFromQuery, type CatalogConfig, type ProductCardItem
} from '../../product-card.js';
import { findMenuItemMatches } from '../../menu-matcher.js';
import { detectStarRating, getFollowUpMessage, handleFeedbackRating, isFeedbackMessage } from '../../order-feedback-handler.js';

/**
 * Stage 6: Action Dispatch
 *
 * Executes the action determined by routing. Each case handles a different
 * response strategy — from pre-written static replies to multi-step workflows.
 *
 * @param state - Pipeline state (mutates state.response)
 * @param result - Classification result
 * @param routing - Routing result (action, language, message type, repeat check)
 * @param context - Pipeline context with all dependencies
 */
export async function dispatchAction(
  state: PipelineState,
  result: ClassificationResult,
  routing: RoutingResult,
  context: IPipelineContext
): Promise<void> {
  const { phone, text, processText, convo, lang, msg, diaryEvent, devMetadata } = state;
  const { routedAction, responseLang, messageType, repeatCheck } = routing;

  switch (routedAction) {
    case 'static_reply':
      await handleStaticReply(state, result, routing, context);
      break;

    case 'start_booking':
      await handleStartBooking(state, context);
      break;

    case 'escalate':
      await handleEscalate(state, result, context);
      break;

    case 'forward_payment':
      await handleForwardPayment(state, result, context);
      break;

    case 'workflow':
      await handleWorkflow(state, result, context);
      break;

    case 'flow':
      await handleStartFlow(state, result, context);
      break;

    case 'service_request':
      await handleServiceRequest(state, result, context);
      break;

    case 'product_card':
      await handleProductCard(state, result, context);
      break;

    case 'order_feedback':
      await handleOrderFeedback(state, result, context);
      break;

    case 'data_portability_request':
      await handleDataPortabilityRequest(state, result, context);
      break;

    case 'llm_reply':
    case 'reply':
    default:
      await handleLLMReply(state, result, context);
      break;
  }
}

/**
 * Static Reply handler
 *
 * Uses pre-written responses from knowledge.json.
 * Overrides for: complaints (LLM + escalate), problems (LLM response),
 * repeat intents (2nd time → LLM, 3rd+ → escalate).
 */
async function handleStaticReply(
  state: PipelineState,
  result: ClassificationResult,
  routing: RoutingResult,
  context: IPipelineContext
): Promise<void> {
  const { phone, text, convo, lang, msg, diaryEvent } = state;
  const { responseLang, messageType, repeatCheck } = routing;

  context.resetUnknown(phone);

  if (messageType === 'complaint') {
    logLanguageResolution('complaint', lang, responseLang, result);
    state.response = result.response || context.getStaticReply(result.intent, responseLang);
    await context.escalateToStaff({
      phone, pushName: msg.pushName, reason: 'complaint',
      recentMessages: convo.messages.map(m => `${m.role}: ${m.content}`),
      originalMessage: text, instanceId: msg.instanceId,
      profileId: state.profileId,
      triggerDetail: `Intent: ${result.intent}`,
    });
    diaryEvent.escalated = true;
    console.log(`[Dispatch] Complaint override: ${result.intent} → LLM + escalate`);
  } else if (messageType === 'problem') {
    logLanguageResolution('problem', lang, responseLang, result);
    state.response = result.response || context.getStaticReply(result.intent, responseLang);
    console.log(`[Dispatch] Problem override: ${result.intent} → LLM response`);
  } else if (repeatCheck.isRepeat && repeatCheck.count >= 2) {
    logLanguageResolution('3rd+ repeat', lang, responseLang, result);
    state.response = result.response || context.getStaticReply(result.intent, responseLang);
    await context.escalateToStaff({
      phone, pushName: msg.pushName, reason: 'unknown_repeated',
      recentMessages: convo.messages.map(m => `${m.role}: ${m.content}`),
      originalMessage: text, instanceId: msg.instanceId,
      profileId: state.profileId,
      triggerDetail: `Repeated unknown intent (${repeatCheck.count + 1}x): ${result.intent}`,
    });
    console.log(`[Dispatch] Repeat escalation: ${result.intent} (${repeatCheck.count + 1}x)`);
  } else if (repeatCheck.isRepeat) {
    logLanguageResolution('2nd repeat', lang, responseLang, result);
    state.response = result.response || context.getStaticReply(result.intent, responseLang);
    console.log(`[Dispatch] Repeat override: ${result.intent} → LLM response (2nd time)`);
  } else if (result.entities?.multiIntent === 'true' && result.entities.allIntents) {
    // Multi-intent: combine static replies for all detected intents
    logLanguageResolution('multi-intent', lang, responseLang, result);
    const intents = result.entities.allIntents.split(',');
    const replies: string[] = [];
    for (const intent of intents) {
      const reply = context.getStaticReply(intent.trim(), responseLang);
      if (reply) replies.push(reply);
    }
    if (replies.length >= 2) {
      state.response = replies.join('\n\n');
      console.log(`[Dispatch] Multi-intent combined: ${intents.join(' + ')} → ${replies.length} replies`);
    } else {
      // Fallback: not enough static replies, use LLM response or primary static
      const primaryReply = context.getStaticReply(result.intent, responseLang);
      state.response = primaryReply || result.response;
      console.log(`[Dispatch] Multi-intent partial: only ${replies.length} static replies, using primary`);
    }
  } else {
    logLanguageResolution('default', lang, responseLang, result);
    // US-019: First-contact greeting with capability menu
    // US-430: Send as interactive list message when enabled
    let replyIntent = result.intent;
    if (result.intent === 'greeting' && convo.messages.length <= 1) {
      const firstContactReply = context.getStaticReply('greeting_first_contact', responseLang);
      if (firstContactReply) {
        state.response = firstContactReply;

        // US-430: Build interactive list for first-contact greeting
        const settings = context.getSettings();
        if ((settings as any).interactiveMessages?.enabled) {
          try {
            const menuItems = getGreetingMenuItems(responseLang);
            const payload = buildListMessage(
              menuItems.title,
              menuItems.description,
              menuItems.buttonText,
              [{ title: menuItems.sectionTitle, rows: menuItems.rows }]
            );
            state.interactivePayload = payload;
            console.log(`[Dispatch] First-contact greeting: built interactive list message (US-430)`);
          } catch (err: any) {
            console.warn(`[Dispatch] Failed to build interactive list, using text fallback:`, err.message);
          }
        }

        console.log(`[Dispatch] First-contact greeting: using greeting_first_contact template`);
        return; // early return — skip default static reply
      }
    }
    const staticResponse = context.getStaticReply(replyIntent, responseLang);
    if (staticResponse) {
      state.response = staticResponse;
    } else {
      console.warn(`[Dispatch] No static reply for "${result.intent}", using LLM response`);
      state.response = result.response;
    }
  }

  // US-819: Apply template variable interpolation before delivery
  if (state.response) {
    const vars = buildInterpolationContext(
      msg.pushName,
      state.profileId,
      convo.bookingState
    );
    state.response = interpolate(state.response, vars);
  }

  // Attach image if the static reply has one configured
  const imageUrl = context.getStaticReplyImageUrl(result.intent);
  if (imageUrl) {
    state.imageUrl = imageUrl;
  }
}

/**
 * Start Booking handler
 */
async function handleStartBooking(
  state: PipelineState,
  context: IPipelineContext
): Promise<void> {
  const { phone, text, convo, lang, msg, diaryEvent } = state;

  context.resetUnknown(phone);
  diaryEvent.bookingStarted = true;
  context.trackBookingStarted(phone, msg.pushName);
  const bookingState = context.createBookingState();
  const bookingResult = await context.handleBookingStep(bookingState, text, lang, convo.messages);
  context.updateBookingState(phone, bookingResult.newState);
  state.response = bookingResult.response;
}

/**
 * Escalate handler
 */
async function handleEscalate(
  state: PipelineState,
  result: ClassificationResult,
  context: IPipelineContext
): Promise<void> {
  const { phone, text, convo, msg, diaryEvent } = state;

  diaryEvent.escalated = true;
  context.trackEscalation(phone, msg.pushName, 'complaint');
  state.response = result.response;
  await context.escalateToStaff({
    phone, pushName: msg.pushName, reason: 'complaint',
    recentMessages: convo.messages.map(m => `${m.role}: ${m.content}`),
    originalMessage: text, instanceId: msg.instanceId,
    profileId: state.profileId,
    triggerDetail: `Intent: ${result.intent}`,
  });
}

/**
 * Forward Payment handler
 */
async function handleForwardPayment(
  state: PipelineState,
  result: ClassificationResult,
  context: IPipelineContext
): Promise<void> {
  const { phone, text, lang, msg } = state;

  context.resetUnknown(phone);
  const forwardTo = context.getWorkflow().payment.forward_to;
  const forwardMsg = `\u{1F4B3} *Payment notification from ${msg.pushName}*\nPhone: ${phone}\nMessage: ${text}`;
  try {
    await context.sendMessage(forwardTo, forwardMsg, msg.instanceId);
    console.log(`[Dispatch] Payment receipt forwarded to ${forwardTo} for ${phone}`);
  } catch (err: any) {
    console.error(`[Dispatch] Failed to forward payment:`, err.message);
  }
  state.response = result.response || context.getTemplate('payment_forwarded', lang);
}

/**
 * Workflow handler
 *
 * Starts a multi-step workflow. Validates workflow_id exists in routing config
 * and that the referenced workflow is defined in workflows.json.
 * Falls back to escalation on config errors.
 */
async function handleWorkflow(
  state: PipelineState,
  result: ClassificationResult,
  context: IPipelineContext
): Promise<void> {
  const { phone, text, lang, convo, msg, diaryEvent, devMetadata } = state;

  context.resetUnknown(phone);

  const routingConfig = context.getRouting();
  const route = routingConfig[result.intent];
  const workflowId = route?.workflow_id;

  if (!workflowId) {
    console.error(`[Dispatch] CRITICAL: Intent "${result.intent}" has action=workflow but no workflow_id`);
    context.notifyAdminConfigError(
      `Intent "${result.intent}" configured with action=workflow but workflow_id is missing.\n\n` +
      `Fix in routing.json by adding "workflow_id": "workflow_name"`
    ).catch(() => {});

    diaryEvent.configError = `missing_workflow_id:${result.intent}`;
    await context.escalateToStaff({
      phone, pushName: msg.pushName,
      reason: 'config_error',
      recentMessages: convo.messages.slice(-5).map(m => `${m.role}: ${m.content}`),
      originalMessage: text,
      instanceId: msg.instanceId,
      metadata: { configError: 'missing_workflow_id', intent: result.intent },
    });
    state.response = context.getTemplate('escalated', lang);
    return;
  }

  const workflows = context.getWorkflows();
  const workflow = workflows.workflows.find((w: any) => w.id === workflowId);

  if (!workflow) {
    console.error(`[Dispatch] CRITICAL: Workflow "${workflowId}" referenced but not found in workflows.json`);
    context.notifyAdminConfigError(
      `Intent "${result.intent}" references workflow_id "${workflowId}" which doesn't exist.\n\n` +
      `Available workflows: ${workflows.workflows.map((w: any) => w.id).join(', ')}`
    ).catch(() => {});

    diaryEvent.configError = `workflow_not_found:${workflowId}`;
    await context.escalateToStaff({
      phone, pushName: msg.pushName,
      reason: 'config_error',
      recentMessages: convo.messages.slice(-5).map(m => `${m.role}: ${m.content}`),
      originalMessage: text,
      instanceId: msg.instanceId,
      metadata: { configError: 'workflow_not_found', workflowId },
    });
    state.response = context.getTemplate('escalated', lang);
    return;
  }

  console.log(`[Dispatch] Starting workflow: ${workflow.name} (${workflowId})`);
  diaryEvent.workflowStarted = true;
  context.trackWorkflowStarted(phone, msg.pushName, workflow.name);
  const workflowState = context.createWorkflowState(workflowId);
  const workflowResult = await context.executeWorkflowStep(
    workflowState, null, { language: lang, phone, pushName: msg.pushName, instanceId: msg.instanceId, profileId: state.profileId }
  );

  if (workflowResult.newState) {
    context.updateWorkflowState(phone, workflowResult.newState);
  } else {
    if (workflowResult.shouldForward && workflowResult.conversationSummary) {
      await context.forwardWorkflowSummary(phone, msg.pushName, workflow, workflowState, msg.instanceId);
    }
  }

  state.response = workflowResult.response;
  if (workflowResult.workflowId) devMetadata.workflowId = workflowResult.workflowId;
  if (workflowResult.stepId) devMetadata.stepId = workflowResult.stepId;
}

/**
 * US-871: Start Flow handler
 *
 * Starts a registered Flow (e.g., checkin_form) via the unified flow system.
 * Routes must specify "action": "flow" and "flow_type": "<registered_type>".
 * The flow state is stored on ConversationState.activeFlow for continuation
 * by state-executor.ts.
 */
async function handleStartFlow(
  state: PipelineState,
  result: ClassificationResult,
  context: IPipelineContext
): Promise<void> {
  const { phone, text, lang, msg, convo, diaryEvent } = state;

  context.resetUnknown(phone);

  const routingConfig = context.getRouting();
  const route = routingConfig[result.intent];
  const flowType = route?.flow_type;

  if (!flowType) {
    console.error(`[Dispatch] Intent "${result.intent}" has action=flow but no flow_type`);
    context.notifyAdminConfigError(
      `Intent "${result.intent}" configured with action=flow but flow_type is missing.\n\n` +
      `Fix in routing.json by adding "flow_type": "flow_name"`
    ).catch(() => {});
    state.response = context.getTemplate('escalated', lang);
    return;
  }

  const flow = flowRegistry.get(flowType);
  if (!flow) {
    console.error(`[Dispatch] Flow "${flowType}" referenced but not registered`);
    context.notifyAdminConfigError(
      `Intent "${result.intent}" references flow_type "${flowType}" which is not registered.\n\n` +
      `Available flows: ${flowRegistry.listTypes().join(', ')}`
    ).catch(() => {});
    state.response = context.getTemplate('escalated', lang);
    return;
  }

  console.log(`[Dispatch] Starting flow: ${flowType} for ${phone}`);

  const flowContext: FlowContext = {
    language: lang,
    phone,
    pushName: msg.pushName,
    instanceId: msg.instanceId,
    messages: convo.messages,
    profileId: state.profileId,
    profileConfig: state.profileConfig,
    sendMessage: context.sendMessage,
  };

  const flowResult = await flow.start(flowContext, text);

  if (flowResult.newState) {
    context.updateActiveFlow(phone, { flowType, data: flowResult.newState });
  }

  state.response = flowResult.response;
}

/**
 * LLM Reply / Default handler
 *
 * Uses the LLM-generated response directly.
 * If confidence is very low (<0.4), increments unknown counter and
 * may escalate if threshold is reached.
 *
 * US-428: Consecutive fallback escalation — after N consecutive T4 LLM-fallback
 * unknowns (configurable via settings.json consecutive_fallback_threshold),
 * automatically trigger human handoff and log to escalation_events table.
 */
async function handleLLMReply(
  state: PipelineState,
  result: ClassificationResult,
  context: IPipelineContext
): Promise<void> {
  const { phone, text, convo, msg, diaryEvent } = state;

  // US-872: Interactive list message for menu category browsing (makan-moments only)
  if (
    (result.intent === 'ORDER_BROWSE' || result.intent === 'menu_browse_category') &&
    state.profileId === 'makan-moments'
  ) {
    await handleMenuBrowseInteractive(state, context);
    return;
  }

  // US-863: Handle MENU_FILTER_PRICE intent specially
  if (result.intent === 'MENU_FILTER_PRICE') {
    await handleMenuFilterPrice(state, context);
    return;
  }

  // US-864: Handle MENU_SPECIALS intent specially
  if (result.intent === 'MENU_SPECIALS') {
    await handleMenuSpecials(state, context);
    return;
  }

  // US-870: Handle MENU_RECOMMEND intent — proactive popular items suggestion
  if (result.intent === 'MENU_RECOMMEND') {
    await handleMenuRecommend(state, context);
    return;
  }

  state.response = result.response;

  // ─── US-880: Tiered confidence-based fallback with progressive escalation ──
  // Track unknown intents OR low-confidence results for operator escalation
  const isUnknownIntent = result.intent === 'unknown' || result.intent === 'unknown_intent';
  if (isUnknownIntent || result.confidence < 0.4) {
    const unknownCount = context.incrementUnknown(phone);
    const settings = context.getSettings();
    const lang = convo.language || 'en';

    if (unknownCount === 1) {
      // ─── Tier 1: Ask to rephrase (first failure) ─────────────────
      state.response = buildTier1RephraseMessage(settings, lang);
      context.logEscalationEvent({
        jid: phone,
        profileId: state.profileId,
        trigger: 'tiered_fallback',
        count: unknownCount,
        metadata: { failure_tier: 1 },
      });
      // Log to intent_analytics (US-880 AC: failure_tier in intent_predictions)
      context.trackIntentPrediction(
        `${phone}-${Date.now()}`, phone, text, 'unknown', result.confidence,
        'failure_tier_1', result.model
      ).catch(() => {});
      console.log(`[Dispatch][US-880] Tier 1 rephrase for ${phone}`);

    } else if (unknownCount === 2) {
      // ─── Tier 2: Show capability quick-reply list (second failure) ─
      const capabilityResponse = buildFallbackSuggestionResponse(settings, lang);
      state.response = capabilityResponse || buildTier2DefaultCapabilities(lang);
      context.logEscalationEvent({
        jid: phone,
        profileId: state.profileId,
        trigger: 'tiered_fallback',
        count: unknownCount,
        metadata: { failure_tier: 2 },
      });
      // Log to intent_analytics (US-880 AC: failure_tier in intent_predictions)
      context.trackIntentPrediction(
        `${phone}-${Date.now()}`, phone, text, 'unknown', result.confidence,
        'failure_tier_2', result.model
      ).catch(() => {});
      console.log(`[Dispatch][US-880] Tier 2 capability list for ${phone}`);

    } else {
      // ─── Tier 3: Human handoff (third+ consecutive failure) ───────
      diaryEvent.escalated = true;

      // Log escalation event to DB (fire-and-forget) + trigger summary (US-429)
      context.logEscalationEvent({
        jid: phone,
        profileId: state.profileId,
        trigger: 'tiered_fallback',
        count: unknownCount,
        metadata: { failure_tier: 3 },
        summaryContext: {
          guestName: msg.pushName,
          recentMessages: convo.messages.slice(-10).map(m => `${m.role}: ${m.content}`),
          escalationReason: 'Bot unable to understand after 3 consecutive attempts',
        },
      });
      // Log to intent_analytics (US-880 AC: failure_tier in intent_predictions)
      context.trackIntentPrediction(
        `${phone}-${Date.now()}`, phone, text, 'unknown', result.confidence,
        'failure_tier_3', result.model
      ).catch(() => {});

      // Send customer-facing handoff message
      const handoffMessages: Record<string, string> = {
        en: "I'm sorry I couldn't help with that. I'm connecting you with our team — a staff member will reply shortly.",
        ms: "Maaf, saya tidak dapat membantu dengan itu. Saya menghubungkan anda dengan pasukan kami — staf akan membalas tidak lama lagi.",
        zh: "非常抱歉我无法帮您解决。我正在为您联系我们的团队——工作人员将很快回复您。",
        ta: "மன்னிக்கவும், என்னால் உதவ முடியவில்லை. நான் உங்களை எங்கள் குழுவுடன் இணைக்கிறேன் — ஊழியர் விரைவில் பதிலளிப்பார்.",
      };
      state.response = handoffMessages[lang] || handoffMessages.en;
      await context.escalateToStaff({
        phone, pushName: msg.pushName, reason: 'unknown_repeated',
        recentMessages: convo.messages.map(m => `${m.role}: ${m.content}`),
        originalMessage: text, instanceId: msg.instanceId,
        profileId: state.profileId,
        triggerDetail: `Tiered fallback Tier 3 (${unknownCount}x unmatched)`,
      });
      context.resetUnknown(phone);
      console.log(`[Dispatch][US-880] Tier 3 escalation for ${phone}: ${unknownCount} consecutive unknowns`);
    }
  } else {
    context.resetUnknown(phone);
  }
}

// ─── US-875: Service Request handler ─────────────────────────────────────────

/**
 * US-875: Handle in-stay housekeeping and maintenance service requests.
 *
 * Scoped to Pelangi Capsule Hostel profile only.
 *
 * Flow:
 * 1. Look up request_type from routing.json entry
 * 2. Log request in service_requests table
 * 3. Send WhatsApp notification to staff operations number
 * 4. Reply to guest with confirmation + estimated wait time
 */
async function handleServiceRequest(
  state: PipelineState,
  result: ClassificationResult,
  context: IPipelineContext
): Promise<void> {
  const { phone, text, convo, msg, lang } = state;

  context.resetUnknown(phone);

  // Guard: service requests are Pelangi-only
  if (state.profileId !== 'pelangi') {
    state.response = result.response || context.getStaticReply(result.intent, lang) || context.getTemplate('escalated', lang);
    console.log(`[Dispatch] Service request blocked — not pelangi profile (${state.profileId})`);
    return;
  }

  const settings = context.getSettings();
  const srConfig = settings.service_requests ?? {};
  const routingConfig = context.getRouting();
  const route = routingConfig[result.intent] ?? {};
  const requestType: string = route.request_type ?? result.intent.toLowerCase();

  // Extract room number from conversation state if available
  const roomNumber: string | null = (convo as any).roomNumber ?? null;

  // 1. Log to DB (fire-and-forget on failure, don't block guest response)
  let requestId: string | null = null;
  try {
    requestId = await createServiceRequest({
      jid: phone,
      profile: state.profileId,
      roomNumber,
      requestType,
      details: text,
    });
    console.log(`[Dispatch] US-875: Service request logged id=${requestId} type=${requestType} jid=${phone}`);
  } catch (err: any) {
    console.error(`[Dispatch] US-875: Failed to log service request:`, err.message);
  }

  // 2. Notify staff via WhatsApp (fire-and-forget)
  const staffPhone: string | null = srConfig.staff_notify_phone ?? settings.staff?.phones?.[0] ?? null;
  if (staffPhone && requestId) {
    const roomLabel = roomNumber ? ` (Room: ${roomNumber})` : '';
    const staffMsg = `🛎️ *Service Request — ${result.intent}*\nGuest: ${msg.pushName || phone}${roomLabel}\nRequest: ${text}\nRef: ${requestId}`;
    try {
      await context.sendMessage(staffPhone, staffMsg, msg.instanceId);
      await markStaffNotified(requestId);
      console.log(`[Dispatch] US-875: Staff notified at ${staffPhone}`);
    } catch (err: any) {
      console.error(`[Dispatch] US-875: Failed to notify staff:`, err.message);
    }
  }

  // 3. Reply to guest: use static knowledge entry first, fall back to generic confirmation
  const staticReply = context.getStaticReply(result.intent, lang);
  if (staticReply) {
    state.response = staticReply;
  } else {
    const waitTimes: Record<string, string> = srConfig.wait_times ?? {};
    const wait = waitTimes[requestType] ?? '15-20 minutes';
    const confirmations: Record<string, string> = {
      en: `Your request has been received! Our team will attend to it shortly. Estimated wait time: ${wait}.`,
      ms: `Permintaan anda telah diterima! Pasukan kami akan hadir tidak lama lagi. Anggaran masa: ${wait}.`,
      zh: `您的请求已收到！我们的团队将尽快处理。预计等待时间：${wait}。`,
    };
    state.response = confirmations[lang] ?? confirmations.en;
  }
}

// ─── US-885: Product Card handler ─────────────────────────────────────────────

/**
 * US-885: Handle menu_item_detail intent with a product card.
 *
 * Extracts the item name from the user's message, looks it up via fetchMenuItems
 * + fuzzy match, then sends a product card:
 *   - Catalog mode: Baileys productMessage (if catalog configured)
 *   - Fallback: Buttons message with item details + "Add to cart"
 *   - Text-only: For non-WhatsApp channels
 *
 * Falls back to LLM reply if no matching item is found.
 */

/**
 * Order Feedback Handler (US-869)
 * Processes star rating responses (1-5) after order is served.
 * Stores the rating and sends appropriate follow-up messages.
 */
async function handleOrderFeedback(
  state: PipelineState,
  result: ClassificationResult,
  context: IPipelineContext
): Promise<void> {
  context.resetUnknown(state.phone);

  const { phone, text, lang } = state;
  const rating = detectStarRating(text);

  if (rating === null) {
    // Shouldn't reach here since intent classification should have caught this
    // But just in case, provide a fallback
    state.response = result.response || 'Thank you for your response!';
    return;
  }

  console.log(`[Dispatch] US-869: Processing order feedback rating=${rating} from phone=${phone}`);

  // Store the rating in database
  const feedbackResult = await handleFeedbackRating(phone, null, rating, (lang || 'en') as 'en' | 'ms' | 'zh');

  if (!feedbackResult.stored) {
    console.warn(`[Dispatch] US-869: Failed to store rating=${rating} for phone=${phone}`);
  }

  // Send follow-up message if applicable (low ratings get empathetic message, high ratings get thank you)
  if (feedbackResult.followUp) {
    state.response = feedbackResult.followUp;
  } else {
    // Rating of 3 (neutral) — acknowledge and thank
    const messages: Record<string, string> = {
      en: 'Thank you for your feedback! We appreciate it.',
      ms: 'Terima kasih atas maklum balas anda! Kami menghargainya.',
      zh: '感谢您的反馈！我们感谢您的意见。'
    };
    state.response = messages[lang as string] || messages.en;
  }
}

async function handleProductCard(
  state: PipelineState,
  result: ClassificationResult,
  context: IPipelineContext
): Promise<void> {
  context.resetUnknown(state.phone);

  const lang = state.lang || 'en';
  const itemQuery = extractItemNameFromQuery(state.processText);

  if (!itemQuery || itemQuery.length < 2) {
    // Can't extract item name — fall back to LLM reply
    state.response = result.response;
    console.log(`[Dispatch] US-885: no item name extracted from "${state.processText}", using LLM reply`);
    return;
  }

  // Fetch structured menu items from FnB MCP
  const menuItems = await fetchMenuItems();

  if (menuItems.length === 0) {
    // MCP down or no items — fall back to LLM reply
    state.response = result.response;
    console.log(`[Dispatch] US-885: fetchMenuItems returned empty, using LLM reply`);
    return;
  }

  // Fuzzy match the extracted item name
  const matches = findMenuItemMatches(itemQuery, menuItems, { threshold: 4, maxResults: 1 });

  if (matches.length === 0) {
    // No match found — fall back to LLM reply
    state.response = result.response;
    console.log(`[Dispatch] US-885: no fuzzy match for "${itemQuery}", using LLM reply`);
    return;
  }

  const matched = matches[0];
  const productItem: ProductCardItem = {
    code: matched.code,
    name: matched.name,
    price: matched.price,
    category: matched.category,
    available: matched.available,
  };

  // Check catalog configuration
  const settings = context.getSettings();
  const catalogConfig = (settings as any).catalog as CatalogConfig | undefined;
  const isWhatsApp = Boolean(state.msg.instanceId);

  if (catalogConfig?.enabled && catalogConfig.catalogId && catalogConfig.businessJid && isWhatsApp) {
    // Catalog mode: send native product message
    try {
      const payload = buildProductMessage(productItem, catalogConfig);
      state.interactivePayload = payload;
      state.response = productCardToText(productItem, lang); // text fallback
      console.log(`[Dispatch] US-885: built catalog product message for "${matched.name}"`);
      return;
    } catch (err: any) {
      console.warn(`[Dispatch] US-885: catalog product message failed (${err.message}), using button fallback`);
    }
  }

  if (isWhatsApp) {
    // Button fallback: item details + "Add to cart" button
    try {
      const payload = buildProductCardButtons(productItem, lang);
      state.interactivePayload = payload;
      state.response = productCardToText(productItem, lang); // text fallback if interactive fails
      console.log(`[Dispatch] US-885: built product card buttons for "${matched.name}"`);
      return;
    } catch (err: any) {
      console.warn(`[Dispatch] US-885: button message failed (${err.message}), using text fallback`);
    }
  }

  // Text-only fallback (webchat or errors)
  state.response = productCardToText(productItem, lang);
  console.log(`[Dispatch] US-885: text-only product card for "${matched.name}"`);
}

// Menu handlers extracted to action-dispatch-menu.ts

// Helper functions (buildTier1RephraseMessage, buildTier2DefaultCapabilities,
// buildFallbackSuggestionResponse, getGreetingMenuItems, logLanguageResolution)
// extracted to action-dispatch-helpers.ts

/**
 * PDPA Data Portability Request handler (US-019)
 *
 * When a guest sends "request my data" (or similar), Rainbow:
 * 1. Sends the guest an acknowledgment in their language (from knowledge.json)
 * 2. Notifies admin via WhatsApp with the guest's phone, request timestamp,
 *    a direct link to the export endpoint, and the 7-day PDPA due date
 */
async function handleDataPortabilityRequest(
  state: PipelineState,
  result: ClassificationResult,
  context: IPipelineContext
): Promise<void> {
  const { phone, lang, msg } = state;

  context.resetUnknown(phone);

  // 1. Acknowledge to guest using static reply from knowledge.json
  const staticReply = context.getStaticReply('data_portability_request', lang);
  state.response = staticReply || result.response;

  console.log(`[Dispatch] US-019: Data portability request from ${phone}`);

  // 2. Notify admin — fire-and-forget, do not block guest response
  try {
    const { notifyAdminDataPortabilityRequest } = await import('../../../lib/admin-notifier.js');
    notifyAdminDataPortabilityRequest(
      phone,
      msg.pushName ?? null,
      new Date()
    ).catch((err: any) => {
      console.error('[Dispatch] US-019: Failed to notify admin of data portability request:', err.message);
    });
  } catch (err: any) {
    console.error('[Dispatch] US-019: Failed to import admin-notifier:', err.message);
  }
}

