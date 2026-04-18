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
import { resolveResponseLanguage } from './routing.js';
import { buildListMessage, listMessageToText } from '../../formatter.js';
import { interpolate, buildInterpolationContext } from '../../interpolate.js';
import { fnbGetMenu, fnbGetDailySpecials, fnbGetPopularItems, fetchMenuItems } from '../../../tools/fnb-menu.js';
import { flowRegistry } from '../../flows/index.js';
import { createServiceRequest, markStaffNotified } from '../../../lib/service-requests.js';
import {
  buildProductMessage, buildProductCardButtons, productCardToText,
  extractItemNameFromQuery, type CatalogConfig, type ProductCardItem
} from '../../product-card.js';
import { findMenuItemMatches } from '../../menu-matcher.js';
import { detectStarRating, getFollowUpMessage, handleFeedbackRating, isFeedbackMessage } from '../../order-feedback-handler.js';
import { chatWithToolsLoop } from '../../ai-response-generator.js';
import {
  guestEnquiryTools,
  checkDateAvailability,
  getRates,
  lookupReservation,
  getPropertyInfo,
  searchGuests,
  getGuest,
  listTodayArrivals,
  listUpcomingReservations,
  checkReservationAvailability,
} from '../../../tools/guest-enquiry.js';

// ─── Pelangi PMS Guest Enquiry Tools ─────────────────────────────────────────
// Intents that should query PMS2 for live data rather than static KB responses.
const PELANGI_ENQUIRY_INTENTS = new Set([
  'availability', 'pricing', 'reservation_lookup',
  'checkin_info', 'checkout_info', 'facilities_info', 'facilities',
  'rules_policy', 'room_type_inquiry',
  // Phase 2: expanded intents for live PMS2 data
  'booking', 'extend_stay', 'check_in_arrival', 'late_checkout_request', 'booking_status',
]);

