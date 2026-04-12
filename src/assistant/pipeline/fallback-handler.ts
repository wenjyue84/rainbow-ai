/**
 * Fallback Handler (US-077)
 *
 * Tracks which fallback template was sent per JID and how many user messages
 * have been received since, enabling escalation correlation metrics.
 *
 * Usage:
 *   1. Call onUserMessageReceived(jid) at the start of each message cycle.
 *   2. Call recordFallbackUsed(jid, templateId) when a fallback response is sent.
 *   3. Call getFallbackCorrelation(jid) when logging an escalation event.
 */

interface FallbackEntry {
  templateId: string;
  msgsSinceFallback: number; // user messages received after fallback was sent
}

// In-memory per-JID fallback tracking (cleared after 2 user messages)
const fallbackTracker = new Map<string, FallbackEntry>();

/**
 * Increment the "messages since fallback" counter for this JID.
 * Call at the start of each user message processing cycle.
 * If counter exceeds 2, the entry is removed (no longer correlatable).
 */
export function onUserMessageReceived(jid: string): void {
  const entry = fallbackTracker.get(jid);
  if (entry) {
    entry.msgsSinceFallback++;
    if (entry.msgsSinceFallback > 2) {
      fallbackTracker.delete(jid);
    }
  }
}

/**
 * Record that a fallback response was sent for this JID.
 * Resets the counter so subsequent escalations can be correlated.
 */
export function recordFallbackUsed(jid: string, templateId: string): void {
  fallbackTracker.set(jid, { templateId, msgsSinceFallback: 0 });
}

/**
 * Returns fallback correlation data for escalation logging.
 * within2Msgs is true if an escalation happened within 2 user messages
 * after a fallback response was sent.
 */
export function getFallbackCorrelation(jid: string): {
  templateId: string | null;
  within2Msgs: boolean;
} {
  const entry = fallbackTracker.get(jid);
  if (!entry) return { templateId: null, within2Msgs: false };
  return { templateId: entry.templateId, within2Msgs: entry.msgsSinceFallback <= 2 };
}

/** Clear tracking for a JID (e.g. on conversation reset). */
export function clearFallbackTracking(jid: string): void {
  fallbackTracker.delete(jid);
}

// ─── US-518: Low-Confidence Intent Fallback Handler with Clarifying Questions ─────

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const logger = { debug: (label: string, data: any) => console.debug(`[${label}]`, data) };

export interface ClarifyingResponse {
  message: string;
  clarifyingQuestions: string[];
  escalationOffer: string;
}

export interface IntentKeywordsData {
  intents: Array<{
    intent: string;
    keywords: Record<string, string[]>;
  }>;
}

/**
 * Load intent keywords from JSON file
 */
function loadIntentKeywords(): IntentKeywordsData {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const keywordsPath = path.join(__dirname, '../data/intent-keywords.json');
    const data = fs.readFileSync(keywordsPath, 'utf-8');
    return JSON.parse(data) as IntentKeywordsData;
  } catch (error) {
    logger.debug('load-intent-keywords', { error: String(error) });
    return { intents: [] };
  }
}

/**
 * Extract top N keywords from an intent's keyword list
 */
function getTopKeywords(intent: string, keywordsData: IntentKeywordsData, topN: number = 3): string[] {
  const intentEntry = keywordsData.intents.find(i => i.intent === intent);
  if (!intentEntry) {
    return [];
  }

  // Get English keywords as default, or any available language
  const keywords = intentEntry.keywords['en'] || Object.values(intentEntry.keywords)[0] || [];
  return keywords.slice(0, topN);
}

/**
 * Generate clarifying response with dynamic questions from intent keywords (US-518)
 */
export function generateClarifyingResponse(
  failedIntent: string,
  language: string = 'en'
): ClarifyingResponse {
  const keywordsData = loadIntentKeywords();
  const topKeywords = getTopKeywords(failedIntent, keywordsData);

  // Template message based on language
  const templates = {
    en: "I didn't quite understand that. Could you clarify?",
    ms: "Saya tidak begitu memahami. Boleh anda jelaskan?",
    zh: "我没有完全理解。能否澄清一下？",
    ta: "நான் அதை சரியாக புரிந்துகொள்ளவில்லை. தயவு செய்து தெளிவுபடுத்த முடியுமா?"
  };

  const message = templates[language as keyof typeof templates] || templates.en;

  // Generate clarifying questions based on top keywords
  const clarifyingQuestions = topKeywords.slice(0, 2).map((keyword, index) => {
    if (language === 'ms') {
      return `${index + 1}. Adakah anda merujuk kepada ${keyword}?`;
    } else if (language === 'zh') {
      return `${index + 1}. 你是否指的是${keyword}?`;
    } else if (language === 'ta') {
      return `${index + 1}. நீங்கள் ${keyword} என்பதை குறிப்பிடுகிறீர்களா?`;
    }
    return `${index + 1}. Did you mean ${keyword}?`;
  });

  // If we have fewer than 2 keywords, add a generic option
  if (clarifyingQuestions.length < 2) {
    const genericQuestions = {
      en: "Something else?",
      ms: "Sesuatu yang lain?",
      zh: "还有别的吗？",
      ta: "வேறு ஏதாவது?"
    };
    clarifyingQuestions.push(`${clarifyingQuestions.length + 1}. ${genericQuestions[language as keyof typeof genericQuestions] || genericQuestions.en}`);
  }

  // Escalation offer
  const escalationOffers = {
    en: "Or would you like to speak with a staff member?",
    ms: "Atau adakah anda ingin bercakap dengan ahli perjawatan?",
    zh: "或者您想与工作人员交谈？",
    ta: "அல்லது நீங்கள் ஒரு பணியாளரிடம் பேச விரும்புகிறீர்களா?"
  };

  const escalationOffer = escalationOffers[language as keyof typeof escalationOffers] || escalationOffers.en;

  return {
    message,
    clarifyingQuestions,
    escalationOffer
  };
}

/**
 * Format clarifying response for sending to user
 */
export function formatClarifyingResponseForDisplay(response: ClarifyingResponse): string {
  const lines = [response.message];
  lines.push('');
  lines.push(...response.clarifyingQuestions);
  lines.push('');
  lines.push(response.escalationOffer);
  return lines.join('\n');
}
