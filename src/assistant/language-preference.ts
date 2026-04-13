/**
 * language-preference.ts — US-462: Per-contact language preference persistence
 *
 * Reads and writes language preference from/to contactDetailsJson.language
 * in rainbow_conversations. Maintains an in-memory cache to avoid DB reads
 * on every message.
 *
 * Thresholds:
 *   >= 0.70 confidence → write preference (first-time set)
 *   >= 0.85 confidence → override existing preference (explicit language switch)
 *   <  0.70 confidence → use stored preference if available
 */

import type { SupportedLanguage } from './language-router.js';
import { getContactDetails, updateContactDetails } from './conversation-contacts.js';

// ─── Cache ───────────────────────────────────────────────────────────

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheEntry {
  lang: SupportedLanguage | null;
  locked: boolean;
  expiresAt: number;
}

const prefCache = new Map<string, CacheEntry>();

/** Exposed for test teardown only. */
export function clearPreferenceCache(): void {
  prefCache.clear();
}

// ─── Thresholds ──────────────────────────────────────────────────────

/** Minimum confidence to persist a first-time language preference. */
export const PREF_WRITE_THRESHOLD = 0.70;

/** Minimum confidence to override an existing stored preference. */
export const PREF_OVERRIDE_THRESHOLD = 0.85;

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Get the stored language preference for a contact.
 * Returns null if no preference has been set.
 */
export async function getPreferredLanguage(
  phone: string
): Promise<SupportedLanguage | null> {
  const now = Date.now();
  const cached = prefCache.get(phone);
  if (cached && now < cached.expiresAt) {
    return cached.lang;
  }

  try {
    const details = await getContactDetails(phone);
    const lang = (details.language as SupportedLanguage | undefined) ?? null;
    const locked = details.languageLocked ?? false;
    prefCache.set(phone, { lang, locked, expiresAt: now + CACHE_TTL_MS });
    return lang;
  } catch {
    return null;
  }
}

/**
 * Returns true if the admin has locked the language for this contact.
 * A locked contact's language preference will not be auto-updated.
 */
export async function isLanguageLocked(phone: string): Promise<boolean> {
  const now = Date.now();
  const cached = prefCache.get(phone);
  if (cached && now < cached.expiresAt) {
    return cached.locked;
  }

  try {
    const details = await getContactDetails(phone);
    const lang = (details.language as SupportedLanguage | undefined) ?? null;
    const locked = details.languageLocked ?? false;
    prefCache.set(phone, { lang, locked, expiresAt: now + CACHE_TTL_MS });
    return locked;
  } catch {
    return false;
  }
}

/**
 * Persist a language preference for a contact.
 * Updates both the DB and the in-memory cache.
 */
export async function setPreferredLanguage(
  phone: string,
  lang: SupportedLanguage
): Promise<void> {
  // Optimistically update cache immediately (before DB write completes)
  const now = Date.now();
  const existing = prefCache.get(phone);
  prefCache.set(phone, {
    lang,
    locked: existing?.locked ?? false,
    expiresAt: now + CACHE_TTL_MS,
  });

  await updateContactDetails(phone, { language: lang });
}

/**
 * Decide the effective language given per-message detection results and stored preference.
 *
 * Logic:
 * 1. If detection confidence >= PREF_WRITE_THRESHOLD, use detected language.
 *    - Write to stored pref (first-time set, or override if >= PREF_OVERRIDE_THRESHOLD).
 * 2. If confidence < PREF_WRITE_THRESHOLD and a stored preference exists, use stored.
 * 3. Otherwise, return detected language as-is (even if low confidence).
 *
 * All DB writes are fire-and-forget (non-blocking).
 *
 * @param phone         Contact's phone/JID
 * @param detected      Per-message detected language
 * @param confidence    Detection confidence (0-1)
 * @param storedLang    Pre-fetched stored preference (null if none)
 * @param locked        Whether the admin has locked the language
 * @returns Effective language to use for this message
 */
export function resolveEffectiveLanguage(
  phone: string,
  detected: SupportedLanguage,
  confidence: number,
  storedLang: SupportedLanguage | null,
  locked: boolean
): SupportedLanguage {
  // High confidence → use detected language
  if (confidence >= PREF_WRITE_THRESHOLD && detected !== 'unknown') {
    if (!locked) {
      const shouldWrite =
        storedLang === null || // first-time set
        (detected !== storedLang && confidence >= PREF_OVERRIDE_THRESHOLD); // explicit override

      if (shouldWrite) {
        setPreferredLanguage(phone, detected).catch((err) =>
          console.warn('[LangPref] Failed to write preference:', err)
        );
      }
    }
    return detected;
  }

  // Low confidence → use stored preference as tie-breaker
  if (storedLang !== null && storedLang !== 'unknown') {
    return storedLang;
  }

  // No stored preference and low confidence → fall back to detected (may be defaultLang)
  return detected;
}

// ─── US-581: Language Preference Inference from First Message ──────────

/**
 * US-581: Infer language preference from first user message and store in database.
 *
 * Flow:
 * 1. If languagePreference is already set in DB, skip detection (use existing preference)
 * 2. Otherwise, detect language from message using detectLanguage()
 * 3. Store detected language in language_preference column
 * 4. Return the inferred or existing preference
 *
 * This avoids per-message language detection overhead and ensures responses
 * use the user's preferred language immediately.
 *
 * @param phone - Phone number / conversation key
 * @param messageText - User's message text
 * @param currentPreference - Current language_preference from DB (if already fetched)
 * @returns The language preference (en|ms|zh|ta|null if unknown)
 */
export async function inferLanguagePreferenceFromFirstMessage(
  phone: string,
  messageText: string,
  currentPreference?: string | null,
): Promise<SupportedLanguage | null> {
  // AC2: Skip language detection if preference already set
  if (currentPreference) {
    return currentPreference as SupportedLanguage | null;
  }

  // AC1: Detect language from first message using existing detectLanguage()
  let { detectLanguage } = await import('./formatter.js');
  const detected = detectLanguage(messageText);

  // Only store if valid language detected (skip 'unknown')
  if (detected !== 'unknown') {
    try {
      const { db } = await import('../lib/db.js');
      const { eq } = await import('drizzle-orm');
      const { rainbowConversations } = await import('../../shared/schema-tables.js');

      await db
        .update(rainbowConversations)
        .set({ languagePreference: detected })
        .where(eq(rainbowConversations.phone, phone));
    } catch (err) {
      // Log but don't throw — inferred value returned even if storage fails
      console.debug(`[US-581] Failed to store language preference for ${phone}:`, err);
    }
  }

  return detected === 'unknown' ? null : (detected as SupportedLanguage);
}
