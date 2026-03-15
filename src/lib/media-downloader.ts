/**
 * Media Auto-Downloader (US-893)
 *
 * Downloads incoming WhatsApp media (image, video, document) from Baileys
 * before the ephemeral URL expires (24-48h). Saves to ./media/<YYYY-MM-DD>/<msgId>.<ext>
 * and returns a /media/... URL served by Express static middleware.
 *
 * Retry policy: up to 3 attempts with exponential backoff (1s, 2s, 4s).
 * On all retries exhausted, logs to DLQ (error log) and returns failure.
 */
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import type { IncomingMessage } from '../assistant/types.js';

export const MEDIA_BASE_DIR = process.env.MEDIA_STORE_PATH ?? './media';
const MAX_RETRIES = 3;

/** Map MIME type (or file extension) to a file extension string */
function resolveExtension(mimeType: string, fileName?: string): string {
  // Prefer extension from fileName if present
  if (fileName) {
    const ext = path.extname(fileName).replace(/^\./, '');
    if (ext) return ext;
  }
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/zip': 'zip',
  };
  return map[mimeType] ?? 'bin';
}

export interface MediaDownloadResult {
  success: boolean;
  localPath?: string;
  localUrl?: string;  // e.g. /media/2026-03-15/abc123.jpg
  error?: string;
}

/**
 * Download and persist a media attachment from an incoming Baileys message.
 *
 * @param msg - IncomingMessage with rawMessage and messageType set
 * @returns MediaDownloadResult with localUrl on success
 */
export async function downloadAndSaveMedia(
  msg: IncomingMessage
): Promise<MediaDownloadResult> {
  if (!msg.rawMessage) {
    return { success: false, error: 'No rawMessage available' };
  }

  if (!['image', 'video', 'document'].includes(msg.messageType)) {
    return { success: false, error: `Unsupported media type: ${msg.messageType}` };
  }

  const messageId = msg.messageId || `unknown-${Date.now()}`;
  const mimeType = msg.mediaMetadata?.mimeType ?? 'application/octet-stream';
  const fileName = msg.mediaMetadata?.fileName;
  const ext = resolveExtension(mimeType, fileName);

  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dirPath = path.join(MEDIA_BASE_DIR, dateStr);
  const filePath = path.join(dirPath, `${messageId}.${ext}`);
  const localUrl = `/media/${dateStr}/${messageId}.${ext}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const buffer = await downloadMediaMessage(
        msg.rawMessage,
        'buffer',
        {}
      ) as Buffer;

      if (!buffer || buffer.length === 0) {
        throw new Error('Empty buffer returned by Baileys');
      }

      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(filePath, buffer);

      console.log(
        `[MediaDownloader] Saved ${msg.messageType} ${messageId} ` +
        `(${buffer.length} bytes, ${mimeType}) -> ${filePath}`
      );
      return { success: true, localPath: filePath, localUrl };

    } catch (err: any) {
      const errMsg = err?.message ?? String(err);
      console.warn(
        `[MediaDownloader] Attempt ${attempt}/${MAX_RETRIES} failed ` +
        `for ${messageId}: ${errMsg}`
      );

      if (attempt < MAX_RETRIES) {
        const backoffMs = Math.pow(2, attempt) * 500; // 1000ms, 2000ms
        await new Promise(r => setTimeout(r, backoffMs));
      } else {
        // DLQ: log final failure for observability / manual recovery
        console.error(
          `[MediaDownloader] DLQ: All ${MAX_RETRIES} attempts failed ` +
          `for ${msg.messageType} ${messageId} (${mimeType}): ${errMsg}`
        );
        return { success: false, error: errMsg };
      }
    }
  }

  return { success: false, error: 'Unexpected exit from retry loop' };
}
