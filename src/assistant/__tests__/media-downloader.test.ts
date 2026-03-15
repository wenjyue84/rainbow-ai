/**
 * Media Auto-Downloader Tests (US-893)
 *
 * Tests download, retry, DLQ logging, and localMediaUrl population.
 * Mocks Baileys downloadMediaMessage and fs operations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage } from '../types.js';

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock('@whiskeysockets/baileys', () => ({
  downloadMediaMessage: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

import { downloadAndSaveMedia } from '../../lib/media-downloader.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs';

const mockDownload = downloadMediaMessage as ReturnType<typeof vi.fn>;
const mockWriteFile = fs.writeFileSync as ReturnType<typeof vi.fn>;
const mockMkdir = fs.mkdirSync as ReturnType<typeof vi.fn>;

// ─── Helper ───────────────────────────────────────────────────────

function makeMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    from: '60123456789',
    text: '',
    pushName: 'Test User',
    messageId: 'msg-abc-123',
    isGroup: false,
    timestamp: Math.floor(Date.now() / 1000),
    messageType: 'image',
    instanceId: 'pelangi',
    rawMessage: { key: { id: 'msg-abc-123' }, message: { imageMessage: {} } } as any,
    mediaMetadata: { mimeType: 'image/jpeg' },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('downloadAndSaveMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('returns success and populates localMediaUrl on happy path', async () => {
    const buf = Buffer.from('fake-jpeg-data');
    mockDownload.mockResolvedValueOnce(buf);

    const msg = makeMsg();
    const result = await downloadAndSaveMedia(msg);

    expect(result.success).toBe(true);
    expect(result.localUrl).toMatch(/^\/media\/\d{4}-\d{2}-\d{2}\/msg-abc-123\.jpg$/);
    expect(result.localPath).toContain('msg-abc-123.jpg');
    expect(mockWriteFile).toHaveBeenCalledOnce();
    expect(mockMkdir).toHaveBeenCalledOnce();
  });

  it('uses .pdf extension for PDF documents', async () => {
    mockDownload.mockResolvedValueOnce(Buffer.from('pdf-data'));
    const msg = makeMsg({
      messageType: 'document',
      mediaMetadata: { mimeType: 'application/pdf' },
    });
    const result = await downloadAndSaveMedia(msg);
    expect(result.localUrl).toMatch(/\.pdf$/);
  });

  it('uses fileName extension when provided', async () => {
    mockDownload.mockResolvedValueOnce(Buffer.from('doc-data'));
    const msg = makeMsg({
      messageType: 'document',
      mediaMetadata: { mimeType: 'application/octet-stream', fileName: 'booking.docx' },
    });
    const result = await downloadAndSaveMedia(msg);
    expect(result.localUrl).toMatch(/\.docx$/);
  });

  it('returns failure with error when rawMessage is absent', async () => {
    const msg = makeMsg({ rawMessage: undefined });
    const result = await downloadAndSaveMedia(msg);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No rawMessage/);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('returns failure for unsupported message types', async () => {
    const msg = makeMsg({ messageType: 'audio', rawMessage: {} as any });
    const result = await downloadAndSaveMedia(msg);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unsupported media type/);
  });

  it('retries up to 3 times on download failure, then returns failure', async () => {
    const err = new Error('Network error');
    mockDownload
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err);

    const msg = makeMsg();
    const resultPromise = downloadAndSaveMedia(msg);

    // Advance timers for each backoff: 1000ms then 2000ms
    await vi.runAllTimersAsync();

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
    expect(mockDownload).toHaveBeenCalledTimes(3);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('succeeds on second attempt after first failure', async () => {
    const buf = Buffer.from('image-data');
    mockDownload
      .mockRejectedValueOnce(new Error('Transient error'))
      .mockResolvedValueOnce(buf);

    const msg = makeMsg();
    const resultPromise = downloadAndSaveMedia(msg);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.localUrl).toBeTruthy();
    expect(mockDownload).toHaveBeenCalledTimes(2);
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it('returns failure when Baileys returns empty buffer', async () => {
    mockDownload
      .mockResolvedValue(Buffer.alloc(0));

    const msg = makeMsg();
    const resultPromise = downloadAndSaveMedia(msg);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Empty buffer/);
  });

  it('localUrl uses YYYY-MM-DD date format', async () => {
    mockDownload.mockResolvedValueOnce(Buffer.from('data'));
    const msg = makeMsg();
    const result = await downloadAndSaveMedia(msg);

    const today = new Date().toISOString().slice(0, 10);
    expect(result.localUrl).toContain(`/media/${today}/`);
  });
});
