/**
 * knowledge-retriever.ts — Knowledge Base Retrieval with Timeout Fallback
 *
 * Wraps knowledge base retrieval with:
 * - Timeout handling (>5s) for retrieval failures
 * - Fallback response generation from intent-specific templates
 * - Language-aware and profile-specific fallback responses
 *
 * Implements US-587: Fallback Response Pipeline for KB Retrieval Failures
 */

import type { RetrievalResult } from './rag/hybrid-retriever.js';
import type { KnowledgeBaseInstance } from './knowledge-base-instance.js';
import type { ConfigStore } from './config-store.js';
import type { IntentCategory } from './types.js';

type Language = 'en' | 'ms' | 'zh' | 'ta';

const RETRIEVAL_TIMEOUT_MS = 5000; // 5 second timeout

/**
 * Fallback response with source tracking
 */
export interface FallbackResponse {
  content: string;
  isFallback: boolean;
  reason?: string;
  retrievalLatencyMs?: number;
}

/**
 * Load fallback templates from a profile's configStore
 */
function loadFallbackTemplates(configStore: ConfigStore): Record<string, Record<Language, string>> {
  try {
    const templates = configStore.getTemplates();
    // Check if templates include fallback entries (intent-specific)
    if (templates && Object.keys(templates).length > 0) {
      return templates as Record<string, Record<Language, string>>;
    }
  } catch (err) {
    console.warn(`[KnowledgeRetriever] Failed to load fallback templates:`, (err as any).message);
  }
  return {};
}

/**
 * Get fallback response for an intent and language
 */
function getFallbackResponse(
  intent: IntentCategory | string,
  language: Language,
  configStore: ConfigStore
): string {
  const templates = loadFallbackTemplates(configStore);

  // Try intent-specific fallback first
  const intentTemplate = templates[intent];
  if (intentTemplate && intentTemplate[language]) {
    return intentTemplate[language];
  }

  // Fall back to generic KB retrieval failed template
  const genericTemplate = templates['kb_retrieval_failed'];
  if (genericTemplate && genericTemplate[language]) {
    return genericTemplate[language];
  }

  // Final fallback for missing templates
  const fallbackText: Record<Language, string> = {
    en: 'I apologize, but I was unable to find that information. Please contact our staff for assistance.',
    ms: 'Saya minta maaf, tetapi saya tidak dapat menemukan informasi tersebut. Sila hubungi kakitangan kami untuk bantuan.',
    zh: '抱歉，我无法找到该信息。请联系我们的员工获取帮助。',
    ta: 'மன்னிக்கவும், ஆனால் நான் அந்த தகவலைக் கண்டுபிடிக்க முடியவில்லை। உதவிக்கு தயவுசெய்து எங்கள் பணியாளர்களைத் தொடர்பு கொள்ளவும்.'
  };

  return fallbackText[language] || fallbackText.en;
}

/**
 * Retrieve knowledge base context with timeout and fallback handling
 *
 * @param kbInstance - KnowledgeBaseInstance to retrieve from
 * @param query - User query/message
 * @param intent - Classified intent (for fallback template selection)
 * @param language - Language preference
 * @param configStore - Profile's ConfigStore (for profile-specific fallback templates)
 * @returns Retrieval result with fallback handling
 */
export async function retrieveWithFallback(
  kbInstance: KnowledgeBaseInstance,
  query: string,
  intent: IntentCategory | string,
  language: Language,
  configStore: ConfigStore
): Promise<FallbackResponse & RetrievalResult> {
  const startTime = Date.now();

  try {
    // Create timeout promise
    const timeoutPromise = new Promise<RetrievalResult>((_, reject) => {
      const timeoutId = setTimeout(() => {
        clearTimeout(timeoutId);
        reject(new Error('Knowledge base retrieval timeout'));
      }, RETRIEVAL_TIMEOUT_MS);
    });

    // Race between retrieval and timeout
    const result = await Promise.race([
      kbInstance.retrieveContext(query),
      timeoutPromise
    ]);

    const latencyMs = Date.now() - startTime;

    // Return successful retrieval with metadata
    return {
      ...result,
      isFallback: false,
      retrievalLatencyMs: latencyMs,
      content: '' // Not used on success
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const reason = (err as any).message || 'Unknown error';

    console.warn(
      `[KnowledgeRetriever] Retrieval failed for intent "${intent}" after ${latencyMs}ms:`,
      reason
    );

    // Generate fallback response
    const fallbackContent = getFallbackResponse(intent, language, configStore);

    return {
      chunks: [],
      hasRelevantContext: false,
      latencyMs: latencyMs,
      content: fallbackContent,
      isFallback: true,
      reason: reason,
      retrievalLatencyMs: latencyMs
    };
  }
}

/**
 * Retrieve knowledge base context without fallback (legacy API)
 * Use retrieveWithFallback for new code
 */
export async function retrieve(
  kbInstance: KnowledgeBaseInstance,
  query: string
): Promise<RetrievalResult> {
  try {
    const timeoutPromise = new Promise<RetrievalResult>((_, reject) => {
      const timeoutId = setTimeout(() => {
        clearTimeout(timeoutId);
        reject(new Error('Knowledge base retrieval timeout'));
      }, RETRIEVAL_TIMEOUT_MS);
    });

    return await Promise.race([
      kbInstance.retrieveContext(query),
      timeoutPromise
    ]);
  } catch (err) {
    console.error('[KnowledgeRetriever] Retrieval failed:', (err as any).message);
    // Return empty result on error
    return {
      chunks: [],
      hasRelevantContext: false,
      latencyMs: 0
    };
  }
}

/**
 * Check if retrieval result is a fallback response
 */
export function isFallbackResponse(result: any): result is FallbackResponse {
  return result && result.isFallback === true;
}

/**
 * Get the fallback content from a retrieval result
 */
export function getFallbackContent(result: FallbackResponse & Partial<RetrievalResult>): string {
  return result.content || '';
}
