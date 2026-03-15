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
import { buildListMessage, listMessageToText, buildProductCardButtons, productCardToText } from '../../formatter.js';
import type { ProductCardItem } from '../../formatter.js';
import { interpolate, buildInterpolationContext } from '../../interpolate.js';
import { fnbGetMenu, fnbGetMenuItem, fnbGetDailySpecials, fnbGetPopularItems, fetchMenuItems } from '../../../tools/fnb-menu.js';
import { findMenuItemMatches } from '../../menu-matcher.js';
import { flowRegistry } from '../../flows/index.js';

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
 * applies tiered progressive escalation.
 *
 * US-880: 3-tier confidence-based fallback with progressive escalation:
 *   Tier 1 (1st failure): Ask user to rephrase in a friendly tone
 *   Tier 2 (2nd failure): Present quick-reply list of 4-5 core capabilities
 *   Tier 3 (3rd failure): Human handoff message + staff notification
 * Counter resets on successful intent classification.
 * All fallback events logged in intent_analytics with failure_tier (1, 2, or 3).
 */
async function handleLLMReply(
  state: PipelineState,
  result: ClassificationResult,
  context: IPipelineContext
): Promise<void> {
  const { phone, text, convo, msg, diaryEvent } = state;

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

  // US-885: Handle MENU_ITEM_DETAIL intent — show product card
  if (result.intent === 'MENU_ITEM_DETAIL') {
    await handleMenuItemDetail(state, context);
    return;
  }

  // US-870: Handle food_recommendation intent — show popular items
  if (result.intent === 'food_recommendation') {
    await handlePopularItems(state, context);
    return;
  }

  state.response = result.response;

  // Track unknown intents OR low-confidence results for operator escalation
  const isUnknownIntent = result.intent === 'unknown' || result.intent === 'unknown_intent';
  if (isUnknownIntent || result.confidence < 0.4) {
    const unknownCount = context.incrementUnknown(phone);

    // US-880: 3-tier confidence-based fallback with progressive escalation
    const settings = context.getSettings();
    const fallbackThreshold = settings.consecutive_fallback_threshold ?? 2;
    const shouldEscalateConsecutive = unknownCount > fallbackThreshold;
    const lang = convo.language || 'en';

    if (shouldEscalateConsecutive) {
      // ─── Tier 3: Human handoff (US-880) ─────────────────────────────
      diaryEvent.escalated = true;

      // Log escalation event to DB (fire-and-forget)
      context.logEscalationEvent({
        jid: phone,
        profileId: state.profileId,
        trigger: 'consecutive_fallback',
        count: unknownCount,
        metadata: { failure_tier: 3 },
        summaryContext: {
          guestName: msg.pushName,
          recentMessages: convo.messages.slice(-10).map(m => `${m.role}: ${m.content}`),
          escalationReason: 'Bot unable to understand (consecutive fallback)',
        },
      });

      // Log failure_tier to intent_analytics
      const conversationId = `${phone}-${Date.now()}`;
      context.trackIntentPrediction(
        conversationId, phone, text, 'unknown', result.confidence,
        'failure_tier_3', result.model
      ).catch(() => {});

      // Send customer-facing message about operator handoff
      const handoffMessages: Record<string, string> = {
        en: "I'm connecting you with our team for better assistance. A staff member will reply to you shortly.",
        ms: "Saya menghubungkan anda dengan pasukan kami untuk bantuan yang lebih baik. Staf akan membalas anda tidak lama lagi.",
        zh: "我正在为您联系我们的团队以提供更好的帮助。工作人员将很快回复您。"
      };
      state.response = handoffMessages[lang] || handoffMessages.en;
      await context.escalateToStaff({
        phone, pushName: msg.pushName, reason: 'unknown_repeated',
        recentMessages: convo.messages.map(m => `${m.role}: ${m.content}`),
        originalMessage: text, instanceId: msg.instanceId,
        profileId: state.profileId,
        triggerDetail: `Consecutive fallback tier 3 (${unknownCount}x unmatched)`,
      });
      context.resetUnknown(phone);
      console.log(`[Dispatch] Tier 3 handoff (US-880): ${unknownCount} unknowns (threshold: ${fallbackThreshold}) → forwarded to operator`);
    } else if (unknownCount === 2) {
      // ─── Tier 2: Suggestion list (US-880) ───────────────────────────
      const suggestionResponse = buildFallbackSuggestionResponse(settings, lang);
      if (suggestionResponse) {
        state.response = suggestionResponse;
      }

      // Log failure_tier to intent_analytics
      const conversationId = `${phone}-${Date.now()}`;
      context.trackIntentPrediction(
        conversationId, phone, text, 'unknown', result.confidence,
        'failure_tier_2', result.model
      ).catch(() => {});

      console.log(`[Dispatch] Tier 2 suggestions (US-880): showing ${(settings.fallback?.suggestions || []).length} options`);
    } else if (unknownCount === 1) {
      // ─── Tier 1: Rephrase request (US-880) ──────────────────────────
      const rephraseMessages: Record<string, string> = {
        en: "I'm sorry, I didn't quite understand that. Could you please rephrase your question?",
        ms: "Maaf, saya kurang faham. Bolehkah anda ulangi soalan anda dengan cara lain?",
        zh: "抱歉，我没太明白您的意思。您能换个方式再说一遍吗？",
        ta: "மன்னிக்கவும், எனக்கு புரியவில்லை. தயவுசெய்து உங்கள் கேள்வியை வேறு விதமாக கேளுங்கள்.",
      };
      state.response = rephraseMessages[lang] || rephraseMessages.en;

      // Log failure_tier to intent_analytics
      const conversationId = `${phone}-${Date.now()}`;
      context.trackIntentPrediction(
        conversationId, phone, text, 'unknown', result.confidence,
        'failure_tier_1', result.model
      ).catch(() => {});

      console.log(`[Dispatch] Tier 1 rephrase (US-880): asking user to rephrase`);
    }
  } else {
    context.resetUnknown(phone);
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

/**
 * US-870: Handle food_recommendation / popular items intent.
 *
 * Flow:
 *   1. Call fnbGetPopularItems for top-ordered dishes (limit 5)
 *   2. Format response with name, price, and one-line description per item
 *   3. Fall back to featured/bestseller items if popularity data unavailable
 *   4. Guest can pick any item directly from the recommendation list
 */
async function handlePopularItems(
  state: PipelineState,
  context: IPipelineContext
): Promise<void> {
  context.resetUnknown(state.phone);

  const lang = state.convo.language || 'en';

  console.log(`[Dispatch] US-870 POPULAR_ITEMS: fetching popular items for profile=${state.profileId}`);

  const result = await fnbGetPopularItems({ _profileId: state.profileId, limit: 5 });

  if (result.isError) {
    const errorMessages: Record<string, string> = {
      en: "I'm unable to check our popular items right now. Would you like to see the full menu instead? Just type \"menu\".",
      ms: "Maaf, saya tidak dapat menyemak hidangan popular buat masa ini. Nak tengok menu penuh? Taip \"menu\".",
      zh: "抱歉，我现在无法查看热门菜品。要看完整菜单吗？请输入\"菜单\"。"
    };
    state.response = errorMessages[lang] || errorMessages.en;
    return;
  }

  const text = result.content[0]?.text || '';

  if (!text || text.trim().length === 0) {
    // No popularity data — offer full menu
    const noDataMessages: Record<string, string> = {
      en: "I don't have popularity data right now, but our menu is full of great choices! Would you like to see the full menu? Just type \"menu\".",
      ms: "Saya tiada data populariti buat masa ini, tetapi menu kami penuh dengan pilihan hebat! Nak tengok menu penuh? Taip \"menu\".",
      zh: "我暂时没有人气数据，但我们的菜单有很多好选择！要看完整菜单吗？请输入\"菜单\"。"
    };
    state.response = noDataMessages[lang] || noDataMessages.en;
    return;
  }

  // Format popular items response
  state.response = formatPopularItemsResponse(text, lang);
}

/**
 * US-870: Format popular items into a friendly recommendation message.
 * Each item line is expected as "CODE Name - RM X.XX" or "Name - RM X.XX".
 */
function formatPopularItemsResponse(itemsText: string, lang: string): string {
  const headerMessages: Record<string, string> = {
    en: "Here are our most popular dishes, loved by most guests!",
    ms: "Ini hidangan paling popular kami, kegemaran ramai tetamu!",
    zh: "这些是我们最受欢迎的菜品，深受大多数客人喜爱！"
  };

  const footerMessages: Record<string, string> = {
    en: "\nJust tell me the name or number of any item to add it to your order!",
    ms: "\nBeritahu saya nama atau nombor item untuk menambahnya ke pesanan anda!",
    zh: "\n告诉我菜品名称或编号即可加入您的订单！"
  };

  const header = headerMessages[lang] || headerMessages.en;
  const footer = footerMessages[lang] || footerMessages.en;

  // Number the items for easy selection
  const lines = itemsText.split('\n').filter(l => l.trim());
  const numbered = lines.map((line, i) => `${i + 1}. ${line.trim()}`);

  return `${header}\n\n${numbered.join('\n')}${footer}`;
}

/**
 * US-885: Handle MENU_ITEM_DETAIL intent — extract item name from message,
 * look up the item via fuzzy match and FnB MCP, and send a product card.
 *
 * Flow:
 *   1. Extract item name from user's message (strip "tell me about", "what is", etc.)
 *   2. Fuzzy match against menu items
 *   3. Single match → build product card with buttons
 *   4. Multiple matches → show disambiguation list
 *   5. No match → friendly "item not found" message
 */
async function handleMenuItemDetail(
  state: PipelineState,
  context: IPipelineContext
): Promise<void> {
  context.resetUnknown(state.phone);

  const lang = state.convo.language || 'en';
  const itemName = extractItemName(state.processText);

  if (!itemName) {
    const fallbackMessages: Record<string, string> = {
      en: "I'd be happy to tell you about any menu item! Could you specify which dish you'd like to know about? You can also type \"menu\" to see our full menu.",
      ms: "Saya dengan senang hati akan ceritakan tentang menu kami! Hidangan mana yang anda ingin tahu? Anda juga boleh taip \"menu\" untuk lihat menu penuh.",
      zh: '我很乐意为您介绍菜单上的任何菜品！请问您想了解哪道菜？也可以输入\u201C菜单\u201D查看完整菜单。'
    };
    state.response = fallbackMessages[lang] || fallbackMessages.en;
    return;
  }

  console.log(`[Dispatch] US-885 MENU_ITEM_DETAIL: looking up "${itemName}" for profile=${state.profileId}`);

  // Fetch menu items and fuzzy match
  const menuItems = await fetchMenuItems();
  const matches = findMenuItemMatches(itemName, menuItems, { threshold: 4, maxResults: 5 });

  if (matches.length === 0) {
    const notFoundMessages: Record<string, string> = {
      en: `I couldn't find "${itemName}" on our menu. Would you like to see the full menu? Just type "menu".`,
      ms: `Saya tidak jumpa "${itemName}" dalam menu kami. Nak tengok menu penuh? Taip "menu".`,
      zh: `我在菜单上找不到\u201C${itemName}\u201D。要看完整菜单吗？请输入\u201C菜单\u201D。`
    };
    state.response = notFoundMessages[lang] || notFoundMessages.en;
    return;
  }

  if (matches.length === 1) {
    // Single match → product card
    const match = matches[0];
    let cardItem: ProductCardItem = {
      name: match.name,
      code: match.code,
      price: match.price,
      category: match.category,
    };

    // Try to get full details from FnB MCP for richer data
    if (match.code) {
      try {
        const detailResult = await fnbGetMenuItem({ code: match.code, _profileId: state.profileId });
        if (!detailResult.isError) {
          const detailText = detailResult.content[0]?.text || '';
          const parsed = parseItemDetail(detailText);
          if (parsed) {
            cardItem = { ...cardItem, ...parsed };
          }
        }
      } catch (err: any) {
        console.warn(`[Dispatch] US-885: Failed to fetch item detail for ${match.code}:`, err.message);
      }
    }

    // Build product card
    const settings = context.getSettings();
    const interactiveEnabled = (settings as any).interactiveMessages?.enabled;

    if (interactiveEnabled) {
      try {
        state.interactivePayload = buildProductCardButtons(cardItem, lang);
        state.response = productCardToText(cardItem, lang); // text fallback
        console.log(`[Dispatch] US-885: Built product card for "${match.name}" with interactive buttons`);
      } catch (err: any) {
        console.warn(`[Dispatch] US-885: Failed to build interactive card, using text fallback:`, err.message);
        state.response = productCardToText(cardItem, lang);
      }
    } else {
      state.response = productCardToText(cardItem, lang);
    }
    return;
  }

  // Multiple matches → disambiguation list
  const headerMessages: Record<string, string> = {
    en: `I found several items matching "${itemName}". Which one did you mean?`,
    ms: `Saya jumpa beberapa item yang sepadan dengan "${itemName}". Yang mana satu?`,
    zh: `我找到了几个与\u201C${itemName}\u201D匹配的菜品。您指的是哪个？`
  };

  const lines = [headerMessages[lang] || headerMessages.en, ''];
  matches.forEach((m, i) => {
    const priceStr = m.price ? ` — RM ${m.price.toFixed(2)}` : '';
    const catStr = m.category ? ` (${m.category})` : '';
    lines.push(`${i + 1}. ${m.name}${catStr}${priceStr}`);
  });

  const footerMessages: Record<string, string> = {
    en: '\nReply with a number or the item name for more details.',
    ms: '\nBalas dengan nombor atau nama item untuk maklumat lanjut.',
    zh: '\n回复数字或菜品名称了解更多。'
  };
  lines.push(footerMessages[lang] || footerMessages.en);

  state.response = lines.join('\n');
}

/**
 * US-885: Extract the item name from a user's message about a menu item.
 * Strips common question prefixes like "tell me about", "what is", etc.
 */
function extractItemName(text: string): string | null {
  const stripped = text
    .replace(/\b(tell\s+me\s+(more\s+)?about|what\s+is\s+(the\s+)?|what's\s+(the\s+)?|describe\s+(the\s+)?|info\s+(on|about)\s+(the\s+)?|details?\s+(of|on|about|for)\s+(the\s+)?|how\s+is\s+(the\s+)?|is\s+the\s+|what\s+(comes?|does\s+it)\s+(with|include)\s+|ingredients?\s+(of|in)\s+(the\s+)?)/gi, '')
    .replace(/\b(apa\s+(itu|tu)\s+|ceritakan\s+(tentang\s+)?|maklumat\s+(tentang|pasal)\s+|lebih\s+lanjut\s+tentang\s+|sedap\s+tak\s+)/gi, '')
    .replace(/(介绍|什么是|告诉我|这个怎么样|有什么|里面有什么)/g, '')
    .replace(/[?？。.!！]+$/g, '')
    .trim();

  // Must have at least 2 chars to be a meaningful item name
  return stripped.length >= 2 ? stripped : null;
}

/**
 * US-885: Parse item detail from FnB MCP response text into structured data.
 */
function parseItemDetail(text: string): Partial<ProductCardItem> | null {
  if (!text || text.trim().length === 0) return null;

  const result: Partial<ProductCardItem> = {};

  // Extract description (first paragraph or first few lines)
  const lines = text.split('\n').filter(l => l.trim());
  const descLines: string[] = [];
  for (const line of lines) {
    if (/^(code|price|category|allergen|dietary|RM\s)/i.test(line.trim())) continue;
    if (/^[\*_]*(code|price|category|allergen|dietary)/i.test(line.trim())) continue;
    descLines.push(line.trim());
    if (descLines.length >= 3) break;
  }
  if (descLines.length > 0) result.description = descLines.join('\n');

  // Extract allergens
  const allergenMatch = text.match(/allergens?:?\s*(.+)/i);
  if (allergenMatch) {
    const allergens = allergenMatch[1].split(/[,;]/).map(a => a.trim()).filter(Boolean);
    if (allergens.length > 0) result.allergens = allergens;
  }

  // Extract dietary flags
  const dietaryMatch = text.match(/dietary[_ ]?flags?:?\s*(.+)/i);
  if (dietaryMatch) {
    const flags = dietaryMatch[1].split(/[,;]/).map(f => f.trim()).filter(Boolean);
    if (flags.length > 0) result.dietary_flags = flags;
  }

  return Object.keys(result).length > 0 ? result : null;
}
