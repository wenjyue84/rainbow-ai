/**
 * Media Downloader Tests (US-893)
 *
 * Verifies that incoming WhatsApp media (image, document, video) is
 * downloaded via Baileys, persisted to disk, and the rainbow_messages
 * record is updated with localMediaUrl.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ─── Module mocks (must be declared before dynamic imports) ──────────────────

const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock('fs', () => ({
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
}));

const mockDbUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  }),
});

vi.mock('../../lib/db.js', () => ({
  db: {
    update: mockDbUpdate,
  },
}));

const mockDownloadMediaMessage = vi.fn();

vi.mock('@whiskeysockets/baileys', () => ({
  downloadMediaMessage: mockDownloadMediaMessage,
}));

vi.mock('../../../shared/schema-tables.js', () => ({
  rainbowMessages: { baileysMessageId: 'baileys_message_id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}));

// ─── SUT ─────────────────────────────────────────────────────────────────────

const { downloadAndSaveMedia, scheduleMediaDownload } = await import('../../lib/media-downloader.js');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MSG_ID = 'ABCD1234567890';

function makeRawMessage(type: 'imageMessage' | 'documentMessage' | 'videoMessage', mimeType: string) {
  return {
    message: {
      [type]: { mimetype: mimeType },
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('downloadAndSaveMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDownloadMediaMessage.mockResolvedValue(Buffer.from('fake-binary-data'));
  });

  it('downloads image and populates localMediaUrl in DB', async () => {
    const raw = makeRawMessage('imageMessage', 'image/jpeg');

    const result = await downloadAndSaveMedia(MSG_ID, 'image', raw);

    expect(result).toMatch(/^\/media\/\d{4}-\d{2}-\d{2}\/ABCD1234567890\.jpg$/);
    expect(mockDownloadMediaMessage).toHaveBeenCalledOnce();
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    expect(mockMkdirSync).toHaveBeenCalledOnce();

    // DB update called with correct localMediaUrl
    const setCall = mockDbUpdate.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith(
      expect.objectContaining({ localMediaUrl: expect.stringMatching(/ABCD1234567890\.jpg$/) }),
    );
  });

  it('downloads document (PDF) and uses .pdf extension', async () => {
    const raw = makeRawMessage('documentMessage', 'application/pdf');

    const result = await downloadAndSaveMedia(MSG_ID, 'document', raw);

    expect(result).toMatch(/\.pdf$/);
  });

  it('downloads video and uses .mp4 extension', async () => {
    const raw = makeRawMessage('videoMessage', 'video/mp4');

    const result = await downloadAndSaveMedia(MSG_ID, 'video', raw);

    expect(result).toMatch(/\.mp4$/);
  });

  it('retries up to 3 times on transient failure then succeeds', async () => {
    mockDownloadMediaMessage
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(Buffer.from('ok'));

    // Speed up retries in tests by mocking setTimeout
    vi.useFakeTimers();
    const downloadPromise = downloadAndSaveMedia(MSG_ID, 'image', makeRawMessage('imageMessage', 'image/png'));
    // Advance through exponential backoff delays
    await vi.runAllTimersAsync();
    const result = await downloadPromise;
    vi.useRealTimers();

    expect(result).not.toBeNull();
    expect(mockDownloadMediaMessage).toHaveBeenCalledTimes(3);
  });

  it('returns null and logs DLQ after 4 consecutive failures', async () => {
    mockDownloadMediaMessage.mockRejectedValue(new Error('network error'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.useFakeTimers();
    const downloadPromise = downloadAndSaveMedia(MSG_ID, 'image', makeRawMessage('imageMessage', 'image/jpeg'));
    await vi.runAllTimersAsync();
    const result = await downloadPromise;
    vi.useRealTimers();

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[MediaDownloader:DLQ]'),
    );
    consoleSpy.mockRestore();
  });
});

describe('scheduleMediaDownload', () => {
  it('fires and forgets without throwing', async () => {
    mockDownloadMediaMessage.mockResolvedValue(Buffer.from('data'));

    // Should not throw
    expect(() =>
      scheduleMediaDownload(MSG_ID, 'image', makeRawMessage('imageMessage', 'image/jpeg')),
    ).not.toThrow();
  });
});
