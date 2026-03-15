/**
 * cart-recovery.test.ts — Tests for US-882 abandoned cart recovery
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock session-window before imports
vi.mock('../../lib/session-window.js', () => ({
  sessionWindowActive: vi.fn().mockResolvedValue(true),
  logSessionExpired: vi.fn(),
}));

// Mock config-store before imports
const mockGetSettings = vi.fn().mockReturnValue({
  cart_recovery: { enabled: true, idle_minutes: 30 },
});
vi.mock('../config-store.js', () => ({
  configStore: {
    getSettings: () => mockGetSettings(),
  },
}));

// Mock order-stage-store
vi.mock('../order-stage-store.js', () => ({
  clearOrderStage: vi.fn(),
}));

import {
  initCartRecovery,
  destroyCartRecovery,
  parseCartRecoveryReply,
  handleCartRecoveryReply,
  resetCartRecovery,
  hasRecoveryPending,
  clearCartRecovery,
} from '../cart-recovery.js';
import { cartAddItem, cartGetItems, cartClear } from '../cart-store.js';
import { sessionWindowActive } from '../../lib/session-window.js';

// Helper: init recovery, advance exactly one scan interval, await microtasks
async function advanceOneScan(): Promise<void> {
  // Advance 5 min (one CHECK_INTERVAL_MS) and flush microtasks
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
}

describe('US-882: Abandoned cart recovery', () => {
  const mockSend = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    destroyCartRecovery();
    mockSend.mockClear();
    vi.mocked(sessionWindowActive).mockResolvedValue(true);
    mockGetSettings.mockReturnValue({
      cart_recovery: { enabled: true, idle_minutes: 30 },
    });
  });

  afterEach(() => {
    destroyCartRecovery();
    vi.useRealTimers();
  });

  // ─── parseCartRecoveryReply (pure function, no timers needed) ─────

  describe('parseCartRecoveryReply', () => {
    it('parses "Resume order" correctly', () => {
      expect(parseCartRecoveryReply('Resume order')).toBe('resume');
      expect(parseCartRecoveryReply('  resume order  ')).toBe('resume');
      expect(parseCartRecoveryReply('RESUME ORDER')).toBe('resume');
    });

    it('parses "Clear cart" correctly', () => {
      expect(parseCartRecoveryReply('Clear cart')).toBe('clear');
      expect(parseCartRecoveryReply('  clear cart  ')).toBe('clear');
      expect(parseCartRecoveryReply('CLEAR CART')).toBe('clear');
    });

    it('returns null for unrecognized text', () => {
      expect(parseCartRecoveryReply('hello')).toBeNull();
      expect(parseCartRecoveryReply('yes')).toBeNull();
      expect(parseCartRecoveryReply('')).toBeNull();
    });
  });

  // ─── handleCartRecoveryReply ──────────────────────────────────────

  describe('handleCartRecoveryReply', () => {
    it('returns false when no recovery was sent', async () => {
      const handled = await handleCartRecoveryReply('60999888777', 'resume', mockSend);
      expect(handled).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('resume action keeps cart items and sends welcome back', async () => {
      const phone = '60444555666';
      cartAddItem(phone, { name: 'Laksa', qty: 1, price: 12.0 });

      initCartRecovery(mockSend);

      // Advance 7 scans (35 min) to trigger recovery at 30-min mark
      for (let i = 0; i < 7; i++) await advanceOneScan();
      expect(mockSend).toHaveBeenCalled();
      mockSend.mockClear();

      // Simulate "Resume order" reply
      const handled = await handleCartRecoveryReply(phone, 'resume', mockSend);
      expect(handled).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const msg = mockSend.mock.calls[0][1] as string;
      expect(msg).toContain('Welcome back');
      expect(msg).toContain('Laksa');

      // Cart should still have items
      const items = cartGetItems(phone);
      expect(items).toHaveLength(1);

      cartClear(phone);
    });

    it('clear action removes all items', async () => {
      const phone = '60777888999';
      cartAddItem(phone, { name: 'Char Kuey Teow', qty: 1, price: 10.0 });

      initCartRecovery(mockSend);

      // Trigger recovery
      for (let i = 0; i < 7; i++) await advanceOneScan();
      expect(mockSend).toHaveBeenCalled();
      mockSend.mockClear();

      // Simulate "Clear cart" reply
      const handled = await handleCartRecoveryReply(phone, 'clear', mockSend);
      expect(handled).toBe(true);

      // Cart should be empty
      const items = cartGetItems(phone);
      expect(items).toHaveLength(0);
    });
  });

  // ─── Scanner behavior (timer-dependent) ───────────────────────────

  describe('idle cart scanner', () => {
    it('AC1: sends recovery message when WhatsApp cart idle for configured period', async () => {
      const phone = '60123456789';
      cartAddItem(phone, { name: 'Nasi Lemak', qty: 1, price: 8.5 });

      initCartRecovery(mockSend);

      // Advance 6 scans (30 min) — at this point idle == threshold
      for (let i = 0; i < 6; i++) await advanceOneScan();

      // Recovery should have been sent (idle >= 30 min at the 30-min scan)
      expect(mockSend).toHaveBeenCalled();
      const msg = mockSend.mock.calls[0][1] as string;
      expect(msg).toContain('Nasi Lemak');
      expect(msg).toContain('Resume order');
      expect(msg).toContain('Clear cart');

      cartClear(phone);
    });

    it('AC2: recovery message includes cart summary with items and total', async () => {
      const phone = '60198765432';
      cartAddItem(phone, { name: 'Roti Canai', qty: 2, price: 3.0 });
      cartAddItem(phone, { name: 'Teh Tarik', qty: 1, price: 2.5 });

      initCartRecovery(mockSend);

      for (let i = 0; i < 7; i++) await advanceOneScan();

      expect(mockSend).toHaveBeenCalled();
      const msg = mockSend.mock.calls[0][1] as string;
      expect(msg).toContain('Roti Canai');
      expect(msg).toContain('Teh Tarik');
      expect(msg).toContain('2x');
      expect(msg).toContain('RM');

      cartClear(phone);
    });

    it('AC3: only one recovery message per cart session (no spam)', async () => {
      const phone = '60111222333';
      cartAddItem(phone, { name: 'Milo', qty: 1, price: 4.0 });

      initCartRecovery(mockSend);

      // Advance many scan cycles
      for (let i = 0; i < 12; i++) await advanceOneScan();

      // Should have sent exactly 1 recovery message
      const recoveryCalls = mockSend.mock.calls.filter((c: any) =>
        (c[1] as string).includes('Resume order')
      );
      expect(recoveryCalls).toHaveLength(1);

      cartClear(phone);
    });

    it('AC5: cart auto-clears 24h after recovery message if ignored', async () => {
      const phone = '60333444555';
      cartAddItem(phone, { name: 'Hokkien Mee', qty: 1, price: 9.0 });

      initCartRecovery(mockSend);

      // Trigger recovery (advance 35 min)
      for (let i = 0; i < 7; i++) await advanceOneScan();
      expect(hasRecoveryPending(phone)).toBe(true);

      // Advance 24+ hours (288 x 5-min scans = 1440 min = 24h)
      for (let i = 0; i < 290; i++) await advanceOneScan();

      // Cart should be auto-cleared
      const items = cartGetItems(phone);
      expect(items).toHaveLength(0);
      expect(hasRecoveryPending(phone)).toBe(false);
    });

    it('AC6: uses configurable idle_minutes from settings', () => {
      const settings = mockGetSettings();
      expect(settings.cart_recovery.idle_minutes).toBe(30);
      expect(settings.cart_recovery.enabled).toBe(true);
    });

    it('does not send recovery for webchat sessions', async () => {
      const sessionId = 'webchat-test-123';
      cartAddItem(sessionId, { name: 'Nasi Goreng', qty: 1, price: 7.0 });

      initCartRecovery(mockSend);

      for (let i = 0; i < 7; i++) await advanceOneScan();

      expect(mockSend).not.toHaveBeenCalled();

      cartClear(sessionId);
    });

    it('does not send when 24h session window expired', async () => {
      const phone = '60555666777';
      cartAddItem(phone, { name: 'Satay', qty: 1, price: 8.0 });
      vi.mocked(sessionWindowActive).mockResolvedValue(false);

      initCartRecovery(mockSend);

      for (let i = 0; i < 7; i++) await advanceOneScan();

      expect(mockSend).not.toHaveBeenCalled();

      cartClear(phone);
    });
  });

  // ─── resetCartRecovery ────────────────────────────────────────────

  describe('resetCartRecovery', () => {
    it('clears pending recovery state', async () => {
      const phone = '60666777888';
      cartAddItem(phone, { name: 'Rendang', qty: 1, price: 15.0 });

      initCartRecovery(mockSend);

      // Trigger recovery
      for (let i = 0; i < 7; i++) await advanceOneScan();
      expect(hasRecoveryPending(phone)).toBe(true);

      // User sends any message — resets recovery
      resetCartRecovery(phone);
      expect(hasRecoveryPending(phone)).toBe(false);

      cartClear(phone);
    });
  });
});
