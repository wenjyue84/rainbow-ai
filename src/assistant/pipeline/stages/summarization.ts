/**
 * Pipeline Stage 1: Conversation Summarization + Token-Aware Pruning
 *
 * Three-phase context reduction (US-447):
 * Phase 0: Load stored DB summary and prepend as system message
 * Phase 1: Legacy message-count-based summarization (existing behavior)
 * Phase 2: Token-aware pruning — ensures total context stays within MAX_CONTEXT_TOKENS
 *
 * After summarization, the summary is persisted to the DB asynchronously
 * so subsequent turns can use it without re-summarizing.
 *
 * Excludes the current user message from summarization.
 */

import type { ChatMessage } from '../../types.js';
import type { IPipelineContext } from '../pipeline-context.js';
import type { PipelineState } from '../types.js';
import { pruneContext } from '../../context-pruner.js';
import { loadContextSummary, saveContextSummary, logSummarizationTokens } from '../../conversation-summary-store.js';
import {
  detectContextLoss, logContextRecoveryEvent,
  CONTEXT_LOSS_CONFIDENCE_THRESHOLD,
} from '../../context-loss-detector.js';

export interface SummarizationResult {
  contextMessages: ChatMessage[];
  wasSummarized: boolean;
  originalCount: number;
  reducedCount: number;
  tokensPruned?: boolean;
  originalTokens?: number;
  prunedTokens?: number;
  /** US-1012: Whether a context-loss re-grounding message was injected */
  contextRecoveryInjected?: boolean;
}

/**
 * Stage 1: Conversation Summarization + Token-Aware Pruning
 *
 * Phase 0: Load stored summary from DB → prepend as system message
 * Phase 1: Message-count-based summarization (legacy, via context dependency)
 * Phase 2: Token-budget enforcement (new, via context-pruner)
 *
 * After Phase 1, if a new summary was generated, it is saved to the DB
 * asynchronously (fire-and-forget) so the current response is not delayed.
 *
 * @param state - Pipeline state containing conversation messages
 * @param context - Pipeline context with summarization dependency
 * @returns Summarization result with context messages and metrics
 */
export async function applySummarization(
  state: PipelineState,
  context: IPipelineContext
): Promise<SummarizationResult> {
  const { convo, phone } = state;

  // Phase 0: Load stored summary from DB and prepend as system context
  let storedSummaryMsg: ChatMessage | null = null;
  try {
    const stored = await loadContextSummary(phone);
    if (stored) {
      storedSummaryMsg = {
        role: 'assistant' as const,
        content: `[Previous Conversation Summary]: ${stored.summary}`,
        timestamp: Math.floor(stored.at.getTime() / 1000),
      };
      console.log(`[Summarization] Loaded stored summary for ${phone} (from ${stored.at.toISOString()})`);
    }
  } catch (err: any) {
    console.error(`[Summarization] Failed to load stored summary: ${err.message}`);
  }

  // Phase 1: Legacy message-count summarization
  // Exclude last message (current user message) from summarization
  const historyMessages = convo.messages.slice(0, -1);
  const summarizationResult = await context.applyConversationSummarization(historyMessages);

  if (summarizationResult.wasSummarized) {
    const reductionPercent = Math.round(
      (1 - summarizationResult.reducedCount / summarizationResult.originalCount) * 100
    );

    console.log(
      `[Summarization] Conversation summarized: ${summarizationResult.originalCount} -> ${summarizationResult.reducedCount} messages ` +
      `(${reductionPercent}% reduction)`
    );

    // US-447: Persist summary to DB asynchronously (fire-and-forget)
    // Extract the summary text from the first message (which is the summary)
    const summaryMsg = summarizationResult.messages[0];
    if (summaryMsg?.content) {
      const summaryText = summaryMsg.content.replace(/^\[Conversation Summary.*?\]:\s*/, '');

      // Log token reduction
      logSummarizationTokens(phone, historyMessages, summaryText);

      // Save to DB — non-blocking so current user message still gets a reply
      saveContextSummary(phone, summaryText).catch((err: any) => {
        console.error(`[Summarization] Async summary save failed: ${err.message}`);
      });
    }
  }

  // Prepend stored summary if we have one and Phase 1 didn't generate a fresh summary
  let messagesForPruning = summarizationResult.messages;
  if (storedSummaryMsg && !summarizationResult.wasSummarized) {
    messagesForPruning = [storedSummaryMsg, ...messagesForPruning];
    console.log(`[Summarization] Prepended stored summary to context (${messagesForPruning.length} messages)`);
  }

  // Phase 2: Token-aware pruning
  // Ensures context fits within MAX_CONTEXT_TOKENS even after message-count summarization
  const pruningResult = await pruneContext(messagesForPruning);

  if (pruningResult.wasPruned) {
    console.log(
      `[Summarization] Token pruning applied: ${pruningResult.originalTokens} -> ${pruningResult.prunedTokens} tokens`
    );
  }

  // Phase 3: US-1012 Context Loss Detection + Re-grounding
  // Check the most recent assistant message for context-loss signals.
  // If detected, inject a re-grounding message so the next LLM call re-anchors
  // to established session facts (name, dates, booking refs, etc.).
  let contextMessages = pruningResult.messages;
  let contextRecoveryInjected = false;

  const lastAssistantMsg = [...pruningResult.messages].reverse().find(m => m.role === 'assistant');
  if (lastAssistantMsg && pruningResult.messages.length >= 3) {
    try {
      const lossResult = detectContextLoss(lastAssistantMsg.content, pruningResult.messages);

      if (lossResult.detected && lossResult.regroundingMessage) {
        console.log(
          `[Summarization][US-1012] Context loss detected (confidence: ${lossResult.confidence.toFixed(2)}, ` +
          `signals: ${lossResult.signals.map(s => s.type).join(', ')}). Injecting re-grounding message.`
        );

        const regroundingMsg: ChatMessage = {
          role: 'assistant' as const,
          content: lossResult.regroundingMessage,
          timestamp: Math.floor(Date.now() / 1000),
        };
        // Inject re-grounding message before the last user message
        const lastUserIdx = [...contextMessages].reverse().findIndex(m => m.role === 'user');
        if (lastUserIdx >= 0) {
          const insertAt = contextMessages.length - lastUserIdx - 1;
          contextMessages = [
            ...contextMessages.slice(0, insertAt),
            regroundingMsg,
            ...contextMessages.slice(insertAt),
          ];
        } else {
          contextMessages = [...contextMessages, regroundingMsg];
        }
        contextRecoveryInjected = true;

        // Log to intent_analytics (fire-and-forget)
        logContextRecoveryEvent(phone, `${phone}-${Date.now()}`, lossResult).catch(() => {});
      }
    } catch (err: any) {
      console.error(`[Summarization][US-1012] Context loss detection failed: ${err.message}`);
    }
  }

  return {
    contextMessages,
    wasSummarized: summarizationResult.wasSummarized || pruningResult.wasPruned,
    originalCount: summarizationResult.originalCount,
    reducedCount: pruningResult.prunedCount,
    tokensPruned: pruningResult.wasPruned,
    originalTokens: pruningResult.originalTokens,
    prunedTokens: pruningResult.prunedTokens,
    contextRecoveryInjected,
  };
}
