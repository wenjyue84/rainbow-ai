/**
 * action-dispatch-helpers.ts — Utility functions for action dispatch
 *
 * Extracted from action-dispatch.ts for maintainability.
 * Contains: tiered fallback message builders, greeting menu data,
 * and language resolution logging.
 */

import type { ClassificationResult } from './tier-classification.js';

/**
 * US-880: Tier 1 — Ask user to rephrase (first consecutive unknown).
 * Uses profile-specific message from settings.tiered_fallback.tier1 or a built-in default.
 */
export function buildTier1RephraseMessage(
  settings: any,
  lang: 'en' | 'ms' | 'zh' | 'ta'
): string {
  const configured = settings.tiered_fallback?.tier1?.[lang]
    || settings.tiered_fallback?.tier1?.en;
  if (configured) return configured;

  const defaults: Record<string, string> = {
    en: "I'm sorry, I didn't quite catch that. Could you rephrase or give me more detail? I'm happy to help! 😊",
    ms: "Maaf, saya kurang faham. Boleh anda ulang dengan cara lain atau beri lebih butiran? Saya sedia membantu! 😊",
    zh: "抱歉，我没太明白您的意思。能换个方式或提供更多详情吗？我很乐意帮忙！😊",
    ta: "மன்னிக்கவும், நான் புரிந்துகொள்ளவில்லை. வேறொரு விதத்தில் சொல்ல முடியுமா? நான் உதவ தயாராக இருக்கிறேன்! 😊",
  };
  return defaults[lang] || defaults.en;
}

/**
 * US-880: Tier 2 default capabilities when no suggestions are configured.
 */
export function buildTier2DefaultCapabilities(lang: 'en' | 'ms' | 'zh' | 'ta'): string {
  const msgs: Record<string, string> = {
    en: "Here's what I can help with:\n\n1. Room pricing & availability\n2. Check-in / check-out info\n3. Facilities & WiFi\n4. Location & directions\n5. Contact staff\n\nType a number or ask your question again.",
    ms: "Ini yang boleh saya bantu:\n\n1. Harga & ketersediaan bilik\n2. Info check-in / check-out\n3. Kemudahan & WiFi\n4. Lokasi & arah\n5. Hubungi staf\n\nTaip nombor atau tanya semula soalan anda.",
    zh: "我可以帮助您：\n\n1. 房价与空房查询\n2. 入住/退房信息\n3. 设施与WiFi\n4. 位置与路线\n5. 联系工作人员\n\n请输入数字或重新提问。",
    ta: "நான் உதவக்கூடியவை:\n\n1. அறை விலை & கிடைக்கும் தன்மை\n2. செக்-இன் / செக்-அவுட் தகவல்\n3. வசதிகள் & WiFi\n4. இடம் & திசைகள்\n5. ஊழியர்களை தொடர்பு கொள்ளுங்கள்\n\nஒரு எண்ணை தட்டச்சு செய்யுங்கள் அல்லது மீண்டும் கேளுங்கள்.",
  };
  return msgs[lang] || msgs.en;
}

/**
 * US-445: Build a structured suggestion response from fallback.suggestions config.
 * Returns a numbered text list of suggested options for the user to pick from.
 */
export function buildFallbackSuggestionResponse(
  settings: any,
  lang: 'en' | 'ms' | 'zh' | 'ta'
): string | null {
  const suggestions: Array<{ intent: string; label: Record<string, string> }> =
    settings.fallback?.suggestions;
  if (!suggestions || suggestions.length === 0) return null;

  const headerMessages: Record<string, string> = {
    en: "I'm not sure I understood that. Did you mean one of these?",
    ms: "Maaf, saya kurang pasti. Adakah anda bermaksud salah satu daripada ini?",
    zh: "抱歉，我不太确定您的意思。您是否指以下其中一项？",
  };

  const footerMessages: Record<string, string> = {
    en: "Reply with a number, or type your question again.",
    ms: "Balas dengan nombor, atau taip soalan anda semula.",
    zh: "请回复数字，或重新输入您的问题。",
  };

  const header = headerMessages[lang] || headerMessages.en;
  const footer = footerMessages[lang] || footerMessages.en;

  const lines = suggestions.map((s, i) => {
    const label = s.label?.[lang] || s.label?.en || s.intent;
    return `${i + 1}. ${label}`;
  });

  return `${header}\n\n${lines.join('\n')}\n\n${footer}`;
}

/**
 * US-430: Get greeting menu items by language for interactive list message.
 */
export function getGreetingMenuItems(lang: 'en' | 'ms' | 'zh' | 'ta') {
  const menus: Record<string, {
    title: string; description: string; buttonText: string; sectionTitle: string;
    rows: { rowId: string; title: string; description?: string }[];
  }> = {
    en: {
      title: 'Rainbow AI',
      description: "Hi! I'm Rainbow — how can I help you today?",
      buttonText: 'View Options',
      sectionTitle: 'I can help with',
      rows: [
        { rowId: 'checkin', title: 'Check-in / Check-out', description: 'Arrival & departure info' },
        { rowId: 'pricing', title: 'Pricing & Availability', description: 'Rates and room options' },
        { rowId: 'location', title: 'Location & Directions', description: 'How to find us' },
        { rowId: 'facilities', title: 'Facilities & WiFi', description: 'Amenities info' },
      ],
    },
    ms: {
      title: 'Rainbow AI',
      description: 'Hai! Saya Rainbow — bagaimana saya boleh bantu?',
      buttonText: 'Lihat Pilihan',
      sectionTitle: 'Saya boleh bantu',
      rows: [
        { rowId: 'checkin', title: 'Check-in / Check-out', description: 'Info ketibaan & pelepasan' },
        { rowId: 'pricing', title: 'Harga & Ketersediaan', description: 'Kadar & pilihan bilik' },
        { rowId: 'location', title: 'Lokasi & Arah', description: 'Cara ke sini' },
        { rowId: 'facilities', title: 'Kemudahan & WiFi', description: 'Info kemudahan' },
      ],
    },
    zh: {
      title: 'Rainbow AI',
      description: '你好！我是Rainbow——有什么可以帮您的？',
      buttonText: '查看选项',
      sectionTitle: '我可以帮助',
      rows: [
        { rowId: 'checkin', title: '入住 / 退房', description: '到达和离开信息' },
        { rowId: 'pricing', title: '价格与房源', description: '房价和房间选项' },
        { rowId: 'location', title: '位置与路线', description: '如何找到我们' },
        { rowId: 'facilities', title: '设施与WiFi', description: '设施信息' },
      ],
    },
  };
  return menus[lang] || menus.en;
}

/**
 * Helper: log language resolution when tier differs from conversation state
 */
export function logLanguageResolution(
  context: string,
  lang: 'en' | 'ms' | 'zh' | 'ta',
  responseLang: 'en' | 'ms' | 'zh' | 'ta',
  result: ClassificationResult
): void {
  if (responseLang !== lang && result.detectedLanguage !== 'unknown') {
    console.log(`[Dispatch] Language resolved (${context}): '${lang}' → '${responseLang}'`);
  }
}
