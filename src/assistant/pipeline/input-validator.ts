/**
 * Pipeline Phase 1: Input Validation & Preprocessing
 *
 * Handles: group filtering, non-text messages, empty text, staff commands,
 * rate limiting, language detection/translation, conversation setup, sentiment.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, MessageType } from '../types.js';
import type { RouterContext, ValidationResult, PipelineState } from './types.js';
import type { ConversationEvent } from '../memory-writer.js';
import { getOrCreate, addMessage, getOrCreate as getConversation, updateSlots } from '../conversation.js';
import { checkRate } from '../rate-limiter.js';
import { detectLanguage, getTemplate, detectFullLanguage } from '../formatter.js';
import { languageRouter } from '../language-router.js';
import { configStore } from '../config-store.js';
import { profileRegistry } from '../profile-registry.js';
import { handleStaffReply, escalateToStaff, resolveHandoff } from '../escalation.js';
import { isAIAvailable, translateText } from '../ai-client.js';
import { logMessage, logNonTextExchange } from '../conversation-logger.js';
import { setDynamicKnowledge, deleteDynamicKnowledge, listDynamicKnowledge } from '../knowledge.js';
import { resetSentimentTracking, analyzeSentiment, trackSentiment, isSentimentAnalysisEnabled } from '../sentiment-tracker.js';
import { trackMessageReceived, trackRateLimited } from '../../lib/activity-tracker.js';
import { isOptedOut, isOptOutCommand, isOptInCommand, recordOptOut, recordOptIn } from '../opt-out.js';
import { recordConsent } from '../consent.js';
import { detectPromptInjection } from './prompt-injection-guard.js';
import { redactPii } from '../pii-redactor.js';

// ─── Message Deduplication Cache (US-404) ────────────────────────────
// WhatsApp uses at-least-once delivery; this cache discards duplicate msg IDs.

const DEDUP_TTL_MS = parseInt(process.env.DEDUP_TTL_MS ?? '', 10) || 5 * 60 * 1000; // default 5 min
const DEDUP_MAX_TTL_MS = 2 * 60 * 60 * 1000; // hard cap 2 hours
const DEDUP_CLEANUP_MS = 5 * 60 * 1000; // cleanup every 5 minutes

const dedupCache = new Map<string, number>(); // msgId -> expiresAt timestamp

function evictExpiredDedupEntries(): void {
  const now = Date.now();
  for (const [id, expiresAt] of dedupCache) {
    if (now >= expiresAt) dedupCache.delete(id);
  }
}

setInterval(evictExpiredDedupEntries, DEDUP_CLEANUP_MS).unref();

/** Exposed for test teardown only — clears the entire dedup cache. */
export function clearDedupCache(): void { dedupCache.clear(); }

