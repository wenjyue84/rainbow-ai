/**
 * WhatsApp Media Validator (US-834)
 *
 * Pre-send validation of media files against WhatsApp size and format limits.
 * Called before sock.sendMessage() to surface actionable errors instead of
 * silent failures at the WhatsApp level.
 */

// ─── Size Limits (bytes) ────────────────────────────────────────────

const MB = 1024 * 1024;

const SIZE_LIMITS: Record<string, number> = {
  image: 5 * MB,
  video: 16 * MB,
  audio: 16 * MB,
  document: 100 * MB,
  sticker: 100 * 1024, // 100KB
};

// ─── Supported MIME Types ───────────────────────────────────────────

const SUPPORTED_MIMES: Record<string, string[]> = {
  image: [
    'image/jpeg', 'image/png', 'image/webp',
  ],
  video: [
    'video/mp4', 'video/3gpp',
  ],
  audio: [
    'audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg',
    'audio/opus', 'audio/ogg; codecs=opus',
  ],
  document: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',    // docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',           // xlsx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',   // pptx
    'application/msword',                                                           // doc
    'application/vnd.ms-excel',                                                     // xls
    'application/vnd.ms-powerpoint',                                                // ppt
    'text/plain',
    'text/csv',
    'application/zip',
    'application/x-zip-compressed',
  ],
  sticker: [
    'image/webp',
  ],
};

// ─── Error Class ────────────────────────────────────────────────────

export class MediaValidationError extends Error {
  code = 'MEDIA_VALIDATION_FAILED' as const;
  reason: string;
  actualSizeMb: number | null;
  limitMb: number | null;

  constructor(reason: string, actualSizeMb: number | null, limitMb: number | null) {
    super(`Media validation failed: ${reason}`);
    this.name = 'MediaValidationError';
    this.reason = reason;
    this.actualSizeMb = actualSizeMb;
    this.limitMb = limitMb;
  }

  toJSON() {
    return {
      code: this.code,
      reason: this.reason,
      actualSizeMb: this.actualSizeMb,
      limitMb: this.limitMb,
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function getMediaCategory(mimeType: string): string | null {
  const mime = mimeType.toLowerCase().split(';')[0].trim();
  for (const [category, mimes] of Object.entries(SUPPORTED_MIMES)) {
    if (mimes.some(m => m.startsWith(mime) || mime.startsWith(m.split(';')[0]))) {
      return category;
    }
  }
  return null;
}

function isSupportedMime(mimeType: string): boolean {
  return getMediaCategory(mimeType) !== null;
}

function roundMb(bytes: number): number {
  return Math.round((bytes / MB) * 100) / 100;
}

// ─── Main Validator ─────────────────────────────────────────────────

/**
 * Validate a media buffer against WhatsApp size and format limits.
 *
 * @param buffer - The media file buffer
 * @param mimeType - MIME type string (e.g. 'image/jpeg')
 * @throws {MediaValidationError} if validation fails
 */
export function validateWhatsAppMedia(buffer: Buffer, mimeType: string): void {
  const mime = mimeType.toLowerCase().trim();

  // 1. Check MIME type is supported
  if (!isSupportedMime(mime)) {
    throw new MediaValidationError(
      `Unsupported MIME type: ${mimeType}. WhatsApp supports: images (JPEG/PNG/WebP), video (MP4/3GPP), audio (AAC/MP3/OGG/AMR/Opus), and documents (PDF/DOCX/XLSX/TXT/CSV).`,
      roundMb(buffer.length),
      null,
    );
  }

  // 2. Determine category and size limit
  const category = getMediaCategory(mime)!;
  const limit = SIZE_LIMITS[category];

  if (!limit) return; // No limit defined for this category (shouldn't happen)

  // 3. Check file size
  if (buffer.length > limit) {
    throw new MediaValidationError(
      `${category} file exceeds WhatsApp ${category} size limit of ${roundMb(limit)}MB`,
      roundMb(buffer.length),
      roundMb(limit),
    );
  }
}
