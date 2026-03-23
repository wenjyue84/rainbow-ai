/**
 * Conversation-level language preference persistence (US-119)
 *
 * Stores the detected guest language preference (en, ms, zh, ta) in
 * rainbow_conversations.metadata for use across multi-turn conversations.
 * Prevents misclassification when guests code-switch between languages.
 */

import { eq } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { rainbowConversations } from '../../shared/schema-tables.js';
import type { SupportedLanguage } from './language-router.js';

export interface ConversationMetadata {
  preferredLanguage?: SupportedLanguage;
  [key: string]: unknown;
}

/**
 * Get conversation metadata from the database.
 * Returns null if conversation doesn't exist or metadata is not set.
 */
export async function getConversationMetadata(
  phone: string
): Promise<ConversationMetadata | null> {
  try {
    const rows = await db
      .select({ metadata: rainbowConversations.metadata })
      .from(rainbowConversations)
      .where(eq(rainbowConversations.phone, phone))
      .limit(1);

    if (rows.length === 0) return null;

    const metadataStr = rows[0].metadata;
    if (!metadataStr) return null;

    try {
      return JSON.parse(metadataStr) as ConversationMetadata;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Get the preferred language from conversation metadata.
 * Returns null if not set.
 */
export async function getConversationPreferredLanguage(
  phone: string
): Promise<SupportedLanguage | null> {
  const metadata = await getConversationMetadata(phone);
  return metadata?.preferredLanguage ?? null;
}

/**
 * Update conversation metadata with a new preferred language.
 * Merges with existing metadata to avoid overwriting other fields.
 */
export async function setConversationPreferredLanguage(
  phone: string,
  language: SupportedLanguage
): Promise<void> {
  try {
    // Get existing metadata
    const existingMetadata = await getConversationMetadata(phone);
    const newMetadata: ConversationMetadata = {
      ...existingMetadata,
      preferredLanguage: language,
    };

    // Update the conversation record
    await db
      .update(rainbowConversations)
      .set({
        metadata: JSON.stringify(newMetadata),
      })
      .where(eq(rainbowConversations.phone, phone));
  } catch (err) {
    console.warn('[ConvLangPref] Failed to set preferred language:', err);
  }
}

/**
 * Check if a message is a greeting (first message or common greetings).
 * Used to detect "first non-greeting message" for language preference detection.
 */
export function isGreetingMessage(text: string, messageCount: number): boolean {
  // First message or very short messages are often just greetings
  if (messageCount === 0) return true;

  const normalized = text.toLowerCase().trim();

  // Common greeting patterns across supported languages
  const greetingPatterns = [
    /^(hi|hello|hey|assalamualaikum|selamat|halo|你好|你们好|வணக்கம்)\b/i,
    /^(ok|okay|yes|yeah|yep|sure|ya|لا|هلا|好的)\b/i,
    /^(thanks|thank you|thx|tq|tqvm|terima kasih|谢谢|ありがとう|வாழ்க)\b/i,
    /^(how are you|apa kabar|你好吗|உன்னை பற்றி எப்படி இருக்கிறாய்)\b/i,
  ];

  return greetingPatterns.some(pattern => pattern.test(normalized));
}