function isDuplicate(msgId: string | undefined): boolean {
  if (!msgId) return false;
  const now = Date.now();
  const expiresAt = dedupCache.get(msgId);
  if (expiresAt !== undefined && now < expiresAt) {
    console.debug(`[Router] Duplicate message suppressed: ${msgId}`);
    return true;
  }
  const ttl = Math.min(DEDUP_TTL_MS, DEDUP_MAX_TTL_MS);
  dedupCache.set(msgId, now + ttl);
  return false;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Prevent raw LLM JSON from being sent to the guest. */
export function ensureResponseText(response: string, lang: 'en' | 'ms' | 'zh'): string {
  const t = response.trim();
  if (!t || !t.startsWith('{') || !t.includes('"')) return response;
  try {
    const parsed = JSON.parse(t);
    const text = typeof parsed.response === 'string' ? parsed.response.trim() : '';
    if (text && !text.trimStart().startsWith('{')) return text;
  } catch {
    // not valid JSON — don't send to guest
  }
  console.warn('[Router] Stripped JSON-like response before send, using error template');
  return getTemplate('error', lang);
}

/** Placeholder content for non-text messages so live chat shows "[Image]", etc. */
function getNonTextPlaceholder(messageType: MessageType): string {
  const labels: Record<MessageType, string> = {
    text: '',
    image: '[Image]',
    audio: '[Voice message]',
    video: '[Video]',
    sticker: '[Sticker]',
    document: '[Document]',
    contact: '[Contact]',
    location: '[Location]'
  };
  return labels[messageType] || `[${messageType}]`;
}

/**
 * Get the response mode for a conversation.
 * Per-conversation override takes precedence over global default.
 * Accepts optional profileConfig for multi-profile support.
 */
export function getConversationMode(phone: string, profileConfig?: import('../config-store.js').ConfigStore): 'autopilot' | 'copilot' | 'manual' {
  const convo = getConversation(phone, 'Guest');
  const store = profileConfig || configStore;
  const settings = store.getSettings();

  if (convo?.slots?.responseMode) {
    return convo.slots.responseMode as 'autopilot' | 'copilot' | 'manual';
  }

  return (settings as any).response_modes?.default_mode || 'autopilot';
}

export function isStaffPhone(jid: string, ctx: RouterContext, profileConfig?: import('../config-store.js').ConfigStore): boolean {
  const store = profileConfig || configStore;
  const staffPhones = store.getSettings().staff.phones;
  if (staffPhones.some(num => jid.includes(num))) return true;
  if (ctx.jayLID && jid === ctx.jayLID) return true;
  return false;
}

export async function handleStaffCommand(
  phone: string, text: string, instanceId: string | undefined, ctx: RouterContext
): Promise<void> {
  const parts = text.split(/\s+/);
  const command = parts[0]?.toLowerCase();

  switch (command) {
    case '!update':
    case '!add': {
      const topic = parts[1];
      const content = parts.slice(2).join(' ');
      if (!topic || !content) {
        await ctx.sendMessage(phone, '⚠️ Usage: !update <topic> <content>\nExample: !update wifi New password is ABC123', instanceId);
        return;
      }
      setDynamicKnowledge(topic, content);
      await ctx.sendMessage(phone, `✅ Knowledge updated: *${topic}*\n${content}`, instanceId);
      return;
    }

    case '!list': {
      const topics = listDynamicKnowledge();
      if (topics.length === 0) {
        await ctx.sendMessage(phone, '📋 No dynamic knowledge entries yet.\nUse !add <topic> <content> to add one.', instanceId);
        return;
      }
      const list = topics.map((t, i) => `${i + 1}. ${t}`).join('\n');
      await ctx.sendMessage(phone, `📋 *Dynamic Knowledge Topics:*\n${list}`, instanceId);
      return;
    }

    case '!delete': {
      const topic = parts[1];
      if (!topic) {
        await ctx.sendMessage(phone, '⚠️ Usage: !delete <topic>', instanceId);
        return;
      }
      const deleted = deleteDynamicKnowledge(topic);
      if (deleted) {
        await ctx.sendMessage(phone, `🗑️ Deleted: *${topic}*`, instanceId);
      } else {
        await ctx.sendMessage(phone, `⚠️ Topic not found: *${topic}*`, instanceId);
      }
      return;
    }

    case '!resolve': {
      const guestPhone = parts[1];
      if (!guestPhone) {
        await ctx.sendMessage(phone, '⚠️ Usage: !resolve <phone>\nExample: !resolve 60123456789', instanceId);
        return;
      }
      // Normalize: strip leading + and non-digits for matching
      const normalizedPhone = guestPhone.replace(/[^0-9]/g, '');
      await resolveHandoff(normalizedPhone);
      await ctx.sendMessage(phone, `✅ AI resumed for +${normalizedPhone}. Bot is back in autopilot mode.`, instanceId);
      return;
    }

    default:
      await ctx.sendMessage(phone, '⚠️ Unknown command. Available: !update, !add, !list, !delete, !resolve', instanceId);
      return;
  }
}

// ─── Main validation & preprocessing ────────────────────────────────

export async function validateAndPrepare(
  msg: IncomingMessage, ctx: RouterContext
): Promise<ValidationResult> {
  // Deduplication — must be first (before group/opt-out checks)
  if (isDuplicate(msg.messageId)) return { continue: false, reason: 'duplicate' };

  // Skip group messages
  if (msg.isGroup) return { continue: false, reason: 'group' };

  const phone = msg.from;

  // Resolve profile from instanceId
  const profile = profileRegistry.isInitialized()
    ? profileRegistry.resolveProfile(msg.instanceId)
    : { id: 'pelangi', configStore, kb: (await import('../knowledge-base.js')).getDefaultKBInstance() };
  const profileConfig = profile.configStore;
  const profileKB = profile.kb;
  const profileId = profile.id;

  // ─── Opt-out / STOP compliance (US-403) ──────────────────────────
  // Check opt-out commands before anything else (text messages only)
  if (msg.messageType === 'text' && msg.text?.trim()) {
    const trimmedText = msg.text.trim();

    if (isOptOutCommand(trimmedText)) {
      try {
        await recordOptOut(phone);
        await ctx.sendMessage(phone, 'You have been unsubscribed. Reply START to re-subscribe.', msg.instanceId);
      } catch {
        // Still return opted_out even if DB write fails
      }
      return { continue: false, reason: 'opted_out' };
    }

    if (isOptInCommand(trimmedText)) {
      try {
        await recordOptIn(phone);
        await ctx.sendMessage(phone, 'Welcome back! You have been re-subscribed.', msg.instanceId);
      } catch {
        // Best effort
      }
      return { continue: false, reason: 'opted_in' };
    }

    // Block messages from opted-out numbers
    if (isOptedOut(phone)) {
      return { continue: false, reason: 'opted_out' };
    }
  }

  // ─── Consent capture (US-424) ────────────────────────────────────
  // Record first-contact consent for this JID (idempotent, non-blocking).
  // Must run after opt-out/opt-in handling (opted-out JIDs should not get a new consent record).
  recordConsent(phone, profileId).catch(() => { });

  // Handle non-text messages
  if (msg.messageType !== 'text') {
    console.log(`[Router] ${phone} (${msg.pushName}): [${msg.messageType}]`);
    const lang = msg.text ? detectLanguage(msg.text) : 'en';
    const nonTextLabel = getNonTextPlaceholder(msg.messageType);
    const replyText = getTemplate('non_text', lang);
    await ctx.sendMessage(phone, replyText, msg.instanceId);
    await logNonTextExchange(phone, msg.pushName, nonTextLabel, replyText, msg.instanceId, profileId);
    return { continue: false, reason: 'non_text' };
  }

  // Skip empty
  let text = msg.text.trim();
  if (!text) return { continue: false, reason: 'empty' };

  // Truncate very long messages to prevent timeout (max 2000 chars)
  const MAX_MESSAGE_LENGTH = 2000;
  if (text.length > MAX_MESSAGE_LENGTH) {
    console.log(`[Router] Message truncated from ${text.length} to ${MAX_MESSAGE_LENGTH} chars`);
    text = text.slice(0, MAX_MESSAGE_LENGTH) + '...';
  }

  const requestId = randomUUID().slice(0, 8);
  console.log(`[Router] [${requestId}] ${phone} (${msg.pushName}): ${text.slice(0, 100)}`);
  trackMessageReceived(phone, msg.pushName, text);

  // ─── Staff Commands & Escalation Tracking ──────────────────────
  if (isStaffPhone(phone, ctx, profileConfig)) {
    if (!ctx.jayLID && phone.includes('@lid')) {
      ctx.jayLID = phone;
      console.log(`[Router] Jay's LID stored: ${ctx.jayLID}`);
    }

    handleStaffReply(phone);
    resetSentimentTracking(phone);

    if (text.startsWith('!')) {
      await handleStaffCommand(phone, text, msg.instanceId, ctx);
      return { continue: false, reason: 'staff_command' };
    }
  }

  // Rate limit check (US-411: profile-specific limits)
  const rateResult = checkRate(phone, profileConfig);
  if (!rateResult.allowed) {
    trackRateLimited(phone);
    const lang = detectLanguage(text);
    const response = getTemplate('rate_limited', lang);
    if (rateResult.reason === 'per-minute limit exceeded') {
      await ctx.sendMessage(phone, response, msg.instanceId);
    }
    return { continue: false, reason: 'rate_limited' };
  }

  // ─── Prompt Injection Detection (US-422) ──────────────────────
  const injectionSettings = (profileConfig.getSettings() as any).promptInjection;
  if (injectionSettings?.enabled !== false) {
    const customPatterns = injectionSettings?.patterns?.length > 0 ? injectionSettings.patterns : undefined;
    const injectionResult = detectPromptInjection(text, customPatterns);
    if (injectionResult.blocked) {
      console.warn(`[Router] Prompt injection blocked from ${phone}: "${text.slice(0, 200)}" (matched: "${injectionResult.matchedPattern}")`);
      const safeResponse = injectionSettings?.safeResponse || 'I can only help with hostel-related questions.';
      await ctx.sendMessage(phone, safeResponse, msg.instanceId);
      return { continue: false, reason: 'prompt_injection' };
    }
  }

  // ─── Language Detection (US-418) ────────────────────────────────
  const langDetectionSettings = (profileConfig.getSettings() as any).languageDetection;
  const langDetectionEnabled = langDetectionSettings?.enabled !== false;
  const confidenceThreshold = langDetectionSettings?.confidenceThreshold ?? 0.6;
  const defaultLang = langDetectionSettings?.defaultLanguage ?? 'en';

  let detectedLanguageConfidence = 0;
  let detectedLang: 'en' | 'ms' | 'zh' = defaultLang as 'en' | 'ms' | 'zh';

  if (langDetectionEnabled) {
    const detection = languageRouter.detectWithConfidence(text);
    detectedLanguageConfidence = detection.confidence;

    if (detection.language !== 'unknown' && detection.confidence >= confidenceThreshold) {
      detectedLang = detection.language as 'en' | 'ms' | 'zh';
    }
    console.debug(`[LanguageDetection] "${text.slice(0, 60)}" → ${detection.language} (confidence: ${detection.confidence.toFixed(2)}, threshold: ${confidenceThreshold}, using: ${detectedLang})`);
  }

  // Foreign script detection + translation (Thai, Japanese, Korean, etc.)
  const foreignLang = detectFullLanguage(text);
  let processText = text;
  if (foreignLang && isAIAvailable()) {
    console.log(`[Router] Detected ${foreignLang} — translating to English for processing`);
    const translated = await translateText(text, foreignLang, 'English');
    if (translated) processText = translated;
  }

  // ─── PII Redaction (US-421) ──────────────────────────────────────
  // Apply AFTER translation so translated text is also redacted before LLM.
  // Original `text` is preserved for DB storage; `processText` goes to LLM.
  const piiSettings = (profileConfig.getSettings() as any).piiRedaction;
  if (piiSettings?.enabled !== false) {
    const piiResult = redactPii(processText);
    if (piiResult.hadPii) {
      console.warn(`[PiiRedactor] Redacted PII types [${piiResult.types.join(', ')}] from message of ${phone}`);
      processText = piiResult.redacted;
    }
  }

  // Get or create conversation (profile-scoped)
  const convo = getOrCreate(phone, msg.pushName, profileId);

  // Update conversation language from detection (US-418)
  if (langDetectionEnabled && detectedLang !== convo.language) {
    convo.language = detectedLang;
  }

  addMessage(phone, 'user', text, profileId);
  logMessage(phone, msg.pushName, 'user', text, { instanceId: msg.instanceId, profileId }).catch(() => { });
  const lang = convo.language;

  // Sentiment analysis
  if (isSentimentAnalysisEnabled()) {
    const messageSentiment = analyzeSentiment(processText);
    trackSentiment(phone, text, messageSentiment);
    console.log(`[Sentiment] ${phone}: ${messageSentiment} (${text.slice(0, 50)}...)`);
  }

  // Build initial diary event and dev metadata
  const diaryEvent: ConversationEvent = {
    phone, pushName: msg.pushName, intent: '', action: '',
    messageType: 'info', confidence: 1, guestText: text,
    escalated: false, bookingStarted: false, workflowStarted: false
  };

  const devMetadata = {
    source: 'unknown' as string,
    model: undefined as string | undefined,
    responseTime: undefined as number | undefined,
    kbFiles: [] as string[],
    routedAction: 'unknown' as string
  };

  return {
    continue: true,
    state: {
      requestId, msg, phone, text, processText, foreignLang,
      convo, lang, diaryEvent, devMetadata, response: null,
      detectedLanguageConfidence,
      profileId, profileConfig, profileKB
    }
  };
}
