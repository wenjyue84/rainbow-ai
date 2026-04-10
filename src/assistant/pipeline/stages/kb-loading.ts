/**
 * Pipeline Stage 2: Knowledge Base Loading
 *
 * Selects relevant topic files based on message content and builds system prompt.
 * Injects detected language instruction into the prompt (US-418).
 * US-837: Resolves A/B experiment variant and overrides system prompt when active.
 * US-912: Uses hybrid RAG retrieval (BM25 + vector + cross-encoder) when available,
 *         falling back to regex-based topic selection.
 */

import type { IPipelineContext } from '../pipeline-context.js';
import type { PipelineState } from '../types.js';
import { resolveExperimentPrompt, trackExperimentMessage } from '../../../lib/experiments.js';

export interface KBLoadingResult {
  systemPrompt: string;
  topicFiles: string[];
  kbFiles: string[];
  /** US-837: Active experiment + variant info, if any */
  experiment?: { experimentId: string; variantId: string };
  /** US-912: RAG retrieval metadata */
  ragUsed?: boolean;
  ragLatencyMs?: number;
  ragChunkCount?: number;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ms: 'Malay',
  zh: 'Chinese',
  ta: 'Tamil',
};

/**
 * Stage 2: Knowledge Base Loading
 *
 * When hybrid RAG is ready, retrieves relevant KB chunks via BM25 + vector search
 * with cross-encoder reranking. Falls back to regex-based topic selection otherwise.
 *
 * @param state - Pipeline state containing processText and devMetadata
 * @param context - Pipeline context with KB dependencies
 * @returns KB loading result with system prompt and loaded files
 */
export async function loadKnowledgeBase(
  state: PipelineState,
  context: IPipelineContext
): Promise<KBLoadingResult> {
  const { processText, lang, devMetadata } = state;
  const settings = context.getSettings();

  let topicFiles: string[];
  let ragUsed = false;
  let ragLatencyMs = 0;
  let ragChunkCount = 0;
  let ragContextSnippet = '';

  // US-912: Try hybrid RAG retrieval first
  if (context.ragReady) {
    try {
      const retrieval = await context.retrieveContext(processText);
      ragLatencyMs = retrieval.latencyMs;
      ragChunkCount = retrieval.chunks.length;

      if (retrieval.hasRelevantContext && retrieval.chunks.length > 0) {
        ragUsed = true;
        // Collect unique source files from retrieved chunks
        const sourceFiles = new Set(retrieval.chunks.map(c => c.chunk.source));
        topicFiles = Array.from(sourceFiles);

        // Build RAG context from retrieved chunks (injected after topic files)
        ragContextSnippet = retrieval.chunks
          .map(c => `[Source: ${c.chunk.source} | Relevance: ${c.score.toFixed(2)}]\n${c.chunk.text}`)
          .join('\n\n---\n\n');

        console.log(
          `[KB Loading] RAG: ${retrieval.chunks.length} chunks from [${topicFiles.join(', ')}] ` +
          `(best=${retrieval.chunks[0].score.toFixed(3)}, ${ragLatencyMs}ms)`
        );
      } else {
        // No relevant context found — fall back to regex
        topicFiles = context.guessTopicFiles(processText);
        console.log(`[KB Loading] RAG: no relevant chunks (best below threshold), fallback to regex → [${topicFiles.join(', ')}]`);
      }
    } catch (err: any) {
      console.warn(`[KB Loading] RAG retrieval failed: ${err.message}, fallback to regex`);
      topicFiles = context.guessTopicFiles(processText);
    }
  } else {
    // RAG not ready — use regex-based topic selection
    topicFiles = context.guessTopicFiles(processText);
  }

  // Always include core files (AGENTS.md, soul.md, memory.md) + selected topics
  const kbFiles = ['AGENTS.md', 'soul.md', 'memory.md', ...topicFiles];
  devMetadata.kbFiles = kbFiles;

  console.log(`[KB Loading] Topic files: [${topicFiles.join(', ')}]${ragUsed ? ' (via RAG)' : ' (via regex)'}`);

  // US-837: Check for active experiment and resolve variant for this sender
  const experiments = (settings as any).experiments;
  const experimentResult = resolveExperimentPrompt(state.phone, experiments);

  // Build system prompt — use experiment variant override if active, else default persona
  const basePersona = experimentResult
    ? experimentResult.systemPromptOverride
    : settings.system_prompt;
  let systemPrompt = context.buildSystemPrompt(basePersona, topicFiles);

  // US-912: Append RAG-retrieved context snippets if available
  if (ragUsed && ragContextSnippet) {
    systemPrompt += `\n\n<retrieved_context>\nThe following context was retrieved based on semantic relevance to the guest's query:\n\n${ragContextSnippet}\n</retrieved_context>`;
  }

  // Track experiment message (fire-and-forget)
  if (experimentResult) {
    trackExperimentMessage(experimentResult.experimentId, experimentResult.variantId, state.phone);
    console.log(`[KB Loading] Experiment ${experimentResult.experimentId} variant=${experimentResult.variantId} for ${state.phone.slice(-4)}`);
  }

  // US-955: OWASP LLM09 Misinformation guardrail instruction
  // Instructs the model to refuse guessing on factual questions without KB support.
  const misinfoSettings = (settings as any).misinformation_guardrail;
  if (misinfoSettings?.enabled !== false) {
    systemPrompt += `\n\nFACTUAL ACCURACY RULE: For any factual question about prices, availability, policies, operating hours, or contact information — you MUST only answer based on the knowledge base content provided above. If the information is not in the provided context, acknowledge you don't have that specific information and direct the customer to the contact details shown in the knowledge base. NEVER guess, estimate, or fabricate factual details.`;
  }

  // Inject language instruction (US-418 + US-462)
  // state.lang reflects the effective language — either live-detected or restored from stored preference.
  const langDetectionEnabled = (settings as any).languageDetection?.enabled !== false;
  if (langDetectionEnabled && lang) {
    const langName = LANGUAGE_NAMES[lang] || 'English';
    systemPrompt += `\n\nLANGUAGE INSTRUCTION: Always reply in ${langName}. Do not switch languages unless the guest explicitly does so.`;
  }

  return {
    systemPrompt,
    topicFiles,
    kbFiles,
    experiment: experimentResult
      ? { experimentId: experimentResult.experimentId, variantId: experimentResult.variantId }
      : undefined,
    ragUsed,
    ragLatencyMs,
    ragChunkCount,
  };
}
