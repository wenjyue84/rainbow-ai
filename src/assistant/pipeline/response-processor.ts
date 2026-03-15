/**
 * Pipeline Phase 4: Response Processing & Delivery
 *
 * Handles: JSON safety check, confidence thresholds + disclaimers,
 * sentiment-based escalation, foreign language translation,
 * response mode dispatch (manual/copilot/autopilot),
 * logging, tracking, and feedback prompts.
 */
import type { RouterContext, PipelineState } from './types.js';
import { ensureResponseText, getConversationMode } from './input-validator.js';
import { getLLMSettings } from '../llm-settings-loader.js';
import { addMessage } from '../conversation.js';
import { isAIAvailable, translateText } from '../ai-client.js';
import { getTemplate } from '../formatter.js';
import { escalateToStaff } from '../escalation.js';
import { logMessage } from '../conversation-logger.js';
import {
  shouldEscalateOnSentimentForProfile, markSentimentEscalation,
  isSentimentEnabledForProfile
} from '../sentiment-tracker.js';
import {
  shouldAskFeedback, setAwaitingFeedback, getFeedbackPrompt
} from '../feedback.js';
import { isWithin24HourWindow } from '../session-window.js';
import { addApproval } from '../approval-queue.js';
import { trackResponseSent } from '../../lib/activity-tracker.js';
import { getUnknownFallbackMessages } from '../ai-response-generator.js';
import { recordWhatsappMessageCost } from '../../lib/whatsapp-cost.js';
import { checkFaithfulness, FAITHFULNESS_THRESHOLD, getFaithfulnessFallback } from '../faithfulness-checker.js';

// LLM settings loaded via shared cached loader (llm-settings-loader.ts)

