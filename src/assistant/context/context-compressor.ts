/**
 * context-compressor.ts — Conversation Context Compression for Long Threads (US-488)
 *
 * Automatically compresses older conversation turns (turns 1-8) into a single
 * abstractive summary after 15+ turns to prevent context window overflow while
 * maintaining conversation quality and entity preservation.
 *
 * Features:
 * - LLM-based abstractive summarization (preserves initial request, decisions, facts)
 * - Entity extraction to validate >90% preservation (dates, names, numbers)
 * - Trigger condition: activates only after 15 turns
 * - Integration point: called before context loading in intent classifier pipeline
 */

import type { ChatMessage } from '../types.js';
import { providerChat, getProviders, resolveApiKey } from '../ai-provider-manager.js';
import { createModuleLogger } from '../../lib/logger.js';

const logger = createModuleLogger('ContextCompressor');

// ─── Configuration ──────────────────────────────────────────────────

const DEFAULT_MAX_TURNS = 15;
const COMPRESSION_START_TURN = 8; // Compress turns 0-7 (first 8 turns)

// ─── Entity Extraction Patterns ──────────────────────────────────────

/** Extract entities from text using regex patterns */
export function extractEntities(text: string): {
  dates: string[];
  names: string[];
  numbers: string[];
  allEntities: string[];
} {
  const entities = {
    dates: [] as string[],
    names: [] as string[],
    numbers: [] as string[],
    allEntities: [] as string[],
  };

  if (!text) return entities;

  // Extract dates (DD/MM/YYYY, DD-MM-YY, YYYY-MM-DD, month names, etc.)
  const datePatterns = [
    /\d{1,2}\/\d{1,2}\/\d{2,4}/g,      // DD/MM/YYYY
    /\d{1,2}-\d{1,2}-\d{2,4}/g,        // DD-MM-YYYY
    /\d{4}-\d{1,2}-\d{1,2}/g,          // YYYY-MM-DD
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/gi,
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/gi,
    /\b(today|tomorrow|yesterday)\b/gi,
  ];

  for (const pattern of datePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      entities.dates.push(...matches);
    }
  }

  // Extract names (capitalized words, proper nouns)
  // Simple heuristic: sequences of capitalized words (2-3 words max)
  const namePattern = /\b([A-Z][a-z]+(?: [A-Z][a-z]+)*)\b/g;
  const matches = text.match(namePattern);
  if (matches) {
    // Filter out common non-names and duplicates
    entities.names.push(
      ...matches.filter(name =>
        !['I', 'A', 'The', 'And', 'Or', 'Is', 'It', 'Hi', 'Ok', 'Yes', 'No'].includes(name)
      )
    );
  }

  // Extract numbers (integer and decimal)
  const numberPattern = /\b\d+(?:\.\d+)?\b/g;
  const numberMatches = text.match(numberPattern);
  if (numberMatches) {
    entities.numbers.push(...numberMatches);
  }

  // Deduplicate all entities
  entities.dates = [...new Set(entities.dates)];
  entities.names = [...new Set(entities.names)];
  entities.numbers = [...new Set(entities.numbers)];
  entities.allEntities = [...new Set([
    ...entities.dates,
    ...entities.names,
    ...entities.numbers,
  ])];

  return entities;
}

/** Calculate entity preservation ratio */
export function calculateEntityPreservation(
  originalEntities: ReturnType<typeof extractEntities>,
  compressedEntities: ReturnType<typeof extractEntities>
): {
  ratio: number;
  preserved: string[];
  lost: string[];
  details: {
    datesRatio: number;
    namesRatio: number;
    numbersRatio: number;
  };
} {
  const allOriginal = originalEntities.allEntities;
  const allCompressed = compressedEntities.allEntities;

  // Find preserved entities (present in both)
  const preserved = allOriginal.filter(e =>
    allCompressed.some(c => c.toLowerCase() === e.toLowerCase())
  );

  // Find lost entities
  const lost = allOriginal.filter(e =>
    !allCompressed.some(c => c.toLowerCase() === e.toLowerCase())
  );

  // Calculate per-category ratios
  const datesPreserved = originalEntities.dates.filter(d =>
    compressedEntities.dates.some(c => c.toLowerCase() === d.toLowerCase())
  ).length;
  const datesRatio = originalEntities.dates.length > 0
    ? datesPreserved / originalEntities.dates.length
    : 1;

  const namesPreserved = originalEntities.names.filter(n =>
    compressedEntities.names.some(c => c.toLowerCase() === n.toLowerCase())
  ).length;
  const namesRatio = originalEntities.names.length > 0
    ? namesPreserved / originalEntities.names.length
    : 1;

  const numbersPreserved = originalEntities.numbers.filter(n =>
    compressedEntities.numbers.some(c => c === n)
  ).length;
  const numbersRatio = originalEntities.numbers.length > 0
    ? numbersPreserved / originalEntities.numbers.length
    : 1;

  const overallRatio = allOriginal.length > 0
    ? preserved.length / allOriginal.length
    : 1;

  return {
    ratio: overallRatio,
    preserved,
    lost,
    details: {
      datesRatio,
      namesRatio,
      numbersRatio,
    },
  };
}

// ─── Compression Result Type ────────────────────────────────────────

export interface CompressionResult {
  messages: ChatMessage[];
  wasCompressed: boolean;
  originalCount: number;
  compressedCount: number;
  entityPreservation: {
    ratio: number;
    preserved: number;
    lost: number;
  };
  summaryMessage: ChatMessage | null;
}

