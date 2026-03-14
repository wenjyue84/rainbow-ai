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
import type { PipelineState } from '../types.js';
import type { ClassificationResult } from './tier-classification.js';
import type { RoutingResult } from './routing.js';
import { resolveResponseLanguage } from './routing.js';
import { buildListMessage, listMessageToText } from '../../formatter.js';
import { interpolate, buildInterpolationContext } from '../../interpolate.js';
import { fnbGetMenu, fnbGetDailySpecials } from '../../../tools/fnb-menu.js';

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

  state.response = result.response;

  // Track unknown intents OR low-confidence results for operator escalation
  const isUnknownIntent = result.intent === 'unknown' || result.intent === 'unknown_intent';
  if (isUnknownIntent || result.confidence < 0.4) {
    const unknownCount = context.incrementUnknown(phone);

    // US-428: Check consecutive fallback threshold (settings.json, per-profile)
    const settings = context.getSettings();
    const fallbackThreshold = settings.consecutive_fallback_threshold ?? 1;
    const shouldEscalateConsecutive = unknownCount > fallbackThreshold;

    if (shouldEscalateConsecutive) {
      // ─── Stage 2: Escalation (US-428 + US-445) ──────────────────────
      diaryEvent.escalated = true;

      // Log escalation event to DB (fire-and-forget) + trigger summary (US-429)
      context.logEscalationEvent({
        jid: phone,
        profileId: state.profileId,
        trigger: 'consecutive_fallback',
        count: unknownCount,
        summaryContext: {
          guestName: msg.pushName,
          recentMessages: convo.messages.slice(-10).map(m => `${m.role}: ${m.content}`),
          escalationReason: 'Bot unable to understand (consecutive fallback)',
        },
      });

      // Send customer-facing message about operator handoff
      const lang = convo.language || 'en';
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
        triggerDetail: `Consecutive fallback (${unknownCount}x unmatched)`,
      });
      context.resetUnknown(phone);
      console.log(`[Dispatch] Stage 2 escalation (US-445): ${unknownCount} unknowns (threshold: ${fallbackThreshold}) → forwarded to operator`);
    } else if (unknownCount === 1) {
      // ─── Stage 1: Suggestion response (US-445) ──────────────────────
      const lang = convo.language || 'en';
      const suggestionResponse = buildFallbackSuggestionResponse(settings, lang);
      if (suggestionResponse) {
        state.response = suggestionResponse;
        console.log(`[Dispatch] Stage 1 suggestion (US-445): showing ${(settings.fallback?.suggestions || []).length} options`);
      }
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
  lang: 'en' | 'ms' | 'zh'
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
function getGreetingMenuItems(lang: 'en' | 'ms' | 'zh') {
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
  lang: 'en' | 'ms' | 'zh',
  responseLang: 'en' | 'ms' | 'zh',
  result: ClassificationResult
): void {
  if (responseLang !== lang && result.detectedLanguage !== 'unknown') {
    console.log(`[Dispatch] Language resolved (${context}): '${lang}' → '${responseLang}'`);
  }
}