export async function processAndSend(
  state: PipelineState, ctx: RouterContext
): Promise<void> {
  const { requestId, phone, text, foreignLang, convo, lang, msg, diaryEvent, devMetadata, profileConfig, profileId } = state;
  let response = state.response;

  // Catch-all fallback: if pipeline produced no response, use static fallback
  if (!response || !response.trim()) {
    console.warn(`[ResponseProcessor] Empty response for ${phone}, using static fallback (all_llm_failed)`);
    const fallbacks = getUnknownFallbackMessages();
    response = fallbacks[lang] || fallbacks.en;
  }

  // ─── JSON safety: never send raw LLM JSON to guest ────────────
  response = ensureResponseText(response, lang);

  // ─── Confidence thresholds + disclaimers ───────────────────────
  const llmSettings = getLLMSettings();
  const lowConfidenceThreshold = llmSettings.thresholds?.lowConfidence ?? 0.5;
  const mediumConfidenceThreshold = llmSettings.thresholds?.mediumConfidence ?? 0.7;

  if (diaryEvent.confidence < lowConfidenceThreshold) {
    console.log(
      `[Router] Very low confidence ${diaryEvent.confidence.toFixed(2)} → escalating to staff`
    );
    diaryEvent.escalated = true;
    await escalateToStaff({
      phone,
      pushName: msg.pushName,
      reason: 'low_confidence' as any,
      recentMessages: convo.messages.map(m => `${m.role}: ${m.content}`),
      originalMessage: text,
      instanceId: msg.instanceId
    });
    const disclaimer = getTemplate('confidence_very_low', lang);
    response += disclaimer;
  } else if (diaryEvent.confidence < mediumConfidenceThreshold) {
    console.log(
      `[Router] Medium-low confidence ${diaryEvent.confidence.toFixed(2)} → adding disclaimer`
    );
    const disclaimer = getTemplate('confidence_low', lang);
    response += disclaimer;
  }

  // ─── US-899: Faithfulness check (post-generation, pre-send) ──────
  let faithfulnessScore: number | undefined;
  if (devMetadata.kbFiles.length > 0 && response && diaryEvent.action !== 'static_reply') {
    try {
      const kbContent = state.profileKB.getFilesContent(devMetadata.kbFiles);
      if (kbContent.length > 50) {
        const result = checkFaithfulness(response, kbContent);
        faithfulnessScore = result.score;
        if (result.flagged && result.totalClaims >= 2) {
          console.warn(
            `[Faithfulness] Score ${result.score.toFixed(2)} < ${FAITHFULNESS_THRESHOLD} for ${phone} — ` +
            `${result.unmatchedClaims.length} unmatched claims: ${result.unmatchedClaims.join(', ')}`
          );
          response = getFaithfulnessFallback(lang);
          diaryEvent.escalated = true;
        } else if (result.totalClaims > 0) {
          console.log(`[Faithfulness] Score ${result.score.toFixed(2)} (${result.matchedClaims}/${result.totalClaims} claims) for ${phone}`);
        }
      }
    } catch (err: any) {
      console.warn(`[Faithfulness] Check failed for ${phone}:`, err.message);
    }
  }

  // ─── US-843 + US-878: First-contact data notice (PDPA compliance, DPO email) ──
  if (state.isFirstContact) {
    const knowledgeData = profileConfig.getKnowledge();
    const noticeEntry = knowledgeData.static.find((e: any) => e.intent === 'data_notice_first_contact');
    let notice = noticeEntry?.response?.[lang] || noticeEntry?.response?.en;
    if (notice) {
      // US-878: Interpolate {dpo_email} with per-profile DPO contact (PDPA Amendment 2024)
      const pdpaSettings = (profileConfig.getSettings() as any).pdpa;
      let dpoEmail: string;
      if (pdpaSettings?.dpo_email) {
        dpoEmail = pdpaSettings.dpo_email;
      } else {
        dpoEmail = pdpaSettings?.general_contact_email || 'privacy@example.com';
        console.warn(`[ResponseProcessor][US-878] DPO email not configured for profile ${profileId} — falling back to general contact. Configure pdpa.dpo_email in settings.json.`);
      }
      notice = notice.replace(/\{dpo_email\}/g, dpoEmail);
      response += notice;
      console.log(`[ResponseProcessor] Data notice appended for first-contact JID ${phone} (DPO: ${dpoEmail})`);
    }
  }

  // ─── Sentiment-based escalation (US-822: per-profile, reason='sentiment') ──
  const sentimentSettings = profileConfig.getSettings();
  if (isSentimentEnabledForProfile(sentimentSettings)) {
    const sentimentCheck = shouldEscalateOnSentimentForProfile(phone, sentimentSettings);
    if (sentimentCheck.shouldEscalate) {
      console.log(
        `[Sentiment] Escalating: ${sentimentCheck.consecutiveCount} consecutive negative messages from ${phone}`
      );
      diaryEvent.escalated = true;
      await escalateToStaff({
        phone,
        pushName: msg.pushName,
        reason: 'sentiment' as any,
        recentMessages: convo.messages.map(m => `${m.role}: ${m.content}`),
        originalMessage: text,
        instanceId: msg.instanceId,
        profileId,
      });
      markSentimentEscalation(phone);

      // US-822: Log escalation event with reason='sentiment'
      const { logEscalationEvent } = await import('../../lib/escalation-events.js');
      logEscalationEvent({
        jid: phone,
        profileId,
        trigger: 'sentiment',
        count: sentimentCheck.consecutiveCount,
        metadata: { consecutiveNegative: sentimentCheck.consecutiveCount },
      });

      // US-822: Configurable escalation message per profile
      const configuredMessages = (sentimentSettings as any).sentiment_analysis?.escalation_messages;
      const defaultMessages: Record<string, string> = {
        en: "\n\nI sense you may be frustrated. I've alerted our team, and someone will reach out to you shortly.",
        ms: "\n\nSaya faham anda mungkin kecewa. Saya telah maklumkan pasukan kami, dan seseorang akan menghubungi anda tidak lama lagi.",
        zh: "\n\n我感觉到您可能有些不满。我已通知我们的团队,他们会尽快与您联系。"
      };
      const messages = configuredMessages || defaultMessages;
      response += messages[lang] || messages.en || defaultMessages.en;
    }
  }

  // ─── Translate back to guest's language ────────────────────────
  if (foreignLang && isAIAvailable()) {
    const translatedResponse = await translateText(response, 'English', foreignLang);
    if (translatedResponse) {
      response = translatedResponse;
    }
  }

  addMessage(phone, 'assistant', response, profileId);

  // ─── Mode dispatch: manual / copilot / autopilot ───────────────
  const mode = getConversationMode(phone, profileConfig);

  const logMeta = {
    requestId,
    intent: diaryEvent.intent || undefined,
    confidence: diaryEvent.confidence,
    action: diaryEvent.action || undefined,
    instanceId: msg.instanceId,
    profileId,
    source: devMetadata.source,
    model: devMetadata.model,
    responseTime: devMetadata.responseTime,
    kbFiles: devMetadata.kbFiles.length > 0 ? devMetadata.kbFiles : undefined,
    messageType: diaryEvent.messageType,
    routedAction: devMetadata.routedAction,
    workflowId: devMetadata.workflowId,
    stepId: devMetadata.stepId,
    usage: devMetadata.usage,
    ...(msg.bsuid ? { bsuid: msg.bsuid } : {}),
    ...(faithfulnessScore !== undefined ? { faithfulnessScore } : {}),
  };

  if (mode === 'manual') {
    console.log(`[Manual Mode] Skipping AI auto-response for ${phone}`);
    logMessage(phone, msg.pushName, 'assistant', response, {
      ...logMeta, manual: true, skipped_auto_response: true
    } as any).catch(() => { });
    // US-410: Send holding message so guest knows a human is handling it
    await ctx.sendMessage(phone, "I've connected you with our team, they will respond shortly.", msg.instanceId);
    return;
  }

  if (mode === 'copilot') {
    const settings = profileConfig.getSettings();
    const copilotSettings = (settings as any).response_modes?.copilot;

    const shouldAutoApprove =
      (copilotSettings?.auto_approve_confidence &&
        diaryEvent.confidence >= copilotSettings.auto_approve_confidence) ||
      (copilotSettings?.auto_approve_intents?.includes(diaryEvent.intent));

    if (shouldAutoApprove) {
      console.log(
        `[Copilot] Auto-approving high-confidence response (${diaryEvent.confidence.toFixed(2)} for intent: ${diaryEvent.intent})`
      );
      // Fall through to send below
    } else {
      console.log(
        `[Copilot] Adding response to approval queue (confidence: ${diaryEvent.confidence.toFixed(2)}, intent: ${diaryEvent.intent})`
      );
      const approvalId = addApproval({
        phone,
        pushName: msg.pushName,
        originalMessage: text,
        suggestedResponse: response,
        intent: diaryEvent.intent,
        confidence: diaryEvent.confidence,
        language: lang,
        metadata: {
          source: devMetadata.source || 'unknown',
          model: devMetadata.model || 'unknown',
          kbFiles: devMetadata.kbFiles
        }
      });

      logMessage(phone, msg.pushName, 'assistant', response, {
        ...logMeta, manual: false, pending_approval: true, approval_id: approvalId
      } as any).catch(() => { });

      return; // Don't send yet — waiting for approval
    }
  }

  // ─── Autopilot or auto-approved copilot — send immediately ────
  logMessage(phone, msg.pushName, 'assistant', response, logMeta).catch(() => { });

  // US-430: If interactive payload exists, send as interactive message
  if (state.interactivePayload) {
    try {
      const { sendWhatsAppInteractiveMessage } = await import('../../lib/whatsapp/index.js');
      await sendWhatsAppInteractiveMessage(phone, state.interactivePayload, msg.instanceId);
      console.log(`[ResponseProcessor] Sent interactive message for ${phone} (US-430)`);
    } catch (interactiveErr: any) {
      console.warn(`[ResponseProcessor] Interactive message failed, falling back to text:`, interactiveErr.message);
      await ctx.sendMessage(phone, response, msg.instanceId);
    }
  } else
  // If static reply has an image attachment, send as media with text as caption
  if (state.imageUrl) {
    try {
      const { sendWhatsAppMedia } = await import('../../lib/baileys-client.js');
      const { readFileSync: readF, existsSync: existsF } = await import('fs');
      const { basename, extname } = await import('path');
      const imgPath = state.imageUrl;
      if (existsF(imgPath)) {
        const buffer = readF(imgPath);
        const ext = extname(imgPath).toLowerCase();
        const mimeMap: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
        const mimetype = mimeMap[ext] || 'image/jpeg';
        await sendWhatsAppMedia(phone, buffer, mimetype, basename(imgPath), response, msg.instanceId);
        console.log(`[ResponseProcessor] Sent image + caption for ${phone}: ${imgPath}`);
      } else {
        console.warn(`[ResponseProcessor] Image file not found: ${imgPath}, sending text only`);
        await ctx.sendMessage(phone, response, msg.instanceId);
      }
    } catch (imgErr: any) {
      console.error(`[ResponseProcessor] Failed to send image, falling back to text:`, imgErr.message);
      await ctx.sendMessage(phone, response, msg.instanceId);
    }
  } else {
    await ctx.sendMessage(phone, response, msg.instanceId);
  }
  trackResponseSent(phone, msg.pushName, devMetadata.routedAction || 'unknown', devMetadata.responseTime);

  // US-495: Track outbound message cost (AI auto-reply = 'service', always within CSW)
  recordWhatsappMessageCost({ phone, templateType: 'service', profileId }).catch(() => {});

  // ─── Feedback prompt (US-407: check 24h session window) ──────
  if (shouldAskFeedback(phone, diaryEvent.intent, diaryEvent.action)) {
    if (!isWithin24HourWindow(convo)) {
      console.warn(`[Feedback] Suppressed proactive feedback for ${phone} — outside 24h session window`);
    } else {
      console.log(`[Feedback] Asking for feedback from ${phone}`);
      setAwaitingFeedback(
        phone,
        `${phone}-${Date.now()}`,
        diaryEvent.intent,
        diaryEvent.confidence,
        devMetadata.model || null,
        devMetadata.responseTime || null,
        devMetadata.source || null
      );

      setTimeout(async () => {
        const feedbackPrompt = getFeedbackPrompt(lang);
        await ctx.sendMessage(phone, feedbackPrompt, msg.instanceId);
      }, 1000);
    }
  }
}