const pelangiEnquiryHandlers = new Map([
  ['pelangi_check_date_availability', checkDateAvailability],
  ['pelangi_get_rates', getRates],
  ['pelangi_lookup_reservation', lookupReservation],
  ['pelangi_get_property_info', getPropertyInfo],
  // Phase 2: expanded handlers
  ['pelangi_search_guests', searchGuests],
  ['pelangi_get_guest', getGuest],
  ['pelangi_list_today_arrivals', listTodayArrivals],
  ['pelangi_list_upcoming_reservations', listUpcomingReservations],
  ['pelangi_check_reservation_availability', checkReservationAvailability],
]);

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
    workflowState, null, { language: lang, phone, pushName: msg.pushName, instanceId: msg.instanceId }
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

  // ─── Pelangi PMS Guest Enquiry: live availability / rates / reservation lookup ──
  // For Pelangi profile, route enquiry intents through chatWithToolsLoop so the LLM
  // can call the PMS2 tools (pelangi_check_date_availability, pelangi_get_rates,
  // pelangi_lookup_reservation, pelangi_get_property_info) to answer with live data.
  if (state.profileId === 'pelangi' && PELANGI_ENQUIRY_INTENTS.has(result.intent)) {
    try {
      const topicFiles = context.guessTopicFiles(state.text);
      const systemPrompt = context.buildSystemPrompt('', topicFiles);
      const history = convo.messages.slice(-10);
      state.response = await chatWithToolsLoop(
        systemPrompt,
        history,
        state.text,
        guestEnquiryTools,
        pelangiEnquiryHandlers,
      );
      console.log(`[Dispatch] Pelangi PMS tool loop returned for intent "${result.intent}"`);
    } catch (err: any) {
      console.warn(`[Dispatch] Pelangi PMS tool loop failed for intent "${result.intent}": ${err.message}`);
      // Fall through to result.response as graceful degradation
      state.response = result.response;
    }
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

// ─── WhatsApp list message limits ───────────────────────────────────────────
const MENU_LIST_MAX_SECTIONS = 3;
const MENU_LIST_MAX_ITEMS_PER_SECTION = 3; // 3 sections × 3 items = 9 rows < 10 limit

/**
 * US-872: Build and send a WhatsApp interactive list message for menu browsing.
 *
 * Fetches menu items from FnB MCP, groups them by category (up to 3 sections,
 * 3 items each), and builds a Baileys listMessage payload. Falls back to plain-text
 * menu when:
 *   - interactiveMessages is disabled in settings
 *   - msg.instanceId is absent (webchat / non-WhatsApp channel)
 *   - FnB MCP is unreachable or returns no structured data
 *
 * Row IDs follow the format `add to cart: ITEMNAME` so that when the user selects
 * a row, the incoming text is immediately recognised as ORDER_ITEM_ADD by the LLM tier.
 */
async function handleMenuBrowseInteractive(
  state: PipelineState,
  context: IPipelineContext
): Promise<void> {
  context.resetUnknown(state.phone);

  const settings = context.getSettings();
  const interactiveEnabled = (settings as any).interactiveMessages?.enabled;
  const isWhatsApp = Boolean(state.msg.instanceId);

  // Text fallback for non-WhatsApp channels or when interactive is disabled
  if (!interactiveEnabled || !isWhatsApp) {
    await _menuBrowseTextFallback(state);
    return;
  }

  // Fetch structured menu items from FnB MCP
  const items = await fetchMenuItems();

  if (items.length === 0) {
    await _menuBrowseTextFallback(state);
    return;
  }

  // Group items by category
  const categoryMap = new Map<string, typeof items>();
  for (const item of items) {
    const cat = item.category || 'Others';
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(item);
  }

  // Build list sections — cap at MENU_LIST_MAX_SECTIONS × MENU_LIST_MAX_ITEMS_PER_SECTION
  const sections: import('../../formatter.js').ListSection[] = [];
  for (const [cat, catItems] of Array.from(categoryMap.entries()).slice(0, MENU_LIST_MAX_SECTIONS)) {
    const rows = catItems.slice(0, MENU_LIST_MAX_ITEMS_PER_SECTION).map(item => ({
      rowId: `add to cart: ${item.name}`,
      title: item.name.slice(0, 24),
      ...(item.price !== undefined ? { description: `RM ${item.price.toFixed(2)}` } : {}),
    }));
    if (rows.length > 0) {
      sections.push({ title: cat.slice(0, 24), rows });
    }
  }

  if (sections.length < 1) {
    await _menuBrowseTextFallback(state);
    return;
  }

  const lang = state.lang || 'en';
  const i18n: Record<string, { title: string; description: string; buttonText: string }> = {
    en: { title: 'Makan Moments Menu', description: 'Tap an item to add it to your cart 🛒', buttonText: 'View Menu' },
    ms: { title: 'Menu Makan Moments', description: 'Ketik item untuk tambah ke troli 🛒', buttonText: 'Lihat Menu' },
    zh: { title: 'Makan Moments菜单', description: '点击菜品加入购物车 🛒', buttonText: '查看菜单' },
  };
  const t = i18n[lang] || i18n.en;

  try {
    const payload = buildListMessage(t.title, t.description, t.buttonText, sections);
    state.interactivePayload = payload;
    state.response = t.description; // Plain-text fallback used if interactive send fails
    console.log(`[Dispatch] US-872: built menu list message (${sections.length} sections, makan-moments)`);
  } catch (err: any) {
    console.warn(`[Dispatch] US-872: buildListMessage failed (${err.message}), falling back to text`);
    await _menuBrowseTextFallback(state);
  }
}

/** Serve a plain-text menu as a text fallback (US-872). */
async function _menuBrowseTextFallback(state: PipelineState): Promise<void> {
  const result = await fnbGetMenu({ _profileId: state.profileId });
  if (result.isError || !result.content[0]?.text) {
    const lang = state.lang || 'en';
    const msgs: Record<string, string> = {
      en: 'Here\'s our menu — tap any item or type its name to order! 🍽️',
      ms: 'Ini menu kami — ketik nama item untuk memesan! 🍽️',
      zh: '这是我们的菜单 — 输入菜品名称即可下单！🍽️',
    };
    state.response = msgs[lang] || msgs.en;
  } else {
    state.response = result.content[0].text;
  }
}

/**
 * Parse price from message text (e.g., "RM 15", "15 ringgit", "under RM 10")
 * Returns [minPrice, maxPrice] or null if no price found
 */
function parsePriceFromText(text: string): [number, number] | null {
  // Pattern: "RM X", "X ringgit", "X rm", "between X and Y", "X to Y"
  const rmPattern = /(?:RM|rm)\s*(\d+(?:\.\d{1,2})?)/;
  const ringgitPattern = /(\d+(?:\.\d{1,2})?)\s*(?:ringgit|rm)\b/i;
  const rangePattern = /(?:between|from)?\s*(?:RM|rm)?\s*(\d+(?:\.\d{1,2})?)\s*(?:and|to)\s*(?:RM|rm)?\s*(\d+(?:\.\d{1,2})?)/i;

  // Check for price range (e.g., "between 10 and 20")
  const rangeMatch = text.match(rangePattern);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    if (!isNaN(min) && !isNaN(max)) return [min, max];
  }

  // Check for "RM X" or "X ringgit"
  const rmMatch = text.match(rmPattern) || text.match(ringgitPattern);
  if (rmMatch && rmMatch[1]) {
    const price = parseFloat(rmMatch[1]);
    if (!isNaN(price)) return [0, price]; // maxPrice = price
  }

  return null;
}

