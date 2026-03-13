/**
 * Pipeline Stage 2: Knowledge Base Loading
 *
 * Selects relevant topic files based on message content and builds system prompt.
 * Injects detected language instruction into the prompt (US-418).
 */

import type { IPipelineContext } from '../pipeline-context.js';
import type { PipelineState } from '../types.js';

export interface KBLoadingResult {
  systemPrompt: string;
  topicFiles: string[];
  kbFiles: string[];
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ms: 'Malay',
  zh: 'Chinese',
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

  // Build system prompt with base persona + selected topic content
  let systemPrompt = context.buildSystemPrompt(settings.system_prompt, topicFiles);

  // Inject detected language instruction (US-418)
  const langDetectionEnabled = (settings as any).languageDetection?.enabled !== false;
  if (langDetectionEnabled && lang) {
    const langName = LANGUAGE_NAMES[lang] || 'English';
    systemPrompt += `\n\nLANGUAGE INSTRUCTION: The guest's message language has been detected as ${langName} (${lang}). You MUST respond in ${langName}.`;
  }

  return {
    systemPrompt,
    topicFiles,
    kbFiles,
  };
}
