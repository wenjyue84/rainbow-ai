/**
 * order-modification.test.ts — Tests for order modification window (US-881)
 *
 * Tests:
 *   - Modification store: save, check, expire, kitchen acceptance
 *   - order_modify_request tool handler: within window, expired, kitchen accepted
 *   - Full flow: place order → modify → resubmit
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  saveModificationSnapshot,
  isModificationAllowed,
  getModificationSnapshot,
  markKitchenAccepted,
  clearModificationWindow,
  getModificationRemainingSeconds,
} from '../order-modification-store.js';
import {
  cartAddItem, cartGetItems, cartClear, cartFormatSummary,
} from '../cart-store.js';
import {
  getOrderStage, setOrderStage, clearOrderStage,
} from '../order-stage-store.js';
import { createCartHandlers } from '../../tools/cart.js';

// ─── Modification Store Unit Tests ─────────────────────────────────

describe('Order Modification Store', () => {
  const sid = () => 'mod-' + Date.now() + '-' + Math.random();

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves and retrieves a modification snapshot', () => {
    const s = sid();
    const items = [{ name: 'Nasi Lemak', qty: 1, price: 8.50 }];
    saveModificationSnapshot(s, items, 120_000, {
      tableInfo: { tableNumber: '5', orderType: 'dine-in' },
      orderId: 'MM-TEST1',
    });

    const snapshot = getModificationSnapshot(s);
    expect(snapshot).toBeDefined();
    expect(snapshot!.items).toHaveLength(1);
    expect(snapshot!.items[0].name).toBe('Nasi Lemak');
    expect(snapshot!.tableInfo?.tableNumber).toBe('5');
    expect(snapshot!.orderId).toBe('MM-TEST1');
    expect(snapshot!.kitchenAccepted).toBe(false);

    clearModificationWindow(s);
  });

  it('returns undefined for non-existent session', () => {
    expect(getModificationSnapshot('no-such-session')).toBeUndefined();
  });

  it('isModificationAllowed returns true within window', () => {
    const s = sid();
    saveModificationSnapshot(s, [{ name: 'Test', qty: 1 }], 120_000);
    expect(isModificationAllowed(s)).toBe(true);
    clearModificationWindow(s);
  });

  it('isModificationAllowed returns false after window expires', () => {
    vi.useFakeTimers();
    const s = sid();
    saveModificationSnapshot(s, [{ name: 'Test', qty: 1 }], 120_000); // 2 min window

    // Advance past the window
    vi.advanceTimersByTime(121_000);
    expect(isModificationAllowed(s)).toBe(false);

    clearModificationWindow(s);
  });

  it('isModificationAllowed returns false after kitchen accepts', () => {
    const s = sid();
    saveModificationSnapshot(s, [{ name: 'Test', qty: 1 }], 120_000);
    markKitchenAccepted(s);
    expect(isModificationAllowed(s)).toBe(false);
    clearModificationWindow(s);
  });

  it('markKitchenAccepted returns false for non-existent session', () => {
    expect(markKitchenAccepted('no-session')).toBe(false);
  });

  it('getModificationRemainingSeconds returns positive within window', () => {
    const s = sid();
    saveModificationSnapshot(s, [{ name: 'Test', qty: 1 }], 120_000);
    const remaining = getModificationRemainingSeconds(s);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(120);
    clearModificationWindow(s);
  });

  it('getModificationRemainingSeconds returns 0 after expiry', () => {
    vi.useFakeTimers();
    const s = sid();
    saveModificationSnapshot(s, [{ name: 'Test', qty: 1 }], 120_000);
    vi.advanceTimersByTime(121_000);
    expect(getModificationRemainingSeconds(s)).toBe(0);
    clearModificationWindow(s);
  });

  it('getModificationRemainingSeconds returns 0 after kitchen accepts', () => {
    const s = sid();
    saveModificationSnapshot(s, [{ name: 'Test', qty: 1 }], 120_000);
    markKitchenAccepted(s);
    expect(getModificationRemainingSeconds(s)).toBe(0);
    clearModificationWindow(s);
  });

  it('clearModificationWindow removes snapshot', () => {
    const s = sid();
    saveModificationSnapshot(s, [{ name: 'Test', qty: 1 }], 120_000);
    clearModificationWindow(s);
    expect(getModificationSnapshot(s)).toBeUndefined();
    expect(isModificationAllowed(s)).toBe(false);
  });

  it('snapshot items are deep copied (mutation-safe)', () => {
    const s = sid();
    const original = [{ name: 'Nasi', qty: 1, price: 8.50 }];
    saveModificationSnapshot(s, original, 120_000);

    // Mutate original
    original[0].qty = 99;

    const snapshot = getModificationSnapshot(s);
    expect(snapshot!.items[0].qty).toBe(1); // unaffected
    clearModificationWindow(s);
  });
});

// ─── order_modify_request Handler Tests ────────────────────────────

describe('order_modify_request handler (US-881)', () => {
  const newSid = () => 'modify-handler-' + Date.now() + '-' + Math.random();

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns no-recent-order when no snapshot exists', async () => {
    const s = newSid();
    const handlers = createCartHandlers(s);
    const result = await handlers.get('order_modify_request')!({});
    expect(result.content[0].text).toContain('no recent order');
    clearOrderStage(s);
  });

  it('restores items to cart when within modification window', async () => {
    const s = newSid();
    // Simulate a placed order: save snapshot manually
    saveModificationSnapshot(s, [
      { name: 'Nasi Lemak', qty: 1, price: 8.50 },
      { name: 'Teh Tarik', qty: 2, price: 2.50 },
    ], 120_000, { tableInfo: { tableNumber: '5', orderType: 'dine-in' } });

    const handlers = createCartHandlers(s);
    const result = await handlers.get('order_modify_request')!({});

    expect(result.content[0].text).toContain('reopened');
    expect(result.content[0].text).toContain('Nasi Lemak');
    expect(result.content[0].text).toContain('Teh Tarik');

    // Cart should have items restored
    const items = cartGetItems(s);
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe('Nasi Lemak');
    expect(items[1].name).toBe('Teh Tarik');

    // Stage should be ORDERING
    expect(getOrderStage(s)).toBe('ORDERING');

    cartClear(s);
    clearOrderStage(s);
    clearModificationWindow(s);
  });

  it('rejects modification after window expires', async () => {
    vi.useFakeTimers();
    const s = newSid();
    saveModificationSnapshot(s, [{ name: 'Test', qty: 1 }], 120_000);

    vi.advanceTimersByTime(121_000);

    const handlers = createCartHandlers(s);
    const result = await handlers.get('order_modify_request')!({});
    expect(result.content[0].text).toContain('expired');
    expect(result.content[0].text).toContain('staff');

    clearModificationWindow(s);
  });

  it('rejects modification after kitchen accepts', async () => {
    const s = newSid();
    saveModificationSnapshot(s, [{ name: 'Test', qty: 1 }], 120_000);
    markKitchenAccepted(s);

    const handlers = createCartHandlers(s);
    const result = await handlers.get('order_modify_request')!({});
    expect(result.content[0].text).toContain('kitchen has already accepted');
    expect(result.content[0].text).toContain('staff');

    clearModificationWindow(s);
  });
});

// ─── Full Modification Flow Integration ────────────────────────────

describe('Full order modification flow (US-881)', () => {
  const newSid = () => 'mod-flow-' + Date.now() + '-' + Math.random();

  it('order_confirm_submit informs about modification window', async () => {
    const s = newSid();
    const handlers = createCartHandlers(s, { orderModificationWindowMinutes: 2 });
    await handlers.get('cart_add_item')!({ name: 'Nasi Goreng', qty: 1, price: 7.50 });
    setOrderStage(s, 'CONFIRMING');

    const result = await handlers.get('order_confirm_submit')!({});
    expect(result.content[0].text).toContain('2 minutes');
    expect(result.content[0].text).toContain('change my order');

    // Snapshot should be saved
    const snapshot = getModificationSnapshot(s);
    expect(snapshot).toBeDefined();
    expect(snapshot!.items[0].name).toBe('Nasi Goreng');

    clearModificationWindow(s);
  });

  it('place → modify → resubmit full cycle', async () => {
    const s = newSid();
    const handlers = createCartHandlers(s, { orderModificationWindowMinutes: 2 });

    // 1. Place order
    await handlers.get('cart_add_item')!({ name: 'Nasi Lemak', qty: 1, price: 8.50 });
    await handlers.get('cart_add_item')!({ name: 'Teh Tarik', qty: 1, price: 2.50 });
    setOrderStage(s, 'CONFIRMING');
    const placeResult = await handlers.get('order_confirm_submit')!({});
    expect(placeResult.content[0].text).toContain('kitchen');
    expect(cartGetItems(s)).toHaveLength(0); // cart cleared

    // 2. Modify within window
    const modResult = await handlers.get('order_modify_request')!({});
    expect(modResult.content[0].text).toContain('reopened');
    expect(cartGetItems(s)).toHaveLength(2); // items restored
    expect(getOrderStage(s)).toBe('ORDERING');

    // 3. Make changes — remove Teh Tarik, add Kopi O
    await handlers.get('cart_remove_item')!({ name: 'Teh Tarik' });
    await handlers.get('cart_add_item')!({ name: 'Kopi O', qty: 1, price: 2.00 });

    const updatedItems = cartGetItems(s);
    expect(updatedItems).toHaveLength(2);
    expect(updatedItems.map(i => i.name)).toContain('Nasi Lemak');
    expect(updatedItems.map(i => i.name)).toContain('Kopi O');

    // 4. Resubmit
    setOrderStage(s, 'CONFIRMING');
    const resubmitResult = await handlers.get('order_confirm_submit')!({});
    expect(resubmitResult.content[0].text).toContain('updated order');
    expect(resubmitResult.content[0].text).toContain('kitchen');
    expect(cartGetItems(s)).toHaveLength(0); // cleared again

    clearModificationWindow(s);
  });

  it('resubmission does not show modification window message', async () => {
    const s = newSid();
    const handlers = createCartHandlers(s, { orderModificationWindowMinutes: 2 });

    // Place order
    await handlers.get('cart_add_item')!({ name: 'Laksa', qty: 1, price: 10.00 });
    setOrderStage(s, 'CONFIRMING');
    await handlers.get('order_confirm_submit')!({});

    // Modify and resubmit
    await handlers.get('order_modify_request')!({});
    setOrderStage(s, 'CONFIRMING');
    const resubmitResult = await handlers.get('order_confirm_submit')!({});

    // Should NOT show "You have X minutes to make changes" on resubmission
    expect(resubmitResult.content[0].text).not.toContain('minutes to make changes');

    clearModificationWindow(s);
  });

  it('configurable window duration (5 minutes)', async () => {
    const s = newSid();
    const handlers = createCartHandlers(s, { orderModificationWindowMinutes: 5 });

    await handlers.get('cart_add_item')!({ name: 'Roti Canai', qty: 1, price: 3.50 });
    setOrderStage(s, 'CONFIRMING');
    const result = await handlers.get('order_confirm_submit')!({});

    expect(result.content[0].text).toContain('5 minutes');

    // Snapshot window should be 5 minutes
    const snapshot = getModificationSnapshot(s);
    expect(snapshot!.windowMs).toBe(300_000);

    clearModificationWindow(s);
  });
});