/**
 * US-863: Handle MENU_FILTER_PRICE intent
 * Parse price from message and call fnbGetMenu with maxPrice filter
 */
async function handleMenuFilterPrice(
  state: PipelineState,
  context: IPipelineContext
): Promise<void> {
  const { processText, convo } = state;

  context.resetUnknown(state.phone);

  // Parse price from the message
  const [minPrice, maxPrice] = parsePriceFromText(processText) || [undefined, undefined];

  if (maxPrice === undefined) {
    // Couldn't parse price, fall back to LLM
    state.response = 'I understood you\'re looking for items in a certain price range, but I couldn\'t parse the price. Could you please specify the amount in RM? For example, "What can I get for RM 15?"';
    return;
  }

  console.log(`[Dispatch] US-863 MENU_FILTER_PRICE: maxPrice=${maxPrice}, minPrice=${minPrice}`);

  // Call fnbGetMenu with price filter
  const result = await fnbGetMenu({
    _profileId: state.profileId,
    max_price: maxPrice,
    ...(minPrice ? { min_price: minPrice } : {})
  });

  if (result.isError) {
    state.response = 'I\'m unable to check the menu right now. Please try again or ask our staff for help.';
  } else {
    state.response = result.content[0]?.text || 'I couldn\'t retrieve the menu. Please ask our staff for assistance.';
  }
}

/**
 * US-864: Handle MENU_SPECIALS intent
 * Fetches daily specials and promotions via fnbGetDailySpecials.
 * Falls back to a graceful message if no specials are found.
 */
async function handleMenuSpecials(
  state: PipelineState,
  context: IPipelineContext
): Promise<void> {
  context.resetUnknown(state.phone);

  const lang = state.convo.language || 'en';

  console.log(`[Dispatch] US-864 MENU_SPECIALS: fetching specials for profile=${state.profileId}`);

  const result = await fnbGetDailySpecials({ _profileId: state.profileId });

  if (result.isError) {
    const errorMessages: Record<string, string> = {
      en: "I'm unable to check today's specials right now. Please ask our staff or check back shortly!",
      ms: "Maaf, saya tidak dapat menyemak promosi hari ini buat masa ini. Sila tanya staf kami atau cuba lagi sebentar.",
      zh: "抱歉，我现在无法查看今日特餐。请询问我们的员工或稍后再试！"
    };
    state.response = errorMessages[lang] || errorMessages.en;
    return;
  }

  const text = result.content[0]?.text || '';

  if (!text || text.trim().length === 0) {
    // No specials today — offer popular items instead
    const noSpecialsMessages: Record<string, string> = {
      en: "There are no specials today, but our menu is always full of great choices! Would you like to see the full menu?",
      ms: "Tiada promosi khas hari ini, tetapi menu kami sentiasa penuh dengan pilihan yang hebat! Nak tengok menu penuh?",
      zh: "今天没有特别优惠，但我们的菜单一直有很多好选择！要看完整菜单吗？"
    };
    state.response = noSpecialsMessages[lang] || noSpecialsMessages.en;
    return;
  }

  const headerMessages: Record<string, string> = {
    en: "Here are today's specials and promotions! 🌟",
    ms: "Ini promosi dan special hari ini! 🌟",
    zh: "今日特餐和优惠来了！🌟"
  };

  state.response = `${headerMessages[lang] || headerMessages.en}\n\n${text}`;
}

/**
 * US-870: Handle MENU_RECOMMEND intent
 * Surfaces the top 3-5 most popular / featured items when guest is undecided.
 * Falls back to featured items if dedicated popular endpoint is unavailable.
 */
