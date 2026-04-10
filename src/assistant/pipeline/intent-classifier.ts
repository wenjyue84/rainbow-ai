/**
 * Pipeline Phase 3: Intent Classification & Action Dispatch (Orchestrator)
 *
 * Thin orchestrator that calls pipeline stages in sequence:
 * 1. Summarization — reduce conversation context
 * 2. KB Loading — select relevant topic files, build system prompt
 * 2.5. Context Loading — load last 3 messages and inject into system prompt
 * 3. Tier Classification — classify intent via tiered/split/default mode
 * 4. Layer 2 Fallback — retry with smarter model if confidence too low
 * 5. Routing — resolve intent → action mapping
 * 6. Action Dispatch — execute the routed action
 *
 * Mutates state.response, state.diaryEvent, state.devMetadata.
 */

import { createHash } from 'crypto';
import type { RouterContext, PipelineState } from './types.js';
import { createPipelineContext } from './pipeline-context.js';
import { applySummarization } from './stages/summarization.js';
import { loadKnowledgeBase } from './stages/kb-loading.js';
import { loadContextWindow, injectContextWindow } from './stages/context-loader.js';
import { classifyWithTiers } from './stages/tier-classification.js';
import { applyLayer2Fallback } from './stages/layer2-fallback.js';
import { resolveRouting } from './stages/routing.js';
import { dispatchAction } from './stages/action-dispatch.js';
import { isIntentGap, recordUtteranceGap } from './utterance-gap-recorder.js';
import { normalizeManglish } from '../manglish-normalizer.js';
import { shouldAutoEscalate, buildLowConfidenceEscalationContext } from './low-confidence-escalator.js';
import { escalateToStaff } from '../escalation.js';
import { normalizeInput, logNormalization } from './input-normalizer.js';
import { createModuleLogger } from '../../lib/logger.js';
import { db } from '../../lib/db.js';
import { intentAnalytics, escalationQueue, rainbowLowconfMessages, hardCaseQueue } from '../../../shared/schema-tables.js';
import { checkPerIntentThreshold } from '../../lib/intent-thresholds.js';
import { trackIntentPrediction } from '../intent-tracker.js';
import { logClassificationDecision } from './intent-audit-logger.js';
import { logBookingClassificationFailure, BOOKING_INTENT_CATEGORIES, BOOKING_FAILURE_THRESHOLD } from '../booking-failure-logger.js';
import { recordTurnConfidence } from '../turn-confidence-scorer.js';
import fs from 'fs';
import path from 'path';
import { getConversationPreferredLanguage, isGreetingMessage, setConversationPreferredLanguage } from '../conversation-language-preference.js';

const logger = createModuleLogger('IntentClassifier');

function maskPhone(phone: string): string {
  return phone.length > 4 ? phone.slice(0, -4) + 'xxxx' : 'xxxx';
}

