/**
 * Pipeline Stage 2: Knowledge Base Loading
 *
 * Selects relevant topic files based on message content and builds system prompt.
 * Injects detected language instruction into the prompt (US-418).
 * US-837: Resolves A/B experiment variant and overrides system prompt when active.
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
 * Selects relevant topic files based on message content,
 * builds system prompt with persona + topics.
 * Appends detected language instruction so the LLM responds in the correct language.
 *
 * @param state - Pipeline state containing processText and devMetadata
 * @param context - Pipeline context with KB dependencies
 * @returns KB loading result with system prompt and loaded files
 */
export function loadKnowledgeBase(
  state: PipelineState,
  context: IPipelineContext
): KBLoadingResult {
  const { processText, lang, devMetadata } = state;
  const settings = context.getSettings();

  // Guess which topic files are relevant to this message
  const topicFiles = context.guessTopicFiles(processText);

  // Always include core files (AGENTS.md, soul.md, memory.md) + selected topics
  const kbFiles = ['AGENTS.md', 'soul.md', 'memory.md', ...topicFiles];
  devMetadata.kbFiles = kbFiles;

  console.log(`[KB Loading] Topic files: [${topicFiles.join(', ')}]`);

  // US-837: Check for active experiment and resolve variant for this sender
  const experiments = (settings as any).experiments;
  const experimentResult = resolveExperimentPrompt(state.phone, experiments);

  // Build system prompt — use experiment variant override if active, else default persona
  const basePersona = experimentResult
    ? experimentResult.systemPromptOverride
    : settings.system_prompt;
  let systemPrompt = context.buildSystemPrompt(basePersona, topicFiles);

  // Track experiment message (fire-and-forget)
  if (experimentResult) {
    trackExperimentMessage(experimentResult.experimentId, experimentResult.variantId, state.phone);
    console.log(`[KB Loading] Experiment ${experimentResult.experimentId} variant=${experimentResult.variantId} for ${state.phone.slice(-4)}`);
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
  };
}
