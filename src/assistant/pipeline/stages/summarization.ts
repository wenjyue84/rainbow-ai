/**
 * Pipeline Stage 1: Conversation Summarization + Token-Aware Pruning
 *
 * Two-phase context reduction:
 * Phase 1: Legacy message-count-based summarization (existing behavior)
 * Phase 2: Token-aware pruning — ensures total context stays within MAX_CONTEXT_TOKENS
 *
 * Excludes the current user message from summarization.
 */

import type { ChatMessage } from '../../types.js';
import type { IPipelineContext } from '../pipeline-context.js';
import type { PipelineState } from '../types.js';
import { pruneContext } from '../../context-pruner.js';

export interface SummarizationResult {
  contextMessages: ChatMessage[];
  wasSummarized: boolean;
  originalCount: number;
  reducedCount: number;
  tokensPruned?: boolean;
  originalTokens?: number;
  prunedTokens?: number;
}

/**
 * Stage 1: Conversation Summarization + Token-Aware Pruning
 *
 * Phase 1: Message-count-based summarization (legacy, via context dependency)
 * Phase 2: Token-budget enforcement (new, via context-pruner)
 *
 * @param state - Pipeline state containing conversation messages
 * @param context - Pipeline context with summarization dependency
 * @returns Summarization result with context messages and metrics
 */
export async function applySummarization(
  state: PipelineState,
  context: IPipelineContext
): Promise<SummarizationResult> {
  const { convo } = state;

  // Phase 1: Legacy message-count summarization
  // Exclude last message (current user message) from summarization
  const summarizationResult = await context.applyConversationSummarization(
    convo.messages.slice(0, -1)
  );

  if (summarizationResult.wasSummarized) {
    const reductionPercent = Math.round(
      (1 - summarizationResult.reducedCount / summarizationResult.originalCount) * 100
    );

    console.log(
      `[Summarization] Conversation summarized: ${summarizationResult.originalCount} -> ${summarizationResult.reducedCount} messages ` +
      `(${reductionPercent}% reduction)`
    );
  }

  // Phase 2: Token-aware pruning
  // Ensures context fits within MAX_CONTEXT_TOKENS even after message-count summarization
  const pruningResult = await pruneContext(summarizationResult.messages);

  if (pruningResult.wasPruned) {
    console.log(
      `[Summarization] Token pruning applied: ${pruningResult.originalTokens} -> ${pruningResult.prunedTokens} tokens`
    );
  }

  return {
    contextMessages: pruningResult.messages,
    wasSummarized: summarizationResult.wasSummarized || pruningResult.wasPruned,
    originalCount: summarizationResult.originalCount,
    reducedCount: pruningResult.prunedCount,
    tokensPruned: pruningResult.wasPruned,
    originalTokens: pruningResult.originalTokens,
    prunedTokens: pruningResult.prunedTokens,
  };
}