async function handleMenuRecommend(
  state: PipelineState,
  context: IPipelineContext
): Promise<void> {
  context.resetUnknown(state.phone);

  const lang = state.convo.language || 'en';
  const LIMIT = 5;

  console.log(`[Dispatch] US-870 MENU_RECOMMEND: fetching popular items for profile=${state.profileId}, limit=${LIMIT}`);

  const result = await fnbGetPopularItems({ _profileId: state.profileId, limit: LIMIT });

  if (result.isError) {
    const errorMessages: Record<string, string> = {
      en: "I'm unable to fetch recommendations right now. Please ask our staff — they'll be happy to suggest something delicious! 😊",
      ms: "Maaf, saya tidak dapat mendapatkan cadangan buat masa ini. Sila tanya staf kami — mereka akan senang membantu! 😊",
      zh: "抱歉，我现在无法获取推荐。请询问我们的员工——他们很乐意为您推荐美食！😊"
    };
    state.response = errorMessages[lang] || errorMessages.en;
    return;
  }

  const text = (result.content[0]?.text || '').trim();

  if (!text) {
    const emptyMessages: Record<string, string> = {
      en: "I don't have popularity data right now, but everything on our menu is made with love! Would you like to see the full menu?",
      ms: "Saya tiada data populariti buat masa ini, tetapi semua dalam menu kami dibuat dengan penuh kasih sayang! Nak tengok menu penuh?",
      zh: "我现在没有人气数据，但我们菜单上的每道菜都是用心烹制的！要看完整菜单吗？"
    };
    state.response = emptyMessages[lang] || emptyMessages.en;
    return;
  }

  const headerMessages: Record<string, string> = {
    en: `Here are our most popular dishes right now! ⭐`,
    ms: `Ini hidangan paling popular kami sekarang! ⭐`,
    zh: `这是我们现在最受欢迎的菜肴！⭐`
  };

  const ctaMessages: Record<string, string> = {
    en: `\n\nWant me to add any of these to your order? Just let me know! 😊`,
    ms: `\n\nMahu saya tambahkan mana-mana ke pesanan anda? Beritahu saya sahaja! 😊`,
    zh: `\n\n要我把其中一道加入您的订单吗？告诉我就行！😊`
  };

  const header = headerMessages[lang] || headerMessages.en;
  const cta = ctaMessages[lang] || ctaMessages.en;
  state.response = `${header}\n\n${text}${cta}`;
}

/**
 * US-880: Tier 1 — Ask user to rephrase (first consecutive unknown).
 * Uses profile-specific message from settings.tiered_fallback.tier1 or a built-in default.
 */
function buildTier1RephraseMessage(
  settings: any,
  lang: 'en' | 'ms' | 'zh' | 'ta'
): string {
  const configured = settings.tiered_fallback?.tier1?.[lang]
    || settings.tiered_fallback?.tier1?.en;
  if (configured) return configured;

  const defaults: Record<string, string> = {
    en: "I'm sorry, I didn't quite catch that. Could you rephrase or give me more detail? I'm happy to help! 😊",
    ms: "Maaf, saya kurang faham. Boleh anda ulang dengan cara lain atau beri lebih butiran? Saya sedia membantu! 😊",
    zh: "抱歉，我没太明白您的意思。能换个方式或提供更多详情吗？我很乐意帮忙！😊",
    ta: "மன்னிக்கவும், நான் புரிந்துகொள்ளவில்லை. வேறொரு விதத்தில் சொல்ல முடியுமா? நான் உதவ தயாராக இருக்கிறேன்! 😊",
  };
  return defaults[lang] || defaults.en;
}

/**
 * US-880: Tier 2 default capabilities when no suggestions are configured.
 */
function buildTier2DefaultCapabilities(lang: 'en' | 'ms' | 'zh' | 'ta'): string {
  const msgs: Record<string, string> = {
    en: "Here's what I can help with:\n\n1. Room pricing & availability\n2. Check-in / check-out info\n3. Facilities & WiFi\n4. Location & directions\n5. Contact staff\n\nType a number or ask your question again.",
    ms: "Ini yang boleh saya bantu:\n\n1. Harga & ketersediaan bilik\n2. Info check-in / check-out\n3. Kemudahan & WiFi\n4. Lokasi & arah\n5. Hubungi staf\n\nTaip nombor atau tanya semula soalan anda.",
    zh: "我可以帮助您：\n\n1. 房价与空房查询\n2. 入住/退房信息\n3. 设施与WiFi\n4. 位置与路线\n5. 联系工作人员\n\n请输入数字或重新提问。",
    ta: "நான் உதவக்கூடியவை:\n\n1. அறை விலை & கிடைக்கும் தன்மை\n2. செக்-இன் / செக்-அவுட் தகவல்\n3. வசதிகள் & WiFi\n4. இடம் & திசைகள்\n5. ஊழியர்களை தொடர்பு கொள்ளுங்கள்\n\nஒரு எண்ணை தட்டச்சு செய்யுங்கள் அல்லது மீண்டும் கேளுங்கள்.",
  };
  return msgs[lang] || msgs.en;
}

