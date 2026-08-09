/**
 * Fallback Response Auto-Selection from Confidence Tiers (US-360)
 *
 * Selects appropriate fallback response based on classification confidence tier:
 * - HIGH (≥0.8): Attempt AI response (return original)
 * - MEDIUM (0.5-0.8): Use intent-specific template from knowledge.json
 * - LOW (<0.5): Escalate with staff contact message
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface FallbackResponse {
  text: string;
  tier: 'high' | 'medium' | 'low';
  shouldEscalate: boolean;
}

interface KnowledgeEntry {
  intent: string;
  response: Record<string, string>;
  profile_id?: string;
}

interface KnowledgeBase {
  static: KnowledgeEntry[];
}

// Cache knowledge base data
let knowledgeCache: KnowledgeBase | null = null;

/**
 * Load knowledge base from JSON file
 */
function loadKnowledgeBase(): KnowledgeBase | null {
  if (knowledgeCache) {
    return knowledgeCache;
  }

  const dataDir = join(process.cwd(), 'src', 'assistant', 'data');
  const filePath = join(dataDir, 'knowledge.json');

  if (!existsSync(filePath)) {
    console.warn(`[FallbackSelector] Knowledge base not found: ${filePath}`);
    return null;
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    knowledgeCache = JSON.parse(raw) as KnowledgeBase;
    return knowledgeCache;
  } catch (err: any) {
    console.warn(`[FallbackSelector] Failed to load knowledge base:`, err.message);
    return null;
  }
}

/**
 * Get intent-specific template from knowledge.json
 * @param intent Intent identifier (e.g., 'booking', 'room_inquiry')
 * @param language Language code ('en', 'ms', 'zh', 'ta')
 * @returns Template text or null if not found
 */
function getIntentTemplate(intent: string, language: string = 'en'): string | null {
  const kb = loadKnowledgeBase();
  if (!kb || !kb.static) {
    return null;
  }

  const entry = kb.static.find(
    (e) => e.intent === intent || e.intent.includes(intent)
  );

  if (!entry) {
    return null;
  }

  // Return language-specific response, fallback to English
  return entry.response[language] || entry.response.en || null;
}

/**
 * Hardcoded escalation fallback messages
 */
const ESCALATION_MESSAGES: Record<string, string> = {
  en: "I'm not confident I can help with this. Let me connect you with our team — please reply or contact us for direct assistance.",
  ms: 'Saya tidak pasti saya boleh membantu dengan ini. Izinkan saya hubungkan anda dengan pasukan kami — sila balas atau hubungi kami untuk bantuan langsung.',
  zh: '我不太确定能帮到您。让我为您联系我们的团队——请回复或直接联系我们寻求帮助。',
};

/**
 * Select appropriate fallback response based on confidence tier
 *
 * Tier mapping:
 * - confidence >= 0.8: HIGH — use original AI response (caller should handle)
 * - 0.5 <= confidence < 0.8: MEDIUM — use intent-specific template from knowledge.json
 * - confidence < 0.5: LOW — escalate to staff
 *
 * @param intent Intent identifier (e.g., 'booking_request', 'room_inquiry')
 * @param confidence Confidence score (0-1)
 * @param category Category for context (e.g., 'booking', 'facilities', 'default')
 * @param language Language code for response ('en', 'ms', 'zh', 'ta')
 * @returns FallbackResponse with text, tier, and escalation flag
 */
export function selectFallbackResponse(
  intent: string,
  confidence: number,
  category: string,
  language: string = 'en'
): FallbackResponse {
  // HIGH confidence (>= 0.8): Use original AI response
  if (confidence >= 0.8) {
    return {
      text: '', // Caller should use original AI response
      tier: 'high',
      shouldEscalate: false,
    };
  }

  // MEDIUM confidence (0.5-0.8): Use intent-specific template
  if (confidence >= 0.5) {
    const template = getIntentTemplate(intent, language);
    if (template) {
      return {
        text: template,
        tier: 'medium',
        shouldEscalate: false,
      };
    }

    // Fallback: if template not found, try category-based lookup
    const categoryTemplate = getIntentTemplate(category, language);
    if (categoryTemplate) {
      return {
        text: categoryTemplate,
        tier: 'medium',
        shouldEscalate: false,
      };
    }

    // Last resort: generic inquiry message
    const genericInquiry: Record<string, string> = {
      en: "I want to make sure I understand correctly. Could you provide a bit more detail?",
      ms: 'Saya ingin memastikan saya faham dengan betul. Boleh anda beri maklumat lanjut?',
      zh: '我想确保我正确理解。您能提供更多细节吗？',
    };

    return {
      text: genericInquiry[language] || genericInquiry.en,
      tier: 'medium',
      shouldEscalate: false,
    };
  }

  // LOW confidence (< 0.5): Escalate to staff
  return {
    text: ESCALATION_MESSAGES[language] || ESCALATION_MESSAGES.en,
    tier: 'low',
    shouldEscalate: true,
  };
}

/**
 * Clear the knowledge base cache (useful for testing and hot-reload)
 */
export function clearKnowledgeCache(): void {
  knowledgeCache = null;
}
