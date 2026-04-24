/**
 * Live Simulation Replay endpoint.
 *
 * POST /admin/replay-classification
 *
 * Runs Stages 1-5 of the intent pipeline (summarization, KB loading,
 * tier classification, layer-2 fallback, routing) in isolation and
 * returns per-stage inputs/outputs. Skips action dispatch, intent
 * tracking, audit logging, utterance gap recording, and any side
 * effects (no DB writes for the message, no WhatsApp sends).
 *
 * Used by the developer Live Simulation audit view to "what-if" a
 * message without touching production state.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';

import { profileRegistry } from '../../assistant/profile-registry.js';
import { createPipelineContext } from '../../assistant/pipeline/pipeline-context.js';
import { applySummarization } from '../../assistant/pipeline/stages/summarization.js';
import { loadKnowledgeBase } from '../../assistant/pipeline/stages/kb-loading.js';
import { classifyWithTiers } from '../../assistant/pipeline/stages/tier-classification.js';
import { applyLayer2Fallback } from '../../assistant/pipeline/stages/layer2-fallback.js';
import { resolveRouting } from '../../assistant/pipeline/stages/routing.js';
import { normalizeInput } from '../../assistant/pipeline/input-normalizer.js';
import { normalizeManglish } from '../../assistant/manglish-normalizer.js';
import type { PipelineState, RouterContext, DevMetadata } from '../../assistant/pipeline/types.js';
import type { IncomingMessage, ConversationState } from '../../assistant/types.js';
import type { ConversationEvent } from '../../assistant/memory-writer.js';

const router = Router();

router.post('/replay-classification', async (req: Request, res: Response) => {
  const started = performance.now();
  const text: string = typeof req.body?.text === 'string' ? req.body.text : '';
  const profileId: string =
    typeof req.body?.profile === 'string' && req.body.profile.length > 0
      ? req.body.profile
      : profileRegistry.getDefaultProfileId();
  const conversationId: string =
    typeof req.body?.conversationId === 'string' && req.body.conversationId.length > 0
      ? req.body.conversationId
      : 'replay-' + randomUUID().slice(0, 8);

  if (!text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const profile = profileRegistry.getProfile(profileId);
  if (!profile) {
    res.status(404).json({ error: `profile "${profileId}" not found` });
    return;
  }

  // ─── Stage 0: Normalisation (mirror intent-classifier.ts) ─────────
  const inputNorm = normalizeInput(text);
  const rawText = inputNorm.normalized;
  const processText = normalizeManglish(rawText);

  // ─── Build no-op router context ────────────────────────────────────
  const noopRouterContext: RouterContext = {
    sendMessage: async () => undefined as any,
    callAPI: async () => undefined as any,
    jayLID: null,
  };

  // ─── Build pipeline context, then strip side-effecting methods ─────
  const baseContext = await createPipelineContext(
    noopRouterContext,
    profile.configStore,
    profile.kb,
  );

  const ctx = {
    ...baseContext,
    sendMessage: async () => undefined as any,
    sendWhatsAppTypingIndicator: async () => undefined,
    logMessage: async () => undefined,
    notifyAdminConfigError: async () => undefined,
    addMessage: () => undefined,
    updateBookingState: () => undefined,
    updateWorkflowState: () => undefined,
    updateActiveFlow: () => undefined,
    incrementUnknown: () => 0,
    resetUnknown: () => undefined,
    updateLastIntent: () => undefined,
    trackIntentPrediction: async () => undefined,
    trackIntentClassified: () => undefined,
    trackEscalation: () => undefined,
    trackWorkflowStarted: () => undefined,
    trackBookingStarted: () => undefined,
    logEscalationEvent: () => undefined,
  } as typeof baseContext;

  // ─── Build minimal PipelineState ───────────────────────────────────
  const phone = conversationId.replace(/@.*$/, '');
  const now = Date.now();
  const msg: IncomingMessage = {
    from: phone,
    text,
    pushName: 'Replay',
    messageId: 'replay-' + randomUUID().slice(0, 8),
    isGroup: false,
    timestamp: Math.floor(now / 1000),
    messageType: 'text' as any,
  };
  const convo: ConversationState = {
    phone,
    profileId,
    pushName: 'Replay',
    messages: [],
    language: 'en',
    bookingState: null,
    workflowState: null,
    activeFlow: null,
    unknownCount: 0,
    createdAt: now,
    lastActiveAt: now,
    lastIntent: null,
    lastIntentConfidence: null,
    lastIntentTimestamp: null,
    slots: {},
    repeatCount: 0,
    lastUserMessageAt: now,
  };
  const devMetadata: DevMetadata = { kbFiles: [] };
  const diaryEvent: ConversationEvent = {} as ConversationEvent;
  const lang = ctx.detectLanguage(processText);

  const state: PipelineState = {
    requestId: 'replay-' + randomUUID().slice(0, 8),
    msg,
    phone,
    text,
    processText,
    foreignLang: null,
    convo,
    lang,
    diaryEvent,
    devMetadata,
    response: null,
    profileId,
    profileConfig: profile.configStore,
    profileKB: profile.kb,
    traceStart: performance.now(),
  };

  const stages: Record<string, any> = {};
  stages.inputNormalizer = { raw: text, normalized: inputNorm.normalized };
  stages.manglishNormalizer = { in: rawText, out: processText };

  try {
    // ─── Stage 1: Summarisation ───────────────────────────────────────
    const t1 = performance.now();
    const summarization = await applySummarization(state, ctx);
    stages.summarization = {
      contextMessages: summarization.contextMessages,
      wasSummarized: summarization.wasSummarized,
      originalCount: summarization.originalCount,
      reducedCount: summarization.reducedCount,
      ms: Math.round(performance.now() - t1),
    };

    // ─── Stage 2: KB Loading ──────────────────────────────────────────
    const t2 = performance.now();
    const kb = await loadKnowledgeBase(state, ctx);
    stages.kbLoading = {
      topicFiles: kb.topicFiles,
      kbFiles: kb.kbFiles,
      ragUsed: kb.ragUsed ?? false,
      ragChunkCount: kb.ragChunkCount ?? 0,
      ragLatencyMs: kb.ragLatencyMs ?? 0,
      systemPromptLen: kb.systemPrompt.length,
      ms: Math.round(performance.now() - t2),
    };

    // ─── Stage 3: Tier Classification ─────────────────────────────────
    const t3 = performance.now();
    let result = await classifyWithTiers(
      {
        processText,
        contextMessages: summarization.contextMessages,
        systemPrompt: kb.systemPrompt,
        lastIntent: convo.lastIntent,
        devMetadata,
        phone,
        instanceId: undefined,
        detectedLanguage: lang,
      },
      ctx,
      () => {},
    );
    stages.tierClassification = {
      tier: devMetadata.source ?? 'unknown',
      intent: result.intent,
      confidence: result.confidence,
      action: result.action,
      model: result.model,
      detectedLanguage: result.detectedLanguage,
      usage: result.usage,
      ms: Math.round(performance.now() - t3),
    };
    devMetadata.model = result.model;
    devMetadata.responseTime = result.responseTime;
    devMetadata.usage = result.usage;

    // ─── Stage 4: Layer 2 Fallback ────────────────────────────────────
    const t4 = performance.now();
    const beforeConfidence = result.confidence;
    const beforeIntent = result.intent;
    result = await applyLayer2Fallback(
      result, kb.systemPrompt, summarization.contextMessages,
      processText, devMetadata, ctx, lang,
    );
    stages.layer2Fallback = {
      triggered: result.intent !== beforeIntent || result.confidence !== beforeConfidence,
      beforeIntent,
      beforeConfidence,
      afterIntent: result.intent,
      afterConfidence: result.confidence,
      ms: Math.round(performance.now() - t4),
    };

    // ─── Stage 5: Routing ─────────────────────────────────────────────
    const t5 = performance.now();
    const routing = await resolveRouting(state, result, false, ctx);
    stages.routing = {
      intent: result.intent,
      action: result.action,
      routedAction: routing.routedAction,
      responseLang: routing.responseLang,
      messageType: routing.messageType,
      ms: Math.round(performance.now() - t5),
    };

    res.json({
      stages,
      finalIntent: result.intent,
      finalConfidence: result.confidence,
      totalMs: Math.round(performance.now() - started),
      modelUsed: devMetadata.model ?? null,
      profileId,
      conversationId,
      dryRun: true,
    });
  } catch (err: any) {
    console.error('[Replay] error:', err);
    res.status(500).json({
      error: err?.message || 'replay failed',
      stages,
      totalMs: Math.round(performance.now() - started),
    });
  }
});

export default router;
