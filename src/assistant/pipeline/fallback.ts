/**
 * Confidence-Based Response Routing with Escalation Suggestions (US-232)
 *
 * Evaluates a numeric confidence score and returns a routing decision
 * across three bands:
 *   - LOW   (<0.35): Escalate to staff — returns profile-specific escalation
 *     template with staff WhatsApp contact.
 *   - MEDIUM (0.35–0.60): Polite inquiry — asks the guest to rephrase or
 *     clarify so the AI can try again.
 *   - HIGH  (>0.60): AI response — the original AI-generated response is
 *     used as-is.
 *
 * Escalation templates are loaded from per-profile JSON files:
 *   src/assistant/data/escalation-templates-{profileId}.json
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ─── Types ───────────────────────────────────────────────────────────

export type ConfidenceBand = 'low' | 'medium' | 'high';

export interface ConfidenceRoutingResult {
  /** Which band the confidence score fell into. */
  band: ConfidenceBand;
  /** The response text to send to the guest (escalation template, inquiry, or original AI response). */
  response: string;
  /** Whether the system should escalate to a human staff member. */
  shouldEscalate: boolean;
  /** Staff WhatsApp contact number (only populated for low-confidence escalations). */
  staffContact: string | null;
}

export interface EscalationTemplate {
  /** Template message — may contain `{staff_contact}` placeholder. */
  message: Record<string, string>;
}

export interface EscalationTemplatesFile {
  schema_version: string;
  staff_whatsapp: string;
  templates: Record<string, EscalationTemplate>;
  inquiry_templates: Record<string, string>;
}

// ─── Band thresholds ─────────────────────────────────────────────────

const LOW_THRESHOLD = 0.35;
const MEDIUM_THRESHOLD = 0.60;

// ─── Template cache (per profile) ────────────────────────────────────

const templateCache = new Map<string, EscalationTemplatesFile>();

/**
 * Resolve the data directory. Uses process.cwd() like the rest of the
 * pipeline (esbuild bundles to dist/, so __dirname would be wrong).
 */
function getDataDir(): string {
  return join(process.cwd(), 'src', 'assistant', 'data');
}

/**
 * Load escalation templates for a profile, with caching.
 */
export function loadEscalationTemplates(profileId: string): EscalationTemplatesFile | null {
  if (templateCache.has(profileId)) {
    return templateCache.get(profileId)!;
  }

  const filePath = join(getDataDir(), `escalation-templates-${profileId}.json`);
  if (!existsSync(filePath)) {
    console.warn(`[ConfidenceRouting] Escalation templates not found: ${filePath}`);
    return null;
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data: EscalationTemplatesFile = JSON.parse(raw);
    templateCache.set(profileId, data);
    return data;
  } catch (err: any) {
    console.warn(`[ConfidenceRouting] Failed to parse escalation templates for ${profileId}:`, err.message);
    return null;
  }
}

/** Clear cached templates (useful for testing and hot-reload). */
export function clearTemplateCache(): void {
  templateCache.clear();
}

// ─── Hardcoded fallbacks (if template files are missing) ─────────────

const FALLBACK_ESCALATION: Record<string, string> = {
  en: "I'm not confident I can help with this. Let me connect you with our team — please contact us at +{staff_contact} on WhatsApp for direct assistance.",
  ms: 'Saya tidak pasti saya boleh membantu dengan ini. Izinkan saya hubungkan anda dengan pasukan kami — sila hubungi +{staff_contact} di WhatsApp untuk bantuan langsung.',
  zh: '我不太确定能帮到您。让我为您联系我们的团队——请通过 WhatsApp 联系 +{staff_contact} 获取直接帮助。',
};

const FALLBACK_INQUIRY: Record<string, string> = {
  en: "I want to make sure I help you correctly. Could you provide a bit more detail or rephrase your question?",
  ms: 'Saya ingin memastikan saya membantu anda dengan betul. Boleh anda beri maklumat lanjut atau tulis semula soalan anda?',
  zh: '我想确保能正确帮助您。您能提供更多细节或重新表述您的问题吗？',
};

const FALLBACK_STAFF_CONTACT = '60127088789';

// ─── Main function ───────────────────────────────────────────────────

/**
 * Evaluate the confidence score and return a routing decision.
 *
 * @param confidence  Numeric confidence score (0–1).
 * @param profileId   Profile identifier (e.g. 'pelangi', 'makan', 'southern').
 * @param intentType  Intent classification string (e.g. 'booking.inquiry').
 *                    Used to look up intent-specific escalation templates.
 * @param lang        Language code for the response ('en', 'ms', 'zh', 'ta').
 * @param aiResponse  The original AI-generated response (returned for high confidence).
 */
export function evaluateResponseConfidence(
  confidence: number,
  profileId: string,
  intentType: string,
  lang: string = 'en',
  aiResponse: string = '',
): ConfidenceRoutingResult {
  // ─── HIGH confidence (>0.60): use AI response directly ───────────
  if (confidence > MEDIUM_THRESHOLD) {
    return {
      band: 'high',
      response: aiResponse,
      shouldEscalate: false,
      staffContact: null,
    };
  }

  // Load profile-specific templates
  const templates = loadEscalationTemplates(profileId);

  // ─── MEDIUM confidence (0.35–0.60): polite inquiry ───────────────
  if (confidence >= LOW_THRESHOLD) {
    let inquiryText: string;

    if (templates?.inquiry_templates) {
      inquiryText = templates.inquiry_templates[lang] || templates.inquiry_templates.en || FALLBACK_INQUIRY[lang] || FALLBACK_INQUIRY.en;
    } else {
      inquiryText = FALLBACK_INQUIRY[lang] || FALLBACK_INQUIRY.en;
    }

    return {
      band: 'medium',
      response: inquiryText,
      shouldEscalate: false,
      staffContact: null,
    };
  }

  // ─── LOW confidence (<0.35): escalate to staff ───────────────────
  const staffContact = templates?.staff_whatsapp || FALLBACK_STAFF_CONTACT;

  let escalationText: string;

  // Try intent-specific template first, then fall back to default
  const intentTemplate = templates?.templates?.[intentType];
  if (intentTemplate) {
    escalationText = intentTemplate.message[lang] || intentTemplate.message.en || FALLBACK_ESCALATION[lang] || FALLBACK_ESCALATION.en;
  } else {
    // Try the 'default' template
    const defaultTemplate = templates?.templates?.default;
    if (defaultTemplate) {
      escalationText = defaultTemplate.message[lang] || defaultTemplate.message.en || FALLBACK_ESCALATION[lang] || FALLBACK_ESCALATION.en;
    } else {
      escalationText = FALLBACK_ESCALATION[lang] || FALLBACK_ESCALATION.en;
    }
  }

  // Replace {staff_contact} placeholder
  escalationText = escalationText.replace(/\{staff_contact\}/g, staffContact);

  return {
    band: 'low',
    response: escalationText,
    shouldEscalate: true,
    staffContact,
  };
}
