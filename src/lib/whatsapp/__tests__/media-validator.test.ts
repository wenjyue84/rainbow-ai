/**
 * Unit tests for WhatsApp media validator (US-834)
 */
import { describe, it, expect } from 'vitest';
import { validateWhatsAppMedia, MediaValidationError } from '../media-validator.js';

const MB = 1024 * 1024;

function makeBuffer(sizeBytes: number): Buffer {
  return Buffer.alloc(sizeBytes);
}

describe('validateWhatsAppMedia', () => {
  // ─── Supported types pass ─────────────────────────────────────────

  it('accepts JPEG image under 5MB', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(4 * MB), 'image/jpeg')).not.toThrow();
  });

  it('accepts PNG image under 5MB', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(3 * MB), 'image/png')).not.toThrow();
  });

  it('accepts WebP image under 5MB', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(1 * MB), 'image/webp')).not.toThrow();
  });

  it('accepts MP4 video under 16MB', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(15 * MB), 'video/mp4')).not.toThrow();
  });

  it('accepts AAC audio under 16MB', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(10 * MB), 'audio/aac')).not.toThrow();
  });

  it('accepts MP3 audio under 16MB', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(8 * MB), 'audio/mpeg')).not.toThrow();
  });

  it('accepts OGG audio under 16MB', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(5 * MB), 'audio/ogg')).not.toThrow();
  });

  it('accepts AMR audio under 16MB', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(1 * MB), 'audio/amr')).not.toThrow();
  });

  it('accepts PDF document under 100MB', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(50 * MB), 'application/pdf')).not.toThrow();
  });

  it('accepts DOCX document under 100MB', () => {
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(() => validateWhatsAppMedia(makeBuffer(10 * MB), mime)).not.toThrow();
  });

  it('accepts XLSX document under 100MB', () => {
    const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(() => validateWhatsAppMedia(makeBuffer(10 * MB), mime)).not.toThrow();
  });

  // ─── Boundary size conditions ─────────────────────────────────────

  it('accepts image at exactly 5MB', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(5 * MB), 'image/jpeg')).not.toThrow();
  });

  it('rejects image at 5MB + 1 byte', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(5 * MB + 1), 'image/jpeg')).toThrow(MediaValidationError);
  });

  it('accepts video at exactly 16MB', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(16 * MB), 'video/mp4')).not.toThrow();
  });

  it('rejects video at 16MB + 1 byte', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(16 * MB + 1), 'video/mp4')).toThrow(MediaValidationError);
  });

  it('rejects audio at 16MB + 1 byte', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(16 * MB + 1), 'audio/aac')).toThrow(MediaValidationError);
  });

  // ─── Unsupported MIME types ───────────────────────────────────────

  it('rejects GIF images', () => {
    const err = getValidationError(makeBuffer(1 * MB), 'image/gif');
    expect(err.code).toBe('MEDIA_VALIDATION_FAILED');
    expect(err.reason).toContain('Unsupported MIME type');
  });

  it('rejects BMP images', () => {
    const err = getValidationError(makeBuffer(1 * MB), 'image/bmp');
    expect(err.code).toBe('MEDIA_VALIDATION_FAILED');
  });

  it('rejects AVI videos', () => {
    const err = getValidationError(makeBuffer(1 * MB), 'video/avi');
    expect(err.code).toBe('MEDIA_VALIDATION_FAILED');
  });

  it('rejects MKV videos', () => {
    const err = getValidationError(makeBuffer(1 * MB), 'video/x-matroska');
    expect(err.code).toBe('MEDIA_VALIDATION_FAILED');
  });

  it('rejects WAV audio', () => {
    const err = getValidationError(makeBuffer(1 * MB), 'audio/wav');
    expect(err.code).toBe('MEDIA_VALIDATION_FAILED');
  });

  it('rejects application/json', () => {
    const err = getValidationError(makeBuffer(100), 'application/json');
    expect(err.code).toBe('MEDIA_VALIDATION_FAILED');
  });

  // ─── Error structure ──────────────────────────────────────────────

  it('error includes structured fields for oversized image', () => {
    const err = getValidationError(makeBuffer(6 * MB), 'image/jpeg');
    expect(err.code).toBe('MEDIA_VALIDATION_FAILED');
    expect(err.reason).toContain('size limit');
    expect(err.actualSizeMb).toBeCloseTo(6, 0);
    expect(err.limitMb).toBeCloseTo(5, 0);
  });

  it('error includes structured fields for unsupported type', () => {
    const err = getValidationError(makeBuffer(100), 'image/tiff');
    expect(err.code).toBe('MEDIA_VALIDATION_FAILED');
    expect(err.reason).toContain('Unsupported MIME type');
    expect(err.limitMb).toBeNull();
  });

  it('toJSON returns serializable error object', () => {
    const err = getValidationError(makeBuffer(6 * MB), 'image/jpeg');
    const json = err.toJSON();
    expect(json).toEqual({
      code: 'MEDIA_VALIDATION_FAILED',
      reason: expect.any(String),
      actualSizeMb: expect.any(Number),
      limitMb: expect.any(Number),
    });
  });

  // ─── Case insensitivity ───────────────────────────────────────────

  it('handles uppercase MIME types', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(1 * MB), 'IMAGE/JPEG')).not.toThrow();
  });

  it('handles MIME types with charset parameters', () => {
    expect(() => validateWhatsAppMedia(makeBuffer(1 * MB), 'text/plain; charset=utf-8')).not.toThrow();
  });
});

function getValidationError(buffer: Buffer, mimeType: string): MediaValidationError {
  try {
    validateWhatsAppMedia(buffer, mimeType);
    throw new Error('Expected MediaValidationError but none was thrown');
  } catch (err) {
    if (err instanceof MediaValidationError) return err;
    throw err;
  }
}
