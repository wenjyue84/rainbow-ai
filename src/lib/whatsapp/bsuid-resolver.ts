/**
 * bsuid-resolver.ts — Resolve BSUID-keyed conversation keys to real phone numbers (US-926).
 *
 * When a conversation was created with only a BSUID (no phone number available),
 * the phone field in the DB starts with "bsuid:". Before sending via Baileys
 * (which requires a phone-based JID), we attempt to resolve the BSUID to a
 * real phone number using the rainbow_conversations table.
 *
 * If phone is already a real phone number or JID, it passes through unchanged.
 */

const BSUID_KEY_PREFIX = 'bsuid:';

/**
 * Resolve a phone/BSUID key to a sendable phone number.
 *
 * - If phone is a normal number or JID, returns it as-is.
 * - If phone starts with "bsuid:", tries DB lookup for a conversation that
 *   has a phone key mapped to that BSUID.
 * - Returns null if BSUID-only and no phone mapping found.
 */
export async function resolveBsuidToPhone(phone: string): Promise<string | null> {
  // Normal phone number or JID — pass through
  if (!phone.startsWith(BSUID_KEY_PREFIX)) {
    return phone;
  }

  // Extract the raw BSUID value
  const bsuid = phone.slice(BSUID_KEY_PREFIX.length);
  if (!bsuid) return null;

  try {
    // Dynamic import to avoid circular dependency at module load time
    const { lookupPhoneByBsuid } = await import('../../assistant/conversation-db.js');
    const resolvedPhone = await lookupPhoneByBsuid(bsuid);

    if (resolvedPhone && !resolvedPhone.startsWith(BSUID_KEY_PREFIX)) {
      return resolvedPhone;
    }

    // BSUID exists but maps to another BSUID-key (no real phone yet)
    return null;
  } catch (err: any) {
    console.warn(`[BsuidResolver] Failed to resolve BSUID "${bsuid}": ${err.message}`);
    return null;
  }
}
