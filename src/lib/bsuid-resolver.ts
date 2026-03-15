/**
 * US-960: BSUID Resolution Utilities
 *
 * Resolves BSUID-keyed identifiers to deliverable JIDs for outbound messaging,
 * and provides guards for authentication templates that require phone numbers.
 */

import { lookupPhoneByBsuid, lookupPhoneByBsuidWithWindow } from '../assistant/conversation-db.js';

/** Prefix used for BSUID-only conversation keys. */
const BSUID_KEY_PREFIX = 'bsuid:';

/** BSUID pattern: CC.AlphaNumeric (same as instance.ts / conversation-db.ts) */
const BSUID_PATTERN = /^[A-Z]{2}\.[A-Za-z0-9]{1,125}$/;

/**
 * Check if a conversation key or JID is BSUID-based (not a phone number).
 */
export function isBsuidKey(key: string): boolean {
  if (key.startsWith(BSUID_KEY_PREFIX)) return true;
  const stripped = key.replace(/@.*$/, '');
  return BSUID_PATTERN.test(stripped);
}

/**
 * Resolve a BSUID-keyed conversation identifier to a deliverable JID.
 *
 * When `from` is BSUID-only (phone hidden), we look up the phone number
 * from the conversation table (within the 30-day coexistence window).
 * If no phone is available, returns the BSUID as a @s.whatsapp.net JID
 * (Baileys may be able to route via the BSUID directly in future versions).
 */
export async function resolveBsuidToJid(key: string): Promise<string> {
  // If it's already a phone-based JID, return as-is
  if (!isBsuidKey(key)) {
    return key.includes('@') ? key : `${key}@s.whatsapp.net`;
  }

  // Extract raw BSUID from prefixed key
  const rawBsuid = key.startsWith(BSUID_KEY_PREFIX)
    ? key.slice(BSUID_KEY_PREFIX.length)
    : key.replace(/@.*$/, '');

  // Try to find a phone number within the 30-day window
  const phone = await lookupPhoneByBsuidWithWindow(rawBsuid);
  if (phone && !phone.startsWith(BSUID_KEY_PREFIX)) {
    console.log(`[BSUID] Resolved ${rawBsuid} → ${phone} for outbound delivery`);
    return phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  }

  // Fallback: no phone mapping available — attempt delivery via BSUID JID
  // Baileys may support @lid or @s.whatsapp.net BSUID routing in future versions
  console.warn(`[BSUID] No phone mapping for ${rawBsuid} — attempting direct BSUID delivery`);
  return `${rawBsuid}@s.whatsapp.net`;
}

/**
 * US-960 AC6: Ensure a phone number (not BSUID) is available for authentication templates.
 * Authentication templates (one-tap, zero-tap, copy-code) require E.164 phone numbers
 * and cannot use BSUIDs.
 *
 * Returns the phone number if available, or null if only BSUID is known.
 */
export async function ensurePhoneForAuthTemplate(key: string): Promise<string | null> {
  // Already a phone number
  if (!isBsuidKey(key)) {
    const digits = key.replace(/\D/g, '');
    return digits.length >= 7 ? digits : null;
  }

  // Extract BSUID and try to resolve to phone
  const rawBsuid = key.startsWith(BSUID_KEY_PREFIX)
    ? key.slice(BSUID_KEY_PREFIX.length)
    : key.replace(/@.*$/, '');

  const phone = await lookupPhoneByBsuid(rawBsuid);
  if (phone && !phone.startsWith(BSUID_KEY_PREFIX)) {
    const digits = phone.replace(/\D/g, '');
    return digits.length >= 7 ? digits : null;
  }

  // No phone available — auth template cannot be sent
  console.warn(`[BSUID] Cannot send auth template: no phone number for BSUID ${rawBsuid}`);
  return null;
}
