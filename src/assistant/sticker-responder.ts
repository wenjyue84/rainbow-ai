/**
 * sticker-responder.ts — Send stickers for festive intents
 * US-923: WhatsApp sticker response for Malaysian festive season engagement
 */
import fs from 'fs';
import path from 'path';
import { getStickerForIntent } from '../lib/sticker-manager.js';
import { db } from '../lib/db.js';
import { rainbowMessages } from '../../shared/schema-tables.js';
import { whatsappManager } from '../lib/whatsapp/index.js';

/**
 * Check if intent has sticker response and send it.
 * Returns true if sticker was sent, false if no sticker mapping.
 */
export async function sendStickerForIntent(
  phone: string,
  intent: string,
  profileId: string,
  instanceId?: string
): Promise<boolean> {
  try {
    const stickerMapping = await getStickerForIntent(profileId, intent);
    if (!stickerMapping || !stickerMapping.sticker) {
      return false; // No sticker configured for this intent
    }

    const { sticker, greeting } = stickerMapping;

    // Load sticker file from uploads directory
    const stickerBuffer = await loadStickerBuffer(sticker.id, sticker.file_name || sticker.fileName);
    if (!stickerBuffer) {
      console.warn(`[StickerResponder] Could not load sticker ${sticker.id}`);
      return false;
    }

    // Send sticker via Baileys
    await whatsappManager.sendSticker(phone, stickerBuffer, instanceId);

    // Log sticker message to DB
    await logStickerMessage(phone, intent, greeting, profileId, instanceId);

    console.log(`[StickerResponder] Sent sticker for intent '${intent}' to ${phone}`);
    return true;
  } catch (err: any) {
    console.error(`[StickerResponder] Failed to send sticker: ${err.message}`);
    return false;
  }
}

async function loadStickerBuffer(stickerId: string, fileName: string): Promise<Buffer | null> {
  try {
    const possiblePaths = [
      path.join(process.cwd(), 'dist/assistant/stickers', fileName),
      path.join(process.cwd(), 'src/assistant/stickers', fileName),
      path.join(process.cwd(), 'stickers', fileName),
    ];

    for (const filePath of possiblePaths) {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath);
      }
    }

    console.warn(`[StickerResponder] Sticker file not found: ${fileName} (id=${stickerId})`);
    return null;
  } catch (err: any) {
    console.error(`[StickerResponder] Error loading sticker: ${err.message}`);
    return null;
  }
}

async function logStickerMessage(
  phone: string,
  intent: string,
  greeting: string,
  profileId: string,
  _instanceId?: string
): Promise<void> {
  try {
    await db.insert(rainbowMessages).values({
      phone,
      role: 'assistant',
      content: greeting || '[Festive Sticker]',
      messageType: 'sticker',
      intent,
      action: 'sticker_response',
      source: 'sticker_responder',
      profileId,
    });
  } catch (err: any) {
    console.error(`[StickerResponder] Failed to log sticker message: ${err.message}`);
  }
}

/**
 * Format greeting text for sending alongside sticker.
 * Supports multilingual greetings with fallback to English.
 */
export function formatStickerGreeting(
  greetingJson: string,
  language: string = 'en'
): string {
  try {
    const greetings = JSON.parse(greetingJson);
    return greetings[language] || greetings.en || greetingJson;
  } catch {
    return greetingJson; // Return as-is if not JSON
  }
}
