/**
 * Media Downloader — US-893
 *
 * Downloads incoming WhatsApp media (images, documents, videos) before
 * the ephemeral URL expires (24-48 hours). Stores binaries on disk under
 * ./media/YYYY-MM-DD/<messageId>.<ext> and updates the rainbow_messages
 * record with a localMediaUrl.
 *
 * Retry: up to 3 attempts with exponential backoff (2s → 4s → 8s).
 * DLQ: failed downloads are logged with prefix [MediaDownloader:DLQ].
 */

import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { db } from './db.js';
import { rainbowMessages } from '../../shared/schema-tables.js';

const MEDIA_BASE = join(process.cwd(), 'media');

/** Map message type + MIME to a file extension */
function getExt(messageType: string, mimeType: string): string {
  if (messageType === 'image') {
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('gif')) return 'gif';
    if (mimeType.includes('webp')) return 'webp';
    return 'jpg';
  }
  if (messageType === 'video') return 'mp4';
  // document — pick from mime
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('msword') || mimeType.includes('wordprocessingml')) return 'docx';
  if (mimeType.includes('spreadsheetml') || mimeType.includes('ms-excel')) return 'xlsx';
  return 'bin';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download a Baileys media message, persist it to disk, and update the DB record.
 * Returns the local URL path on success, null on failure.
 */
export async function downloadAndSaveMedia(
  baileysMessageId: string,
  messageType: 'image' | 'video' | 'document',
  rawMessage: any,
): Promise<string | null> {
  const msgContent = rawMessage?.message;
  const mimeType: string =
    msgContent?.imageMessage?.mimetype ||
    msgContent?.videoMessage?.mimetype ||
    msgContent?.documentMessage?.mimetype ||
    'application/octet-stream';

  const ext = getExt(messageType, mimeType);
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dir = join(MEDIA_BASE, today);
  const filename = `${baileysMessageId}.${ext}`;
  const filepath = join(dir, filename);
  const localUrl = `/media/${today}/${filename}`;

  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        await sleep(Math.pow(2, attempt) * 1000); // 2s, 4s, 8s
      }

      const buffer = (await downloadMediaMessage(rawMessage, 'buffer', {})) as Buffer;

      mkdirSync(dir, { recursive: true });
      writeFileSync(filepath, buffer);

      // Update the DB record — find by baileysMessageId
      await db
        .update(rainbowMessages)
        .set({ localMediaUrl: localUrl })
        .where(eq(rainbowMessages.baileysMessageId, baileysMessageId));

      console.log(`[MediaDownloader] Saved ${messageType} → ${localUrl} (attempt ${attempt + 1})`);
      return localUrl;
    } catch (err: any) {
      const label = attempt < MAX_RETRIES ? `retrying (${attempt + 1}/${MAX_RETRIES})` : 'giving up';
      console.warn(`[MediaDownloader] Download failed for ${baileysMessageId}: ${err.message} — ${label}`);
    }
  }

  console.error(
    `[MediaDownloader:DLQ] Failed to download ${messageType} message ${baileysMessageId} after ${MAX_RETRIES} retries`,
  );
  return null;
}

/**
 * Fire-and-forget wrapper. Call this from the message pipeline after logging.
 * All errors are caught internally so callers never throw.
 */
export function scheduleMediaDownload(
  baileysMessageId: string,
  messageType: 'image' | 'video' | 'document',
  rawMessage: any,
): void {
  downloadAndSaveMedia(baileysMessageId, messageType, rawMessage).catch((err) => {
    console.error(`[MediaDownloader] Unexpected error for ${baileysMessageId}:`, err?.message);
  });
}
