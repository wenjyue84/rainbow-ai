/**
 * Tests for US-935: WhatsApp outbound template language variants
 * for multilingual guest communication
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../lib/db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
}));

vi.mock('../../lib/session-window.js', () => ({
  sessionWindowActive: vi.fn().mockResolvedValue(true),
  logSessionExpired: vi.fn(),
}));

vi.mock('../../assistant/opt-out.js', () => ({
  isOptedOut: vi.fn().mockReturnValue(false),
}));

vi.mock('../../lib/whatsapp-cost.js', () => ({
  recordWhatsappMessageCost: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/baileys-client.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../assistant/conversation-logger.js', () => ({
  logMessage: vi.fn().mockResolvedValue(undefined),
  getConversation: vi.fn().mockResolvedValue({ pushName: 'TestGuest' }),
}));

vi.mock('../../assistant/language-preference.js', () => ({
  getPreferredLanguage: vi.fn().mockResolvedValue(null),
}));

// ─── Imports ─────────────────────────────────────────────────────────

import { pool } from '../../lib/db.js';
import { sendWhatsAppMessage } from '../../lib/baileys-client.js';
import { getPreferredLanguage } from '../../assistant/language-preference.js';
import {
  _getTemplateContent,
  _TEMPLATES,
  _processScheduledMessages,
} from '../../lib/booking-sequence.js';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;
const mockSendWA = sendWhatsAppMessage as ReturnType<typeof vi.fn>;
const mockGetLang = getPreferredLanguage as ReturnType<typeof vi.fn>;

// Helper to create a pending scheduled message row
function makePendingRow(overrides: Record<string, any> = {}) {
  return {
    id: 'msg-001',
    jid: '60123456789@s.whatsapp.net',
    profile_id: 'pelangi',
    send_at: new Date(Date.now() - 60_000), // 1 min ago (due)
    template_key: 'booking_confirmation',
    variables: JSON.stringify({
      guestName: 'Wei',
      arrivalDate: '2026-04-01',
      checkInTime: '14:00',
      roomType: 'Capsule',
      confirmationNumber: 'BK-ZH-001',
    }),
    status: 'pending',
    booking_id: 'bk-test-zh',
    sequence_step: 'confirmation',
    ...overrides,
  };
}

describe('US-935: Template language variants for multilingual guests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  // ─── AC1: Language preference used for template selection ────────

  describe('AC1: Guest language preference used for outbound templates', () => {
    it('sends Chinese template when guest preference is zh', async () => {
      mockGetLang.mockResolvedValue('zh');
      const row = makePendingRow();
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      // Subsequent calls (markMessage) resolve normally
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await _processScheduledMessages();

      expect(mockGetLang).toHaveBeenCalledWith('60123456789@s.whatsapp.net');
      expect(mockSendWA).toHaveBeenCalledTimes(1);
      const sentContent = mockSendWA.mock.calls[0][1];
      expect(sentContent).toContain('预订已确认');
      expect(sentContent).toContain('Wei');
    });

    it('sends Malay template when guest preference is ms', async () => {
      mockGetLang.mockResolvedValue('ms');
      const row = makePendingRow({ variables: JSON.stringify({
        guestName: 'Ahmad',
        arrivalDate: '2026-04-01',
        checkInTime: '14:00',
        roomType: 'Capsule',
        confirmationNumber: 'BK-MS-001',
      }) });
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await _processScheduledMessages();

      const sentContent = mockSendWA.mock.calls[0][1];
      expect(sentContent).toContain('Tempahan Disahkan');
      expect(sentContent).toContain('Ahmad');
    });

    it('sends English template when guest preference is en', async () => {
      mockGetLang.mockResolvedValue('en');
      const row = makePendingRow();
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await _processScheduledMessages();

      const sentContent = mockSendWA.mock.calls[0][1];
      expect(sentContent).toContain('Booking Confirmed');
    });
  });

  // ─── AC2: Templates available in 3 language variants ────────────

  describe('AC2: Pre-arrival templates in en, ms, zh', () => {
    const templateKeys = ['booking_confirmation', 'booking_directions', 'booking_ready'];
    const langs = ['en', 'ms', 'zh'];

    for (const key of templateKeys) {
      for (const lang of langs) {
        it(`${key} has ${lang} variant`, () => {
          expect(_TEMPLATES[key]).toHaveProperty(lang);
          expect(_TEMPLATES[key][lang].length).toBeGreaterThan(50);
        });
      }
    }

    it('booking_confirmation zh contains Chinese characters', () => {
      const content = _getTemplateContent('booking_confirmation', { guestName: 'Test' }, 'zh');
      expect(content).toContain('预订已确认');
    });

    it('booking_directions ms contains Malay text', () => {
      const content = _getTemplateContent('booking_directions', { guestName: 'Test', checkInTime: '14:00' }, 'ms');
      expect(content).toContain('Tiba Esok');
    });

    it('booking_ready zh contains Chinese ready message', () => {
      const content = _getTemplateContent('booking_ready', { guestName: 'Test', checkInTime: '14:00' }, 'zh');
      expect(content).toContain('我们已准备好迎接您');
    });
  });

  // ─── AC3: Default to English when no preference stored ──────────

  describe('AC3: Default to English when no language preference', () => {
    it('uses English when getPreferredLanguage returns null', async () => {
      mockGetLang.mockResolvedValue(null);
      const row = makePendingRow();
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await _processScheduledMessages();

      const sentContent = mockSendWA.mock.calls[0][1];
      expect(sentContent).toContain('Booking Confirmed');
      expect(sentContent).not.toContain('预订已确认');
      expect(sentContent).not.toContain('Tempahan Disahkan');
    });

    it('getTemplateContent falls back to English for unsupported language', () => {
      const content = _getTemplateContent('booking_confirmation', { guestName: 'Test' }, 'ja');
      expect(content).toContain('Booking Confirmed');
    });
  });

  // ─── AC4: Admin can override language (via existing PATCH endpoint) ─

  describe('AC4: Admin language override', () => {
    it('languageLocked guest keeps override even if detection differs', async () => {
      // Simulate: admin set language to 'ms' and locked it
      // The language-preference module returns 'ms' regardless of detection
      mockGetLang.mockResolvedValue('ms');
      const row = makePendingRow();
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await _processScheduledMessages();

      const sentContent = mockSendWA.mock.calls[0][1];
      expect(sentContent).toContain('Tempahan Disahkan');
    });
  });

  // ─── AC5: Vitest test: zh guest gets zh template ────────────────

  describe('AC5: Guest with detectedLanguage=zh receives zh template variant', () => {
    it('pre-arrival confirmation in Chinese for zh guest', async () => {
      mockGetLang.mockResolvedValue('zh');
      const row = makePendingRow({
        template_key: 'booking_confirmation',
        sequence_step: 'confirmation',
      });
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await _processScheduledMessages();

      expect(mockSendWA).toHaveBeenCalledTimes(1);
      const sentContent = mockSendWA.mock.calls[0][1];
      // Chinese template markers
      expect(sentContent).toContain('预订已确认');
      expect(sentContent).toContain('入住日期');
      expect(sentContent).toContain('房型');
      expect(sentContent).toContain('确认号');
    });

    it('pre-arrival directions in Chinese for zh guest', async () => {
      mockGetLang.mockResolvedValue('zh');
      const row = makePendingRow({
        template_key: 'booking_directions',
        sequence_step: 'directions',
      });
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await _processScheduledMessages();

      const sentContent = mockSendWA.mock.calls[0][1];
      expect(sentContent).toContain('明天到达');
      expect(sentContent).toContain('门密码');
    });

    it('pre-arrival ready message in Chinese for zh guest', async () => {
      mockGetLang.mockResolvedValue('zh');
      const row = makePendingRow({
        template_key: 'booking_ready',
        sequence_step: 'ready',
      });
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await _processScheduledMessages();

      const sentContent = mockSendWA.mock.calls[0][1];
      expect(sentContent).toContain('我们已准备好迎接您');
    });
  });
});