/**
 * US-445: Build a structured suggestion response from fallback.suggestions config.
 * Returns a numbered text list of suggested options for the user to pick from.
 */
function buildFallbackSuggestionResponse(
  settings: any,
  lang: 'en' | 'ms' | 'zh' | 'ta'
): string | null {
  const suggestions: Array<{ intent: string; label: Record<string, string> }> =
    settings.fallback?.suggestions;
  if (!suggestions || suggestions.length === 0) return null;

  const headerMessages: Record<string, string> = {
    en: "I'm not sure I understood that. Did you mean one of these?",
    ms: "Maaf, saya kurang pasti. Adakah anda bermaksud salah satu daripada ini?",
    zh: "抱歉，我不太确定您的意思。您是否指以下其中一项？",
  };

  const footerMessages: Record<string, string> = {
    en: "Reply with a number, or type your question again.",
    ms: "Balas dengan nombor, atau taip soalan anda semula.",
    zh: "请回复数字，或重新输入您的问题。",
  };

  const header = headerMessages[lang] || headerMessages.en;
  const footer = footerMessages[lang] || footerMessages.en;

  const lines = suggestions.map((s, i) => {
    const label = s.label?.[lang] || s.label?.en || s.intent;
    return `${i + 1}. ${label}`;
  });

  return `${header}\n\n${lines.join('\n')}\n\n${footer}`;
}

/**
 * Helper: log language resolution when tier differs from conversation state
 */
/**
 * US-430: Get greeting menu items by language for interactive list message.
 */
function getGreetingMenuItems(lang: 'en' | 'ms' | 'zh' | 'ta') {
  const menus: Record<string, {
    title: string; description: string; buttonText: string; sectionTitle: string;
    rows: { rowId: string; title: string; description?: string }[];
  }> = {
    en: {
      title: 'Rainbow AI',
      description: "Hi! I'm Rainbow — how can I help you today?",
      buttonText: 'View Options',
      sectionTitle: 'I can help with',
      rows: [
        { rowId: 'checkin', title: 'Check-in / Check-out', description: 'Arrival & departure info' },
        { rowId: 'pricing', title: 'Pricing & Availability', description: 'Rates and room options' },
        { rowId: 'location', title: 'Location & Directions', description: 'How to find us' },
        { rowId: 'facilities', title: 'Facilities & WiFi', description: 'Amenities info' },
      ],
    },
    ms: {
      title: 'Rainbow AI',
      description: 'Hai! Saya Rainbow — bagaimana saya boleh bantu?',
      buttonText: 'Lihat Pilihan',
      sectionTitle: 'Saya boleh bantu',
      rows: [
        { rowId: 'checkin', title: 'Check-in / Check-out', description: 'Info ketibaan & pelepasan' },
        { rowId: 'pricing', title: 'Harga & Ketersediaan', description: 'Kadar & pilihan bilik' },
        { rowId: 'location', title: 'Lokasi & Arah', description: 'Cara ke sini' },
        { rowId: 'facilities', title: 'Kemudahan & WiFi', description: 'Info kemudahan' },
      ],
    },
    zh: {
      title: 'Rainbow AI',
      description: '你好！我是Rainbow——有什么可以帮您的？',
      buttonText: '查看选项',
      sectionTitle: '我可以帮助',
      rows: [
        { rowId: 'checkin', title: '入住 / 退房', description: '到达和离开信息' },
        { rowId: 'pricing', title: '价格与房源', description: '房价和房间选项' },
        { rowId: 'location', title: '位置与路线', description: '如何找到我们' },
        { rowId: 'facilities', title: '设施与WiFi', description: '设施信息' },
      ],
    },
  };
  return menus[lang] || menus.en;
}

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

function logLanguageResolution(
  context: string,
  lang: 'en' | 'ms' | 'zh' | 'ta',
  responseLang: 'en' | 'ms' | 'zh' | 'ta',
  result: ClassificationResult
): void {
  if (responseLang !== lang && result.detectedLanguage !== 'unknown') {
    console.log(`[Dispatch] Language resolved (${context}): '${lang}' → '${responseLang}'`);
  }
}
