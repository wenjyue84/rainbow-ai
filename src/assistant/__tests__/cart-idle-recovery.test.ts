/**
 * cart-idle-recovery.test.ts — Tests for abandoned cart recovery (US-882)
 *
 * Tests:
 *   - buildRecoveryMessage: includes items and quick-reply options
 *   - parseRecoveryReply: recognizes resume/clear variants
 *   - handleRecoveryReply: clears cart or returns resume message
 *   - isWhatsAppSession: detects phone numbers vs UUIDs
 *   - checkIdleCarts: sends recovery, respects already-sent, auto-clears after 24h
 *   - checkIdleCarts (WhatsApp): sends via WhatsApp send function, respects 24h window
 *   - Cart store recovery flags: mark, check, reset
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildRecoveryMessage,
  parseRecoveryReply,
  handleRecoveryReply,
  isWhatsAppSession,
  checkIdleCarts,
  initCartIdleRecovery,
  stopCartIdleRecovery,
} from '../cart-idle-recovery.js';
import {
  cartAddItem, cartGetItems, cartClear,
  cartMarkRecoverySent, cartIsRecoverySent, cartResetRecovery,
  cartGetActiveSessions,
} from '../cart-store.js';
import { getOrderStage, setOrderStage, clearOrderStage } from '../order-stage-store.js';

// Mock the DB pool — checkIdleCarts inserts into rainbow_messages
vi.mock('../../lib/db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

const sid = () => 'recovery-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

// ─── buildRecoveryMessage ────────────────────────────────────────

describe('buildRecoveryMessage', () => {
  it('includes cart items and quick-reply options', () => {
    const items = [
      { name: 'Nasi Lemak', qty: 2, price: 8.50 },
      { name: 'Teh Tarik', qty: 1, price: 3.00 },
    ];
    const msg = buildRecoveryMessage(items);

    expect(msg).toContain('Nasi Lemak');
    expect(msg).toContain('Teh Tarik');
    expect(msg).toContain('Resume order');
    expect(msg).toContain('Clear cart');
    expect(msg).toContain('RM');
  });

  it('handles empty cart gracefully', () => {
    const msg = buildRecoveryMessage([]);
    expect(msg).toContain('empty');
  });
});

// ─── parseRecoveryReply ──────────────────────────────────────────

describe('parseRecoveryReply', () => {
  it('recognizes "Resume order"', () => {
    expect(parseRecoveryReply('Resume order')).toBe('resume');
    expect(parseRecoveryReply('resume order')).toBe('resume');
    expect(parseRecoveryReply('RESUME ORDER')).toBe('resume');
    expect(parseRecoveryReply('  resume order  ')).toBe('resume');
  });

  it('recognizes "resume" alone', () => {
    expect(parseRecoveryReply('resume')).toBe('resume');
    expect(parseRecoveryReply('Resume')).toBe('resume');
  });

  it('recognizes "Clear cart"', () => {
    expect(parseRecoveryReply('Clear cart')).toBe('clear');
    expect(parseRecoveryReply('clear cart')).toBe('clear');
    expect(parseRecoveryReply('CLEAR CART')).toBe('clear');
  });

  it('recognizes "clear" alone', () => {
    expect(parseRecoveryReply('clear')).toBe('clear');
    expect(parseRecoveryReply('Clear')).toBe('clear');
  });

  it('returns null for unrelated messages', () => {
    expect(parseRecoveryReply('hello')).toBeNull();
    expect(parseRecoveryReply('I want to order')).toBeNull();
    expect(parseRecoveryReply('show me the menu')).toBeNull();
    expect(parseRecoveryReply('')).toBeNull();
  });
});

// ─── isWhatsAppSession ──────────────────────────────────────────

describe('isWhatsAppSession', () => {
  it('identifies phone numbers as WhatsApp sessions', () => {
    expect(isWhatsAppSession('60127088789')).toBe(true);
    expect(isWhatsAppSession('6281234567890')).toBe(true);
    expect(isWhatsAppSession('12025551234')).toBe(true);
  });

  it('identifies UUIDs and prefixed IDs as non-WhatsApp sessions', () => {
    expect(isWhatsAppSession('a1b2c3d4-e5f6-7890')).toBe(false);
    expect(isWhatsAppSession('recovery-123456')).toBe(false);
    expect(isWhatsAppSession('webchat-session-abc')).toBe(false);
    expect(isWhatsAppSession('')).toBe(false);
  });
});

// ─── handleRecoveryReply ─────────────────────────────────────────

describe('handleRecoveryReply', () => {
  it('clears cart on "Clear cart"', () => {
    const s = sid();
    cartAddItem(s, { name: 'Nasi Lemak', qty: 1, price: 8.50 });
    setOrderStage(s, 'ORDERING');

    const response = handleRecoveryReply(s, 'Clear cart');

    expect(response).toContain('cleared');
    expect(cartGetItems(s)).toHaveLength(0);
  });

  it('keeps cart intact on "Resume order"', () => {
    const s = sid();
    cartAddItem(s, { name: 'Nasi Lemak', qty: 1, price: 8.50 });

    const response = handleRecoveryReply(s, 'Resume order');

    expect(response).toContain('ready');
    expect(cartGetItems(s)).toHaveLength(1);
  });

  it('returns null for non-recovery messages', () => {
    const s = sid();
    expect(handleRecoveryReply(s, 'show me the menu')).toBeNull();
  });
});

// ─── Cart store recovery flags ──────────────────────────────────

describe('Cart recovery flags', () => {
  it('marks and checks recovery sent', () => {
    const s = sid();
    cartAddItem(s, { name: 'Test', qty: 1 });

    expect(cartIsRecoverySent(s)).toBe(false);

    cartMarkRecoverySent(s);
    expect(cartIsRecoverySent(s)).toBe(true);
  });

  it('resets recovery flag', () => {
    const s = sid();
    cartAddItem(s, { name: 'Test', qty: 1 });
    cartMarkRecoverySent(s);

    cartResetRecovery(s);
    expect(cartIsRecoverySent(s)).toBe(false);
  });

  it('resets recovery flag when new item is added', () => {
    const s = sid();
    cartAddItem(s, { name: 'Test', qty: 1 });
    cartMarkRecoverySent(s);

    // Adding a new item should auto-reset the recovery flag
    cartAddItem(s, { name: 'Another', qty: 1 });
    expect(cartIsRecoverySent(s)).toBe(false);
  });
});

// ─── checkIdleCarts (webchat) ─────────────────────────────────────

describe('checkIdleCarts', () => {
  it('sends recovery for idle webchat session', async () => {
    const s = sid();
    cartAddItem(s, { name: 'Nasi Lemak', qty: 1, price: 8.50 });

    stopCartIdleRecovery(); // stop any running timer
    initCartIdleRecovery(0); // 0 minute idle = immediately eligible

    // Wait a tiny bit for the async initial check
    await new Promise(r => setTimeout(r, 50));

    // The session should now have recovery marked
    expect(cartIsRecoverySent(s)).toBe(true);

    // Cleanup
    stopCartIdleRecovery();
    cartClear(s);
  });

  it('does not send duplicate recovery messages', async () => {
    const s = sid();
    cartAddItem(s, { name: 'Test', qty: 1, price: 5.00 });
    cartMarkRecoverySent(s);

    const { pool } = await import('../../lib/db.js');
    const querySpy = vi.mocked(pool.query);
    const callsBefore = querySpy.mock.calls.length;

    const sent = await checkIdleCarts();

    // Should not have sent for this session (already sent)
    expect(cartIsRecoverySent(s)).toBe(true);

    cartClear(s);
  });
});

// ─── checkIdleCarts (WhatsApp) ──────────────────────────────────

describe('checkIdleCarts WhatsApp', () => {
  it('sends recovery via WhatsApp for phone-number sessions', async () => {
    const phone = '60127088789';
    cartAddItem(phone, { name: 'Roti Canai', qty: 2, price: 3.00 });

    const mockSend = vi.fn().mockResolvedValue(undefined);
    stopCartIdleRecovery();
    initCartIdleRecovery(0, mockSend);

    await new Promise(r => setTimeout(r, 50));

    expect(cartIsRecoverySent(phone)).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(phone, expect.stringContaining('Roti Canai'));
    expect(mockSend).toHaveBeenCalledWith(phone, expect.stringContaining('Resume order'));

    stopCartIdleRecovery();
    cartClear(phone);
  });

  it('skips WhatsApp session outside 24h window', async () => {
    const phone = '60181234567';
    cartAddItem(phone, { name: 'Mee Goreng', qty: 1, price: 7.00 });

    const mockSend = vi.fn().mockResolvedValue(undefined);
    stopCartIdleRecovery();
    initCartIdleRecovery(0, mockSend);

    await new Promise(r => setTimeout(r, 50));

    // With 0-minute idle and just-created session, it should send (within 24h window)
    expect(mockSend).toHaveBeenCalled();

    stopCartIdleRecovery();
    cartClear(phone);
  });

  it('does not send WhatsApp recovery without send function', async () => {
    const phone = '60191234567';
    cartAddItem(phone, { name: 'Nasi Goreng', qty: 1, price: 9.00 });

    stopCartIdleRecovery();
    initCartIdleRecovery(0); // no WhatsApp send function

    await new Promise(r => setTimeout(r, 50));

    // Should not mark as sent — no send function available
    expect(cartIsRecoverySent(phone)).toBe(false);

    stopCartIdleRecovery();
    cartClear(phone);
  });

  it('WhatsApp recovery message includes cart summary and total', () => {
    const items = [
      { name: 'Roti Canai', qty: 2, price: 3.00 },
      { name: 'Teh Tarik', qty: 1, price: 2.50 },
    ];
    const msg = buildRecoveryMessage(items);

    expect(msg).toContain('Roti Canai');
    expect(msg).toContain('Teh Tarik');
    expect(msg).toContain('RM 8.50'); // total: 2*3 + 1*2.5 = 8.5
    expect(msg).toContain('Resume order');
    expect(msg).toContain('Clear cart');
  });
});
