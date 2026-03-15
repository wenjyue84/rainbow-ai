/**
 * identity-disclosure.ts — US-970: AI chatbot identity disclosure and anti-impersonation guard
 *
 * WhatsApp January 2026 policy + Malaysia AIGE Transparency Principle require
 * that users are told they are speaking with an AI at the start of every new
 * conversation and when they ask directly.
 *
 * Features:
 *  - isIdentityQuestion(text)          — detects "are you a bot/human?" queries
 *  - getDisclosureText(settings, lang) — first-message disclosure in 4 languages
 *  - getIdentityTruthResponse(...)     — truthful answer to direct identity questions
 *  - logDisclosureAudit(...)           — fire-and-forget compliance audit log entry
 */
import { db } from '../lib/db.js';
import { complianceAuditLog } from '../../shared/schema-tables.js';

// ─── Identity question patterns ──────────────────────────────────────

const IDENTITY_PATTERNS = [
  /\bare\s+you\s+(a\s+)?(bot|robot|ai|machine|computer|chatbot|virtual|automated)\b/i,
  /\bare\s+you\s+human\b/i,
  /\bare\s+you\s+(real|a\s+real\s+(person|human|agent|staff|employee))\b/i,
  /\bwho\s+am\s+i\s+(talking|speaking|chatting)\s+(to|with)\b/i,
  /\bwho\s+(are\s+you|is\s+this)\b/i,
  /\bwhat\s+are\s+you\b/i,
  /\bam\s+i\s+(talking|speaking|chatting)\s+(to|with)\s+(a\s+)?(bot|robot|ai|machine|computer|human)\b/i,
  /\bis\s+(this|there)\s+a\s+(bot|robot|ai|machine|human|real\s+person)\b/i,
  /\b(adakah|awak|kamu|anda)\s+(bot|robot|ai|manusia|orang|pekerja)\b/i,    // Malay
  /你是(机器人|人工智能|AI|真人|人类)/i,                                        // Chinese (no \b — CJK)
  /நீங்கள்\s*(ரோபோ|மனிதன்|AI)/i,                                           // Tamil (basic)
];

/**
 * Returns true if the user text is asking about AI/human identity.
 */
export function isIdentityQuestion(text: string): boolean {
  const normalized = text.trim();
  return IDENTITY_PATTERNS.some(re => re.test(normalized));
}

// ─── Disclosure text ─────────────────────────────────────────────────

const DEFAULT_DISCLOSURE: Record<string, string> = {
  en: "Hi! I'm Rainbow 🌈, an AI assistant for Pelangi Capsule Hostel. I'm here to help with bookings, check-in info, and any questions about your stay. Just know you're chatting with an AI — not a human. Type your question and I'll do my best to help! 😊",
  ms: "Halo! Saya Rainbow 🌈, pembantu AI untuk Pelangi Capsule Hostel. Saya di sini untuk membantu dengan tempahan, maklumat daftar masuk, dan soalan tentang penginapan anda. Sila ambil maklum bahawa anda sedang berbual dengan AI — bukan manusia. Taip soalan anda dan saya akan cuba membantu! 😊",
  zh: "您好！我是 Rainbow 🌈，Pelangi Capsule Hostel 的 AI 助理。我可以帮助您处理预订、入住信息及任何住宿问题。请注意，您正在与 AI 对话，而非真人。请输入您的问题，我会尽力协助！ 😊",
  ta: "வணக்கம்! நான் Rainbow 🌈, Pelangi Capsule Hostel-இன் AI உதவியாளர். புக்கிங், செக்-இன் தகவல்கள் மற்றும் தங்கும் இடம் பற்றிய கேள்விகளுக்கு உதவ நான் இங்கே இருக்கிறேன். நீங்கள் ஒரு AI உடன் பேசுகிறீர்கள் என்பதை தெரிந்துகொள்ளுங்கள். உங்கள் கேள்வியை தட்டச்சு செய்யுங்கள்! 😊",
};

const DEFAULT_IDENTITY_TRUTH: Record<string, string> = {
  en: "Yes, I'm Rainbow 🌈 — an AI assistant for Pelangi Capsule Hostel, not a human. I can help with bookings, check-in info, and general questions about your stay. Would you like to connect with a human team member instead?",
  ms: "Ya, saya Rainbow 🌈 — pembantu AI untuk Pelangi Capsule Hostel, bukan manusia. Saya boleh membantu dengan tempahan, maklumat daftar masuk, dan soalan umum tentang penginapan. Adakah anda ingin berhubung dengan ahli pasukan manusia?",
  zh: "是的，我是 Rainbow 🌈 — Pelangi Capsule Hostel 的 AI 助理，不是真人。我可以帮助您处理预订、入住信息及常见问题。您是否希望与人工客服联系？",
  ta: "ஆம், நான் Rainbow 🌈 — Pelangi Capsule Hostel-இன் AI உதவியாளர், மனிதர் அல்ல. புக்கிங், செக்-இன் தகவல்கள் மற்றும் பொதுவான கேள்விகளுக்கு உதவ முடியும். மனித குழு உறுப்பினருடன் இணைக்கப்பட விரும்புகிறீர்களா?",
};

/**
 * Returns the AI disclosure message for the first outbound message of a new conversation.
 * Uses configured text from settings if available, falls back to built-in defaults.
 */
export function getDisclosureText(
  settings: any,
  lang: 'en' | 'ms' | 'zh' | 'ta'
): string {
  const cfg = settings?.identity_disclosure;
  if (cfg?.disclosure_text?.[lang]) return cfg.disclosure_text[lang];
  if (cfg?.disclosure_text?.en) return cfg.disclosure_text.en;
  return DEFAULT_DISCLOSURE[lang] ?? DEFAULT_DISCLOSURE.en;
}

/**
 * Returns a truthful AI identity response to direct "are you a bot?" questions.
 * Uses configured text from settings if available, falls back to built-in defaults.
 */
export function getIdentityTruthResponse(
  settings: any,
  lang: 'en' | 'ms' | 'zh' | 'ta'
): string {
  const cfg = settings?.identity_disclosure;
  if (cfg?.identity_truth?.[lang]) return cfg.identity_truth[lang];
  if (cfg?.identity_truth?.en) return cfg.identity_truth.en;
  return DEFAULT_IDENTITY_TRUTH[lang] ?? DEFAULT_IDENTITY_TRUTH.en;
}

// ─── Compliance audit logging ─────────────────────────────────────────

/**
 * Fire-and-forget: log an identity disclosure event to the compliance audit log.
 * discloseType: 'opening' (auto disclosure at start) | 'direct_query' (user asked)
 */
export function logDisclosureAudit(
  jid: string,
  profileId: string,
  discloseType: 'opening' | 'direct_query'
): void {
  const intent = discloseType === 'opening'
    ? 'ai_identity_disclosure_opening'
    : 'ai_identity_disclosure_query';

  db.insert(complianceAuditLog).values({
    jid,
    profileId,
    intent,
    intentCategory: 'in_scope',
    routedAction: 'identity_disclosure',
    confidence: 1.0,
    userMessage: discloseType === 'opening' ? '[first message — auto disclosure]' : '[identity question]',
  }).catch((err: Error) => {
    console.warn('[IdentityDisclosure] Audit log write failed:', err.message);
  });
}