function hashInput(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export async function classifyAndRoute(
  state: PipelineState, ctx: RouterContext
): Promise<void> {
  const { phone, convo, lang, msg, devMetadata } = state;
  const classificationStartTime = Date.now();

  // ─── US-318: Input normalisation pre-processor ─────────────────────
  // Runs before all other normalisers. Strips emojis, normalises
  // diacritics (Latin only — Tamil combining marks are preserved),
  // lowercases, and collapses whitespace for consistent classification.
  const inputNorm = normalizeInput(state.processText);
  logNormalization(inputNorm);

  // ─── US-1011: Manglish normalisation pre-processor ───────────────
  // Runs before T2 fuzzy-match and LLM intent classification.
  // Expands abbreviations (brp→berapa, nk→nak) and strips discourse
  // particles (la, lah, lor) so downstream classifiers see cleaner text.
  const rawText = inputNorm.normalized;
  const processText = normalizeManglish(rawText);
  if (processText !== rawText) {
    console.log(`[ManglishNorm] "${rawText}" → "${processText}"`);
  }

  const context = await createPipelineContext(ctx, state.profileConfig, state.profileKB);

  // ─── Guard: AI availability ─────────────────────────────────────
  if (!context.isAIAvailable()) {
    state.response = context.getTemplate('unavailable', lang);
    return;
  }

  // Typing indicator is now sent during tier classification (T3/T4) only
  // ─── Stage 1: Conversation Summarization ─────────────────────────
  const summarization = await applySummarization(state, context);

  // ─── Stage 2: Knowledge Base Loading ─────────────────────────────
  const kb = await loadKnowledgeBase(state, context);

  // US-955: Propagate RAG metadata to PipelineState for misinformation guardrail
  state.ragUsed = kb.ragUsed ?? false;
  state.ragTopicFiles = kb.topicFiles;

  // ─── Stage 2.5: Multi-Turn Context Loader (US-396) ──────────────
  // Load last 3 messages and inject into system prompt for multi-turn context awareness
  const contextLoader = await loadContextWindow(state, context);
  let enhancedSystemPrompt = injectContextWindow(kb.systemPrompt, contextLoader.contextWindow);
  devMetadata.contextMessagesCount = contextLoader.messageCount;
  devMetadata.contextMessagesFiltered = contextLoader.filteredCount;

  // ─── Ack Timer: send "thinking" message if LLM takes >3s ────────
  // US-023: ackCancelled flag prevents duplicate sends when LLM responds
  // just after the 3s timer fires (WhatsApp per-message billing since July 2025).
  let ackSent = false;
  let ackCancelled = false;
  const ackTimer = setTimeout(async () => {
    if (ackCancelled) return; // US-023: main response already in flight
    ackSent = true;
    try {
      await context.sendWhatsAppTypingIndicator(phone, msg.instanceId);
      if (ackCancelled) return; // US-023: check again after first await
      const ackText = context.getTemplate('thinking', lang);
      await ctx.sendMessage(phone, ackText, msg.instanceId);
      context.logMessage(phone, msg.pushName ?? 'Guest', 'assistant', ackText, {
        action: 'thinking', instanceId: msg.instanceId,
        ...(msg.bsuid ? { bsuid: msg.bsuid } : {}),
      }).catch(() => {});
      console.log(`[Router] Sent thinking ack to ${phone} (LLM taking >3s)`);
    } catch { /* non-fatal */ }
  }, 3000);

  // US-023: cancel helper — clears timer AND sets flag to abort any in-flight ack
  const cancelAck = () => { ackCancelled = true; clearTimeout(ackTimer); };

  // ─── Stage 3: Tier Classification ─────────────────────────────────
  let result = await classifyWithTiers(
    {
      processText,
      contextMessages: summarization.contextMessages,
      systemPrompt: enhancedSystemPrompt,
      lastIntent: convo.lastIntent,
      devMetadata,
      phone,
      instanceId: msg.instanceId,
      detectedLanguage: lang,
    },
    context,
    cancelAck
  );

  devMetadata.model = result.model;
  devMetadata.responseTime = result.responseTime;
  devMetadata.usage = result.usage;

  // ─── US-226: Log booking classification failures ───────────────────
  // Log when a booking-related intent is classified with low confidence (<0.65)
  if (BOOKING_INTENT_CATEGORIES.has(result.intent) && result.confidence < BOOKING_FAILURE_THRESHOLD) {
    logBookingClassificationFailure({
      rawInput: processText,
      profileId: state.profileId,
      top3Candidates: [{ intent: result.intent, confidence: result.confidence }],
      messageId: msg.messageId,
    }).catch(() => {});
  }

  // ─── US-119: Store language preference from first non-greeting message ───
  const isFirstMessage = convo.messages.length === 0;
  const isGreeting = isFirstMessage || isGreetingMessage(state.processText, convo.messages.length);
  const storedPreference = await getConversationPreferredLanguage(phone);

  if (!isGreeting && !storedPreference && lang && lang !== 'unknown') {
    // First non-greeting message and no stored preference → store detected language
    await setConversationPreferredLanguage(phone, lang);
    console.log(`[LangPref] Stored preferred language "${lang}" for ${phone.slice(-4)}`);
  }

  // ─── Stage 4: Layer 2 Fallback ────────────────────────────────────
  result = await applyLayer2Fallback(
    result, kb.systemPrompt, summarization.contextMessages,
    processText, devMetadata, context, lang
  );

  // ─── US-002: Confidence threshold gating before fallback escalation ─
  const settings = context.getSettings();
  const confidenceGateThreshold = settings.confidence_threshold ?? 0.5;
  if (result.confidence < confidenceGateThreshold && result.intent !== 'unknown') {
    console.log(
      `[ConfidenceGate] Intent "${result.intent}" confidence ${result.confidence.toFixed(2)} ` +
      `below threshold ${confidenceGateThreshold.toFixed(2)} → routing to fallback`
    );
    result = { ...result, intent: 'unknown', action: 'llm_reply' };
  }

  // ─── US-297: Per-intent per-profile confidence threshold gating ────
  if (result.intent !== 'unknown') {
    const thresholdResult = checkPerIntentThreshold(
      state.profileId,
      result.intent,
      result.confidence
    );
    if (thresholdResult === 'uncertain') {
      result = { ...result, intent: 'unknown', action: 'llm_reply' };
    }
  }

  // ─── US-007: Intent classification debug log ─────────────────────
  logger.debug('classification', {
    phone: maskPhone(phone),
    inputHash: hashInput(processText),
    intent: result.intent,
    confidence: result.confidence,
    tier: devMetadata.source ?? 'unknown',
  });

  // ─── US-280: Archive low-confidence messages for QA review ───────
  if (result.confidence < 0.5) {
    db.insert(rainbowLowconfMessages).values({
      profile: state.profileId,
      messageId: msg.messageId ?? null,
      originalText: processText.slice(0, 2000),
      predictedIntent: result.intent,
      confidence: result.confidence,
    }).catch(() => {}); // fire-and-forget, non-fatal
  }

  // ─── US-376: Hard-case review queue (50-70% confidence) ──────────
  if (result.confidence >= 0.5 && result.confidence <= 0.7) {
    db.insert(hardCaseQueue).values({
      messageText: processText.slice(0, 2000),
      profile: state.profileId,
      predictedIntent: result.intent,
      confidence: result.confidence,
      top3Candidates: [] as any,
    }).catch(() => {}); // fire-and-forget, non-fatal
  }

  // ─── US-043: Record intent classification metrics ─────────────────
  const classificationLatencyMs = Date.now() - classificationStartTime;
  db.insert(intentAnalytics).values({
    profileId: state.profileId,
    intentType: result.intent,
    confidence: result.confidence,
    latencyMs: classificationLatencyMs,
  }).catch(() => {}); // fire-and-forget

  // ─── US-245: Record turn-by-turn confidence metadata ──────────────
  const totalTokens = (devMetadata.usage?.prompt_tokens ?? 0) + (devMetadata.usage?.completion_tokens ?? 0);
  recordTurnConfidence(phone, result.intent, result.confidence, totalTokens)
    .catch(() => {}); // fire-and-forget

  // ─── US-239: Audit log every classification decision ──────────────
  logClassificationDecision({
    profileName: state.profileId,
    messageText: processText,
    classifiedIntent: result.intent,
    confidenceScore: result.confidence,
  }).catch(() => {}); // fire-and-forget

  // ─── US-113: Persist intent prediction confidence scores ──────────
  if (result.confidence >= 0.4) {
    trackIntentPrediction(
      phone,
      phone,
      processText,
      result.intent,
      result.confidence,
      devMetadata.source ?? 'unknown',
      devMetadata.model,
      state.profileId
    ).catch(() => {}); // fire-and-forget, non-fatal
  }

  // ─── US-212: Auto-flag low-confidence classifications for review ───
  if (result.confidence < 0.4) {
    const preview = processText.slice(0, 200);
    const keywords = [...new Set(
      processText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3)
    )].slice(0, 20);

    db.insert(escalationQueue).values({
      conversationId: phone,
      originalIntent: result.intent,
      confidenceScore: result.confidence,
      messagePreview: preview,
      recommendedKeywords: JSON.stringify(keywords),
      profile: state.profileId,
    }).catch(() => {}); // fire-and-forget

    try {
      const logDir = path.join(process.cwd(), 'src', 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logLine = JSON.stringify({
        ts: new Date().toISOString(),
        profile: state.profileId,
        intent: result.intent,
        confidence: result.confidence,
        preview,
      }) + '\n';
      fs.appendFileSync(path.join(logDir, 'escalation-flags.log'), logLine, 'utf-8');
    } catch { /* non-fatal */ }
  }

  // ─── US-432: Record utterance gap if T4 fallback or low confidence ─
  if (isIntentGap(devMetadata.source, result.confidence)) {
    recordUtteranceGap(state.profileId, processText, devMetadata.source || 'unknown')
      .catch(() => {}); // fire-and-forget
  }

  // ─── Stage 5: Routing ─────────────────────────────────────────────
  const routing = await resolveRouting(state, result, ackSent, context);

  // ─── US-023: Cancel ack before main response — prevents duplicate billing ──
  cancelAck();

  // ─── US-373: Low-Confidence Auto-Escalation ───────────────────────
  // Check if confidence is below threshold and auto-escalation is enabled
  if (shouldAutoEscalate({ ...state, classificationResult: result }, context)) {
    console.log(
      `[LowConfidenceEscalation] Auto-escalating: confidence ${result.confidence.toFixed(2)} ` +
      `below threshold`
    );

    const escalationContext = buildLowConfidenceEscalationContext(
      { ...state, classificationResult: result },
      context
    );

    try {
      await escalateToStaff(escalationContext);
      state.diaryEvent.escalated = true;
      state.diaryEvent.escalationReason = 'low_confidence';
      return;
    } catch (err: any) {
      console.error('[LowConfidenceEscalation] Failed to escalate:', err.message);
      // Fall through to normal dispatch if escalation fails
    }
  }

  // ─── Stage 6: Action Dispatch ─────────────────────────────────────
  await dispatchAction(state, result, routing, context);
}
