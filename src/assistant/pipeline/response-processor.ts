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
import {
  detectHallucinations, applyHallucinationAction, logHallucinationEvent,
  type HallucinationConfig, type HallucinationResult
} from '../hallucination-detector.js';
import {
  computeGroundednessScore, logGroundednessEvent, getGroundednessFallback,
  DEFAULT_GROUNDEDNESS_THRESHOLD,
} from '../groundedness-checker.js';
import {
  evaluateEscalationRules, resetEscalationTracking,
} from '../escalation-rules.js';
import {
  MATERIAL_DECISION_TYPES, logAiDecision, getDisclosureTemplate,
} from '../../lib/ai-decision-disclosure.js';
import {
  checkMisinformationRisk, getMisinformationFallback, logMisinformationEvent,
  type MisinformationCheckResult,
} from '../misinformation-guardrail.js';

// LLM settings loaded via shared cached loader (llm-settings-loader.ts)

/**
 * US-1010: Map pipeline intent to material decision type for PDPA disclosure.
 * Returns the decision type string if the intent is material, null otherwise.
 */
function getMaterialDecisionType(intent: string, action: string): string | null {
  // Direct intent-to-decision-type mapping
  if (intent === 'booking' || intent === 'booking_inquiry') return 'booking';
  if (intent === 'ORDER_CONFIRM') return 'order_confirmation';
  if (intent === 'MENU_RECOMMEND') return 'menu_recommendation';
  // Escalation is logged separately when triggered; check action for workflow-based escalation
  if (action === 'escalate' || intent === 'contact_staff') return 'escalation';
  return null;
}

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

  // ─── US-914: High-stakes keyword + consecutive low-confidence escalation ──
  const escalationSettings = (profileConfig.getSettings() as any).escalation_rules;
  const ruleResult = evaluateEscalationRules(phone, text, diaryEvent.confidence, {
    confidenceThreshold: escalationSettings?.confidence_threshold ?? 0.4,
    consecutiveLimit: escalationSettings?.consecutive_low_confidence_limit ?? 2,
  });

  if (ruleResult.shouldEscalate && !diaryEvent.escalated) {
    const primaryRule = ruleResult.rules[0];
    const triggerReason = primaryRule.trigger === 'high_stakes_keyword'
      ? 'high_stakes_keyword' as const
      : 'consecutive_low_confidence' as const;

    console.log(
      `[EscalationRules] Triggered for ${phone}: ${primaryRule.reason} (caseId=${ruleResult.caseId})`
    );
    diaryEvent.escalated = true;
    await escalateToStaff({
      phone,
      pushName: msg.pushName,
      reason: triggerReason,
      recentMessages: convo.messages.map(m => `${m.role}: ${m.content}`),
      originalMessage: text,
      instanceId: msg.instanceId,
      profileId,
      triggerDetail: primaryRule.detail,
      metadata: {
        caseId: ruleResult.caseId,
        rules: ruleResult.rules.map(r => ({ trigger: r.trigger, detail: r.detail })),
        highStakesKeywords: ruleResult.highStakesKeywords,
      },
    });

    // Log escalation event
    const { logEscalationEvent } = await import('../../lib/escalation-events.js');
    logEscalationEvent({
      jid: phone,
      profileId,
      trigger: triggerReason,
      metadata: {
        caseId: ruleResult.caseId,
        keywords: ruleResult.highStakesKeywords,
        confidence: diaryEvent.confidence,
        rules: ruleResult.rules.map(r => r.trigger),
      },
    });
  }

  // ─── US-955: OWASP LLM09 Misinformation Guardrail (pre-send) ────────
  // Blocks factual responses that have no KB grounding (no topic files found).
  let misinformationResult: MisinformationCheckResult | undefined;
  const misinfoSettings = (profileConfig.getSettings() as any).misinformation_guardrail;
  if (misinfoSettings?.enabled !== false && diaryEvent.action !== 'static_reply') {
    misinformationResult = checkMisinformationRisk(
      text,
      diaryEvent.intent || '',
      state.ragUsed ?? false,
      state.ragTopicFiles ?? [],
      misinfoSettings
    );

    if (misinformationResult.blocked) {
      console.warn(
        `[MisinformationGuardrail] Blocked factual response for ${phone} — ` +
        `intent=${diaryEvent.intent}, ragUsed=${state.ragUsed}, ` +
        `topicFiles=${(state.ragTopicFiles ?? []).length}, reason=${misinformationResult.blockReason}`
      );
      response = getMisinformationFallback(lang);
      diaryEvent.escalated = true;
    }

    // Log misinformation event (fire-and-forget) — only for factual queries
    if (misinformationResult.isFactualQuery) {
      logMisinformationEvent(
        phone, profileId, text, diaryEvent.intent || '', misinformationResult
      ).catch(() => {});
    }
  }

  // ─── US-899 + US-913: Faithfulness + Hallucination Detection (post-generation, pre-send) ──
  let faithfulnessScore: number | undefined;
  let hallucinationResult: HallucinationResult | undefined;
  if (devMetadata.kbFiles.length > 0 && response && diaryEvent.action !== 'static_reply') {
    try {
      const kbContent = state.profileKB.getFilesContent(devMetadata.kbFiles);
      if (kbContent.length > 50) {
        // US-899: Original faithfulness check (claim matching)
        const result = checkFaithfulness(response, kbContent);
        faithfulnessScore = result.score;

        // US-913: Two-stage hallucination detection (factual classifier + NLI)
        const halluSettings = (profileConfig.getSettings() as any).hallucination_detection as
          Partial<HallucinationConfig> | undefined;
        const halluEnabled = halluSettings?.enabled !== false; // default enabled

        if (halluEnabled) {
          hallucinationResult = detectHallucinations(text, response, kbContent, halluSettings);

          if (hallucinationResult.flagged) {
            console.warn(
              `[HallucinationDetector] Flagged for ${phone} — ` +
              `${hallucinationResult.contradictions} contradictions, ` +
              `maxSeverity=${hallucinationResult.maxSeverity}, ` +
              `action=${hallucinationResult.action} (${hallucinationResult.latencyMs}ms)`
            );
            response = applyHallucinationAction(response, hallucinationResult, lang);
            if (hallucinationResult.action === 'block') {
              diaryEvent.escalated = true;
            }
          } else if (hallucinationResult.isFactualQuery && hallucinationResult.verdicts.length > 0) {
            console.log(
              `[HallucinationDetector] OK for ${phone} — ` +
              `${hallucinationResult.verdicts.length} claims verified (${hallucinationResult.latencyMs}ms)`
            );
          }

          // Log hallucination event to DB (fire-and-forget)
          if (halluSettings?.log_events !== false && hallucinationResult.isFactualQuery) {
            logHallucinationEvent(phone, profileId, text, response, hallucinationResult).catch(() => {});
          }

          // ─── US-993: Groundedness Score Gate (runs after hallucination check) ──
          // Only runs if response wasn't already blocked by hallucination detector
          if (!hallucinationResult.flagged || hallucinationResult.action !== 'block') {
            const groundednessThreshold =
              (halluSettings as any)?.groundedness_threshold ?? DEFAULT_GROUNDEDNESS_THRESHOLD;

            if (groundednessThreshold > 0) {
              const groundednessResult = computeGroundednessScore(
                response, kbContent, groundednessThreshold
              );

              // Log for analytics (fire-and-forget)
              if (halluSettings?.log_events !== false) {
                logGroundednessEvent(phone, profileId, text, response, groundednessResult).catch(() => {});
              }

              if (groundednessResult.blocked) {
                console.warn(
                  `[GroundednessGate] Blocked response for ${phone} — ` +
                  `score=${groundednessResult.score.toFixed(2)} < threshold=${groundednessThreshold} ` +
                  `(${groundednessResult.groundedCount}/${groundednessResult.evaluatedCount} sentences grounded, ` +
                  `${groundednessResult.latencyMs}ms)`
                );
                response = getGroundednessFallback(lang);
                diaryEvent.escalated = true;
              } else {
                console.log(
                  `[GroundednessGate] OK for ${phone} — ` +
                  `score=${groundednessResult.score.toFixed(2)} ` +
                  `(${groundednessResult.groundedCount}/${groundednessResult.evaluatedCount} grounded, ` +
                  `${groundednessResult.latencyMs}ms)`
                );
              }
            }
          }
        } else if (result.flagged && result.totalClaims >= 2) {
          // Fallback to US-899 faithfulness check when hallucination detection is disabled
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
      console.warn(`[Faithfulness/HallucinationDetector] Check failed for ${phone}:`, err.message);
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

  // ─── US-1010: AI Decision Disclosure (PDPA 2025 PCP 3/2025) ────────────
  // When the AI makes a material automated decision, append disclosure and log audit.
  const materialType = getMaterialDecisionType(diaryEvent.intent, diaryEvent.action);
  if (materialType && MATERIAL_DECISION_TYPES.has(materialType)) {
    const disclosureTemplate = await getDisclosureTemplate(profileId);
    response += '\n\n' + disclosureTemplate;
    console.log(`[AiDisclosure] Material decision "${materialType}" for ${phone} — disclosure appended`);

    // Fire-and-forget audit log (AC3: decision type, confidence, human review, outcome)
    logAiDecision({
      profileId,
      phone,
      decisionType: materialType,
      intent: diaryEvent.intent,
      confidenceScore: diaryEvent.confidence,
      aiProvider: devMetadata.model,
      disclosureSent: true,
      metadata: {
        action: diaryEvent.action,
        requestId,
        source: devMetadata.source,
      },
    }).catch(() => {});
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
    ...(hallucinationResult?.isFactualQuery ? {
      hallucinationDetected: hallucinationResult.flagged,
      hallucinationContradictions: hallucinationResult.contradictions,
      hallucinationMaxSeverity: hallucinationResult.maxSeverity,
      hallucinationAction: hallucinationResult.action,
      hallucinationLatencyMs: hallucinationResult.latencyMs,
    } : {}),
    // US-955: Misinformation guardrail metadata
    ...(misinformationResult ? {
      retrievalUsed: misinformationResult.retrievalUsed,
      sourceDocuments: misinformationResult.sourceDocuments.length > 0
        ? misinformationResult.sourceDocuments : undefined,
      groundingConfidence: misinformationResult.groundingConfidence,
      misinformationBlocked: misinformationResult.blocked || undefined,
    } : {}),
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

  // ─── Festive sticker response (US-923) ────────────────────────────
  // Send a sticker if configured for this intent
  if (diaryEvent.intent) {
    try {
      const { sendStickerForIntent } = await import('../sticker-responder.js');
      const stickerSent = await sendStickerForIntent(phone, diaryEvent.intent, profileId, msg.instanceId);
      if (stickerSent) {
        console.log(`[ResponseProcessor] Sent festive sticker for intent '${diaryEvent.intent}' to ${phone}`);
      }
    } catch (stickerErr: any) {
      // Non-fatal: sticker sending failures should not interrupt the main response
      console.warn(`[ResponseProcessor] Failed to send sticker: ${stickerErr.message}`);
    }
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
