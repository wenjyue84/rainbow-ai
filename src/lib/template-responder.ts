/**
 * template-responder.ts — Fallback response matching against knowledge base templates
 *
 * When all AI providers fail, attempt to match user intent against static
 * knowledge.json templates and return a graceful response in the user's language.
 *
 * US-520: Provider Failover Retry Logic
 */

import type { SupportedLanguage } from '../assistant/language-router.js';

export interface KnowledgeTemplate {
  intent: string;
  response: Record<string, string>;
}

/**
 * TemplateResponder — Match intents to static knowledge templates
 */
export class TemplateResponder {
  private templates: KnowledgeTemplate[] = [];

  constructor(templates: KnowledgeTemplate[]) {
    this.templates = templates;
  }

  /**
   * Find a matching template for the given intent
   * @param intent - The intent to match (e.g., 'wifi', 'pricing')
   * @param language - The language to respond in
   * @returns Template response or null if no match
   */
  findTemplate(intent: string, language: SupportedLanguage = 'en'): string | null {
    const template = this.templates.find(t => t.intent === intent);
    if (!template) {
      return null;
    }

    // Return response in requested language, fallback to English
    return template.response[language] || template.response['en'] || null;
  }

  /**
   * Get the graceful fallback message when all providers fail
   * @param language - The user's detected/preferred language
   * @returns Localized fallback message
   */
  getGracefulFallback(language: SupportedLanguage = 'en'): string {
    const fallbacks: Record<SupportedLanguage, string> = {
      en: "I'm temporarily having trouble understanding. Please try again in a moment.",
      ms: "Saya sedang mengalami kesulitan memahami. Sila cuba sebentar lagi.",
      zh: "我暂时无法理解。请稍后再试。",
      ta: "நான் தற்போது புரிந்து கொள்ள முடியாமல் இருக்கிறேன். தயவுசெய்து சிறிது நேரம் பிறகு முயற்சி செய்யவும்.",
    };

    return fallbacks[language] || fallbacks['en'];
  }

  /**
   * Attempt to match intent from user message and return template response
   * This is a simple fallback when no intent classifier is available
   * @param message - User's message
   * @param language - User's language preference
   * @returns Template response or graceful fallback message
   */
  respondToMessage(message: string, language: SupportedLanguage = 'en'): string {
    // Simple keyword matching for common intents
    const lowerMsg = message.toLowerCase();

    const intentKeywords: Record<string, string[]> = {
      'wifi': ['wifi', 'network', 'password', 'internet', 'signal'],
      'pricing': ['price', 'cost', 'rate', 'fee', 'how much', 'berapa', 'harga', '价格'],
      'checkin_info': ['check in', 'check-in', 'daftar masuk', 'daftar', '入住'],
      'checkout_info': ['check out', 'check-out', 'daftar keluar', 'keluar', '退房'],
      'facilities': ['facility', 'facilities', 'kemudahan', 'fasilitas', '设施'],
      'directions': ['directions', 'where', 'location', 'address', 'alamat', '地址'],
    };

    // Find matching intent
    for (const [intent, keywords] of Object.entries(intentKeywords)) {
      if (keywords.some(kw => lowerMsg.includes(kw))) {
        const response = this.findTemplate(intent, language);
        if (response) {
          return response;
        }
      }
    }

    // No match found, return graceful fallback
    return this.getGracefulFallback(language);
  }
}

/**
 * Create a TemplateResponder from a knowledge.json file structure
 * @param knowledgeJson - The parsed knowledge.json file
 * @returns TemplateResponder instance
 */
export function createTemplateResponder(knowledgeJson: any): TemplateResponder {
  const templates: KnowledgeTemplate[] = [];

  // Handle both { static: [...] } and direct array formats
  const items = Array.isArray(knowledgeJson) ? knowledgeJson : knowledgeJson.static || [];

  for (const item of items) {
    if (item.intent && item.response && typeof item.response === 'object') {
      templates.push({
        intent: item.intent,
        response: item.response,
      });
    }
  }

  return new TemplateResponder(templates);
}