// ─── Main Compression Function ──────────────────────────────────────

/**
 * Compress conversation context by merging first 8 turns into a summary
 * when conversation exceeds maxTurns (default 15).
 *
 * @param turns - Full conversation history
 * @param maxTurns - Threshold for compression trigger (default: 15)
 * @returns Compressed conversation with metrics
 */
export async function compressContextWindow(
  turns: ChatMessage[],
  maxTurns: number = DEFAULT_MAX_TURNS
): Promise<CompressionResult> {
  // Check if compression is needed
  if (turns.length < maxTurns) {
    return {
      messages: turns,
      wasCompressed: false,
      originalCount: turns.length,
      compressedCount: turns.length,
      entityPreservation: {
        ratio: 1,
        preserved: 0,
        lost: 0,
      },
      summaryMessage: null,
    };
  }

  try {
    // Extract entities from first 8 turns for preservation measurement
    const turnsToCompress = turns.slice(0, COMPRESSION_START_TURN);
    const contextText = turnsToCompress
      .map(t => `${t.role.toUpperCase()}: ${t.content}`)
      .join('\n');

    const originalEntities = extractEntities(contextText);

    // Generate summary using LLM
    const summaryContent = await generateContextSummary(contextText);
    if (!summaryContent) {
      // LLM failed, return uncompressed
      logger.warn('[US-488] LLM summarization failed, returning uncompressed context');
      return {
        messages: turns,
        wasCompressed: false,
        originalCount: turns.length,
        compressedCount: turns.length,
        entityPreservation: {
          ratio: 0,
          preserved: 0,
          lost: 0,
        },
        summaryMessage: null,
      };
    }

    // Create summary message (use timestamp of last message in the compressed range)
    const summaryMessage: ChatMessage = {
      role: 'system',
      content: summaryContent,
      timestamp: turnsToCompress[turnsToCompress.length - 1]?.timestamp || Math.floor(Date.now() / 1000),
    };

    // Build compressed conversation: summary + remaining messages
    const compressedMessages = [summaryMessage, ...turns.slice(COMPRESSION_START_TURN)];

    // Measure entity preservation
    const compressedEntities = extractEntities(summaryContent);
    const preservation = calculateEntityPreservation(originalEntities, compressedEntities);

    logger.info('[US-488] Context compressed', {
      originalCount: turns.length,
      compressedCount: compressedMessages.length,
      entityPreservationRatio: preservation.ratio,
      preservedEntities: preservation.preserved.length,
      lostEntities: preservation.lost.length,
      detailedMetrics: preservation.details,
    });

    return {
      messages: compressedMessages,
      wasCompressed: true,
      originalCount: turns.length,
      compressedCount: compressedMessages.length,
      entityPreservation: {
        ratio: preservation.ratio,
        preserved: preservation.preserved.length,
        lost: preservation.lost.length,
      },
      summaryMessage,
    };
  } catch (error: any) {
    logger.error('[US-488] Compression failed', { error: error.message });
    // Fail-safe: return uncompressed conversation
    return {
      messages: turns,
      wasCompressed: false,
      originalCount: turns.length,
      compressedCount: turns.length,
      entityPreservation: {
        ratio: 0,
        preserved: 0,
        lost: 0,
      },
      summaryMessage: null,
    };
  }
}

// ─── LLM Summarization Helper ───────────────────────────────────────

/**
 * Generate an abstractive summary of conversation context using LLM.
 *
 * Prompt instructions focus on preserving:
 * - Initial request/intent
 * - Intermediate decisions
 * - Key facts (dates, names, numbers)
 * - Step outcomes
 *
 * @param conversationText - Multi-turn conversation formatted as ROLE: content
 * @returns Summary text, or null if generation failed
 */
async function generateContextSummary(conversationText: string): Promise<string | null> {
  const providers = getProviders();
  if (providers.length === 0) {
    logger.warn('[US-488] No AI providers configured');
    return null;
  }

  // Use first available provider with a valid API key
  const provider = providers.find(p => resolveApiKey(p) !== null);
  if (!provider) {
    logger.warn('[US-488] No provider with valid API key');
    return null;
  }

  const systemPrompt = `You are an expert at summarizing multi-turn conversations while preserving critical information.

Your task is to create a concise, abstractive summary that preserves:
1. The initial user request or intent
2. Intermediate decisions or clarifications
3. All key facts (dates, names, numbers, booking details, special requests)
4. Outcomes of previous steps

Format your summary as a single, coherent paragraph that captures the essential narrative.
Do NOT use bullet points or lists. Preserve all specific dates, names, and numbers exactly as they appear.`;

  const userMessage = `Summarize this conversation context in a single paragraph, preserving all dates, names, and numbers:

${conversationText}`;

  try {
    const response = await providerChat(
      provider,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      256, // Limit summary token length
      0.7, // Temperature for balanced accuracy/creativity
      false, // No JSON mode
      undefined, // No tools
      undefined // No JSON schema
    );

    if (!response || !response.content) {
      logger.warn('[US-488] Empty response from LLM');
      return null;
    }

    return response.content.trim();
  } catch (error: any) {
    logger.error('[US-488] LLM call failed', { error: error.message, provider: provider.id });
    return null;
  }
}

export default compressContextWindow;
