/**
 * order-stage.test.ts — Unit tests for order stage state machine (US-849)
 *
 * Tests each intent transition:
 *   BROWSING   → ORDERING    (guest adds first item)
 *   ORDERING   → CONFIRMING  (AI requests confirmation)
 *   CONFIRMING → PLACED      (guest confirms)
 *   CONFIRMING → ORDERING    (guest declines)
 *   PLACED     → BROWSING    (reset after order)
 *   cart empty → BROWSING    (removing last item resets stage)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOrderStage,
  setOrderStage,
  clearOrderStage,
  transitionOrderStage,
  ORDER_STAGE_DESCRIPTIONS,
  type OrderStage,
} from '../order-stage-store.js';
import {
  cartAddItem,
  cartRemoveItem,
  cartClear,
  cartGetItems,
  cartUpdateItemQty,
  cartSetItemNotes,
  cartFormatSummary,
  cartSetTableInfo,
  cartGetTableInfo,
} from '../cart-store.js';
import { createCartHandlers } from '../../tools/cart.js';
import {
  startModificationWindow,
  isModificationAllowed,
  markKitchenAccepted,
  closeModificationWindow,
  getModificationTimeRemaining,
} from '../order-modification-store.js';

// ─── State Machine Unit Tests ───────────────────────────────────────

describe('Order Stage Store — getOrderStage', () => {
  it('returns BROWSING for a new/unknown session', () => {
    expect(getOrderStage('new-session-xyz')).toBe('BROWSING');
  });

  it('returns the stage that was set', () => {
    const sid = 'test-set-' + Date.now();
    setOrderStage(sid, 'ORDERING');
    expect(getOrderStage(sid)).toBe('ORDERING');
    clearOrderStage(sid);
  });

  it('clearOrderStage resets to BROWSING (undefined)', () => {
    const sid = 'test-clear-' + Date.now();
    setOrderStage(sid, 'CONFIRMING');
    clearOrderStage(sid);
    expect(getOrderStage(sid)).toBe('BROWSING');
  });
});

describe('Order Stage Store — transitionOrderStage', () => {
  const sid = () => 'trans-' + Date.now() + '-' + Math.random();

  it('BROWSING → ORDERING is valid', () => {
    const s = sid();
    const result = transitionOrderStage(s, 'ORDERING');
    expect(result).toBe('ORDERING');
    expect(getOrderStage(s)).toBe('ORDERING');
    clearOrderStage(s);
  });

  it('ORDERING → CONFIRMING is valid', () => {
    const s = sid();
    setOrderStage(s, 'ORDERING');
    const result = transitionOrderStage(s, 'CONFIRMING');
    expect(result).toBe('CONFIRMING');
    expect(getOrderStage(s)).toBe('CONFIRMING');
    clearOrderStage(s);
  });

  it('CONFIRMING → PLACED is valid (guest confirms)', () => {
    const s = sid();
    setOrderStage(s, 'CONFIRMING');
    const result = transitionOrderStage(s, 'PLACED');
    expect(result).toBe('PLACED');
    expect(getOrderStage(s)).toBe('PLACED');
    clearOrderStage(s);
  });

  it('CONFIRMING → ORDERING is valid (guest declines)', () => {
    const s = sid();
    setOrderStage(s, 'CONFIRMING');
    const result = transitionOrderStage(s, 'ORDERING');
    expect(result).toBe('ORDERING');
    expect(getOrderStage(s)).toBe('ORDERING');
    clearOrderStage(s);
  });

  it('PLACED → BROWSING is valid (fresh start)', () => {
    const s = sid();
    setOrderStage(s, 'PLACED');
    const result = transitionOrderStage(s, 'BROWSING');
    expect(result).toBe('BROWSING');
    expect(getOrderStage(s)).toBe('BROWSING');
    clearOrderStage(s);
  });

  it('Any → BROWSING is valid (reset)', () => {
    const stages: OrderStage[] = ['BROWSING', 'ORDERING', 'CONFIRMING', 'PLACED'];
    for (const stage of stages) {
      const s = sid();
      setOrderStage(s, stage);
      const result = transitionOrderStage(s, 'BROWSING');
      expect(result).toBe('BROWSING');
      clearOrderStage(s);
    }
  });

  it('BROWSING → CONFIRMING is invalid (skipping ORDERING)', () => {
    const s = sid();
    // Default is BROWSING
    const result = transitionOrderStage(s, 'CONFIRMING');
    expect(result).toBe('BROWSING'); // stays put
    expect(getOrderStage(s)).toBe('BROWSING');
    clearOrderStage(s);
  });

  it('BROWSING → PLACED is invalid', () => {
    const s = sid();
    const result = transitionOrderStage(s, 'PLACED');
    expect(result).toBe('BROWSING'); // stays put
    clearOrderStage(s);
  });

  it('PLACED → ORDERING is invalid', () => {
    const s = sid();
    setOrderStage(s, 'PLACED');
    const result = transitionOrderStage(s, 'ORDERING');
    expect(result).toBe('PLACED'); // stays put
    clearOrderStage(s);
  });
});

describe('Order Stage Store — descriptions', () => {
  it('has descriptions for all 4 stages', () => {
    const stages: OrderStage[] = ['BROWSING', 'ORDERING', 'CONFIRMING', 'PLACED'];
    for (const stage of stages) {
      expect(ORDER_STAGE_DESCRIPTIONS[stage]).toBeTruthy();
      expect(typeof ORDER_STAGE_DESCRIPTIONS[stage]).toBe('string');
    }
  });
});

// ─── cartUpdateItemQty Unit Tests (US-861) ─────────────────────────

describe('cartUpdateItemQty — quantity update', () => {
  const newSid = () => 'qty-unit-' + Date.now() + '-' + Math.random();

  it('updates quantity of an existing item', () => {
    const sid = newSid();
    cartAddItem(sid, { name: 'Nasi Lemak', qty: 1, price: 8.50 });
    const { found, removed, items } = cartUpdateItemQty(sid, 'Nasi Lemak', 3);
    expect(found).toBe(true);
    expect(removed).toBe(false);
    expect(items[0].qty).toBe(3);
    cartClear(sid);
  });

  it('is case-insensitive for item name match', () => {
    const sid = newSid();
    cartAddItem(sid, { name: 'Teh Tarik', qty: 1 });
    const { found } = cartUpdateItemQty(sid, 'teh tarik', 2);
    expect(found).toBe(true);
    const items = cartGetItems(sid);
    expect(items[0].qty).toBe(2);
    cartClear(sid);
  });

  it('removes item when qty is 0', () => {
    const sid = newSid();
    cartAddItem(sid, { name: 'Roti Canai', qty: 2 });
    const { found, removed, items } = cartUpdateItemQty(sid, 'Roti Canai', 0);
    expect(found).toBe(true);
    expect(removed).toBe(true);
    expect(items).toHaveLength(0);
    cartClear(sid);
  });

  it('removes item when qty is negative', () => {
    const sid = newSid();
    cartAddItem(sid, { name: 'Milo Ais', qty: 1 });
    const { removed } = cartUpdateItemQty(sid, 'Milo Ais', -1);
    expect(removed).toBe(true);
    expect(cartGetItems(sid)).toHaveLength(0);
    cartClear(sid);
  });

  it('returns found: false when item is not in cart', () => {
    const sid = newSid();
    const { found, items } = cartUpdateItemQty(sid, 'Char Kway Teow', 2);
    expect(found).toBe(false);
    expect(items).toHaveLength(0);
  });
});

// ─── cart_update_qty Handler Tests (US-861) ───────────────────────

describe('Cart handlers — cart_update_qty tool (US-861)', () => {
  const newSid = () => 'qty-handler-' + Date.now() + '-' + Math.random();

  it('updates qty and returns updated cart summary', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Nasi Lemak', qty: 1, price: 8.50 });

    const result = await handlers.get('cart_update_qty')!({ name: 'Nasi Lemak', qty: 2 });
    expect(result.content[0].text).toContain('Updated Nasi Lemak to 2x');
    expect(result.content[0].text).toContain('Current cart');

    const items = cartGetItems(sid);
    expect(items[0].qty).toBe(2);

    cartClear(sid);
    clearOrderStage(sid);
  });

  it('removes item when qty is 0 and shows empty cart message', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Kopi O', qty: 2 });

    const result = await handlers.get('cart_update_qty')!({ name: 'Kopi O', qty: 0 });
    expect(result.content[0].text).toContain('Removed Kopi O');
    expect(result.content[0].text).toContain('empty');
    expect(cartGetItems(sid)).toHaveLength(0);
    expect(getOrderStage(sid)).toBe('BROWSING');

    cartClear(sid);
    clearOrderStage(sid);
  });

  it('zero-qty removal keeps ORDERING stage when other items remain', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Laksa', qty: 1 });
    await handlers.get('cart_add_item')!({ name: 'Teh Tarik', qty: 1 });

    await handlers.get('cart_update_qty')!({ name: 'Laksa', qty: 0 });

    expect(getOrderStage(sid)).toBe('ORDERING');
    expect(cartGetItems(sid)).toHaveLength(1);

    cartClear(sid);
    clearOrderStage(sid);
  });

  it('returns not-in-cart message when item is not in order', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);

    const result = await handlers.get('cart_update_qty')!({ name: 'Satay', qty: 3 });
    expect(result.content[0].text).toContain('not in your order yet');
    expect(result.content[0].text).toContain('Satay');
  });
});

// ─── Cart Handler Integration Tests ────────────────────────────────

describe('Cart handlers — order stage transitions via tools', () => {
  const newSid = () => 'cart-stage-' + Date.now() + '-' + Math.random();

  it('cart_add_item transitions stage from BROWSING to ORDERING', async () => {
    const sid = newSid();
    expect(getOrderStage(sid)).toBe('BROWSING');

    const handlers = createCartHandlers(sid);
    const addHandler = handlers.get('cart_add_item')!;
    const result = await addHandler({ name: 'Nasi Lemak', qty: 1, price: 8.50 });

    expect(result.content[0].text).toContain('Added 1x Nasi Lemak');
    expect(getOrderStage(sid)).toBe('ORDERING');

    cartClear(sid);
    clearOrderStage(sid);
  });

  it('cart_add_item merges qty and keeps ORDERING stage', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    const addHandler = handlers.get('cart_add_item')!;

    await addHandler({ name: 'Teh Tarik', qty: 1, price: 2.50 });
    await addHandler({ name: 'Teh Tarik', qty: 2, price: 2.50 });

    const items = cartGetItems(sid);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(3);
    expect(getOrderStage(sid)).toBe('ORDERING');

    cartClear(sid);
    clearOrderStage(sid);
  });

  it('cart_remove_item resets stage to BROWSING when cart becomes empty', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    const addHandler = handlers.get('cart_add_item')!;
    const removeHandler = handlers.get('cart_remove_item')!;

    await addHandler({ name: 'Milo Ais', qty: 1 });
    expect(getOrderStage(sid)).toBe('ORDERING');

    await removeHandler({ name: 'Milo Ais' });
    expect(getOrderStage(sid)).toBe('BROWSING');

    cartClear(sid);
    clearOrderStage(sid);
  });

  it('cart_remove_item keeps ORDERING stage when cart still has items', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    const addHandler = handlers.get('cart_add_item')!;
    const removeHandler = handlers.get('cart_remove_item')!;

    await addHandler({ name: 'Roti Canai', qty: 2 });
    await addHandler({ name: 'Teh Tarik', qty: 1 });
    await removeHandler({ name: 'Roti Canai' });

    expect(getOrderStage(sid)).toBe('ORDERING');

    cartClear(sid);
    clearOrderStage(sid);
  });

  it('order_request_confirmation transitions ORDERING → CONFIRMING', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Char Kway Teow', qty: 1, price: 9.00 });

    expect(getOrderStage(sid)).toBe('ORDERING');

    const result = await handlers.get('order_request_confirmation')!({});
    expect(result.content[0].text).toContain('Shall I place this order?');
    expect(result.content[0].text).toContain('Char Kway Teow');
    expect(getOrderStage(sid)).toBe('CONFIRMING');

    cartClear(sid);
    clearOrderStage(sid);
  });

  it('order_request_confirmation returns error when cart is empty', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);

    const result = await handlers.get('order_request_confirmation')!({});
    expect(result.content[0].text).toContain('empty');
    expect(getOrderStage(sid)).toBe('BROWSING'); // unchanged
  });

  it('order_confirm_submit transitions CONFIRMING → PLACED and clears cart', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Nasi Goreng', qty: 1, price: 7.50 });
    setOrderStage(sid, 'CONFIRMING');

    const result = await handlers.get('order_confirm_submit')!({ tableNumber: '5' });
    expect(result.content[0].text).toContain('kitchen');
    expect(result.content[0].text).toContain('table 5');
    expect(result.content[0].text).toContain('Nasi Goreng');

    // Stage should be cleared (back to BROWSING) after placement
    expect(getOrderStage(sid)).toBe('BROWSING');
    // Cart should be empty
    expect(cartGetItems(sid)).toHaveLength(0);
  });

  it('order_back_to_cart transitions CONFIRMING → ORDERING', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Laksa', qty: 1, price: 10.00 });
    setOrderStage(sid, 'CONFIRMING');

    const result = await handlers.get('order_back_to_cart')!({});
    expect(result.content[0].text).toContain('Laksa');
    expect(result.content[0].text).toContain('add or remove');
    expect(getOrderStage(sid)).toBe('ORDERING');

    cartClear(sid);
    clearOrderStage(sid);
  });

  it('cart_clear resets order stage', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Satay', qty: 5, price: 1.50 });
    setOrderStage(sid, 'ORDERING');

    await handlers.get('cart_clear')!({});
    expect(getOrderStage(sid)).toBe('BROWSING');
    expect(cartGetItems(sid)).toHaveLength(0);
  });
});

// ─── Full Order Flow Integration ───────────────────────────────────

describe('Full order flow: BROWSING → ORDERING → CONFIRMING → PLACED', () => {
  it('completes a full order cycle', async () => {
    const sid = 'full-flow-' + Date.now();
    const handlers = createCartHandlers(sid);

    // 1. Guest is BROWSING (default)
    expect(getOrderStage(sid)).toBe('BROWSING');

    // 2. Guest orders items → ORDERING
    await handlers.get('cart_add_item')!({ name: 'Nasi Lemak', qty: 1, price: 8.50 });
    await handlers.get('cart_add_item')!({ name: 'Teh Tarik', qty: 2, price: 2.50 });
    expect(getOrderStage(sid)).toBe('ORDERING');
    expect(cartGetItems(sid)).toHaveLength(2);

    // 3. Guest signals done → CONFIRMING
    const confirmResult = await handlers.get('order_request_confirmation')!({});
    expect(getOrderStage(sid)).toBe('CONFIRMING');
    expect(confirmResult.content[0].text).toContain('Nasi Lemak');
    expect(confirmResult.content[0].text).toContain('Teh Tarik');
    expect(confirmResult.content[0].text).toContain('Shall I place this order?');

    // 4. Guest confirms → PLACED
    const placeResult = await handlers.get('order_confirm_submit')!({});
    expect(placeResult.content[0].text).toContain('kitchen');
    expect(getOrderStage(sid)).toBe('BROWSING'); // cleared after placement
    expect(cartGetItems(sid)).toHaveLength(0);
  });

  it('completes decline flow: BROWSING → ORDERING → CONFIRMING → ORDERING', async () => {
    const sid = 'decline-flow-' + Date.now();
    const handlers = createCartHandlers(sid);

    // Add item, request confirmation, then decline
    await handlers.get('cart_add_item')!({ name: 'Roti Bakar', qty: 1, price: 4.00 });
    await handlers.get('order_request_confirmation')!({});
    expect(getOrderStage(sid)).toBe('CONFIRMING');

    // Guest declines → back to ORDERING
    await handlers.get('order_back_to_cart')!({});
    expect(getOrderStage(sid)).toBe('ORDERING');
    expect(cartGetItems(sid)).toHaveLength(1); // cart preserved

    // Add another item and confirm
    await handlers.get('cart_add_item')!({ name: 'Kopi O', qty: 1, price: 2.00 });
    await handlers.get('order_request_confirmation')!({});
    await handlers.get('order_confirm_submit')!({});
    expect(getOrderStage(sid)).toBe('BROWSING');
    expect(cartGetItems(sid)).toHaveLength(0);
  });
});

// ─── US-862: Order Cancellation ────────────────────────────────────

describe('cart_cancel_order handler (US-862)', () => {
  const newSid = () => 'cancel-' + Math.random().toString(36).slice(2);

  it('clears cart and resets to BROWSING when order is in progress', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Nasi Lemak', qty: 1, price: 8.50 });
    await handlers.get('cart_add_item')!({ name: 'Teh Tarik', qty: 2, price: 2.50 });
    expect(getOrderStage(sid)).toBe('ORDERING');

    const result = await handlers.get('cart_cancel_order')!({});
    expect(result.content[0].text).toContain('cleared');
    expect(getOrderStage(sid)).toBe('BROWSING');
    expect(cartGetItems(sid)).toHaveLength(0);
  });

  it('clears cart even from CONFIRMING stage', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Roti Canai', qty: 1, price: 3.50 });
    setOrderStage(sid, 'CONFIRMING');

    const result = await handlers.get('cart_cancel_order')!({});
    expect(result.content[0].text).toContain('cleared');
    expect(getOrderStage(sid)).toBe('BROWSING');
    expect(cartGetItems(sid)).toHaveLength(0);
  });

  it('returns nothing-to-cancel message when cart is already empty', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);

    const result = await handlers.get('cart_cancel_order')!({});
    expect(result.content[0].text).toContain('nothing to cancel');
    expect(getOrderStage(sid)).toBe('BROWSING');
  });

  it('returns kitchen message when order is already placed (PLACED stage)', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    setOrderStage(sid, 'PLACED');

    const result = await handlers.get('cart_cancel_order')!({});
    expect(result.content[0].text).toContain('kitchen');
    expect(result.content[0].text).toContain('staff');
  });

  it('message includes invitation to start new order after cancellation', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Curry Puff', qty: 3, price: 1.50 });

    const result = await handlers.get('cart_cancel_order')!({});
    expect(result.content[0].text).toMatch(/new order|start/i);
  });
});

// ─── US-852: Special Instructions Capture ────────────────────────

describe('cartSetItemNotes — unit tests (US-852)', () => {
  const newSid = () => 'notes-unit-' + Date.now() + '-' + Math.random();

  it('sets notes on an existing cart item', () => {
    const sid = newSid();
    cartAddItem(sid, { name: 'Nasi Lemak', qty: 1, price: 8.50 });
    const { found, items } = cartSetItemNotes(sid, 'Nasi Lemak', 'no onion');
    expect(found).toBe(true);
    expect(items[0].notes).toBe('no onion');
    cartClear(sid);
  });

  it('appends to existing notes', () => {
    const sid = newSid();
    cartAddItem(sid, { name: 'Teh Tarik', qty: 1, notes: 'less sugar' });
    const { found, items } = cartSetItemNotes(sid, 'Teh Tarik', 'extra hot');
    expect(found).toBe(true);
    expect(items[0].notes).toBe('less sugar, extra hot');
    cartClear(sid);
  });

  it('is case-insensitive for item name', () => {
    const sid = newSid();
    cartAddItem(sid, { name: 'Roti Canai', qty: 1 });
    const { found } = cartSetItemNotes(sid, 'roti canai', 'extra crispy');
    expect(found).toBe(true);
    cartClear(sid);
  });

  it('returns found: false for non-existent item', () => {
    const sid = newSid();
    cartAddItem(sid, { name: 'Laksa', qty: 1 });
    const { found } = cartSetItemNotes(sid, 'Char Kway Teow', 'no bean sprouts');
    expect(found).toBe(false);
    cartClear(sid);
  });
});

describe('cartFormatSummary — notes display (US-852)', () => {
  it('shows notes per line item in summary', () => {
    const items = [
      { name: 'Nasi Lemak', qty: 1, price: 8.50, notes: 'no onion' },
      { name: 'Teh Tarik', qty: 2, price: 2.50 },
    ];
    const summary = cartFormatSummary(items);
    expect(summary).toContain('[no onion]');
    expect(summary).toContain('Nasi Lemak');
    expect(summary).toContain('Teh Tarik');
    // Teh Tarik has no notes — no brackets expected
    expect(summary).not.toContain('[undefined]');
  });
});

describe('cart_set_item_notes handler (US-852)', () => {
  const newSid = () => 'notes-handler-' + Date.now() + '-' + Math.random();

  it('attaches notes to a cart item and shows updated cart', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Nasi Lemak', qty: 1, price: 8.50 });

    const result = await handlers.get('cart_set_item_notes')!({ name: 'Nasi Lemak', notes: 'extra spicy' });
    expect(result.content[0].text).toContain('extra spicy');
    expect(result.content[0].text).toContain('Nasi Lemak');
    expect(result.content[0].text).toContain('Current cart');

    const items = cartGetItems(sid);
    expect(items[0].notes).toBe('extra spicy');
    cartClear(sid);
    clearOrderStage(sid);
  });

  it('appends notes when item already has notes', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Teh Tarik', qty: 1, notes: 'less sugar' });

    const result = await handlers.get('cart_set_item_notes')!({ name: 'Teh Tarik', notes: 'extra hot' });
    expect(result.content[0].text).toContain('extra hot');

    const items = cartGetItems(sid);
    expect(items[0].notes).toBe('less sugar, extra hot');
    cartClear(sid);
    clearOrderStage(sid);
  });

  it('returns not-in-cart message for unknown item', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Laksa', qty: 1 });

    const result = await handlers.get('cart_set_item_notes')!({ name: 'Satay', notes: 'no peanuts' });
    expect(result.content[0].text).toContain('not in');
    cartClear(sid);
    clearOrderStage(sid);
  });

  it('suggests the only cart item when target name does not match', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Roti Canai', qty: 1 });

    const result = await handlers.get('cart_set_item_notes')!({ name: 'Nasi', notes: 'no egg' });
    expect(result.content[0].text).toContain('Roti Canai');
    expect(result.content[0].text).toContain('Did you mean');
    cartClear(sid);
    clearOrderStage(sid);
  });

  it('notes are included in cart_add_item when passed directly', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Mee Goreng', qty: 1, notes: 'without cucumber' });

    const items = cartGetItems(sid);
    expect(items[0].notes).toBe('without cucumber');
    cartClear(sid);
    clearOrderStage(sid);
  });
});

// ─── US-853: Table Number / Order Type Tests ─────────────────────────

describe('Cart Store — Table Info (US-853)', () => {
  const newSid = () => 'table-unit-' + Date.now() + '-' + Math.random();

  it('returns undefined when no table info is set', () => {
    expect(cartGetTableInfo('no-table-session')).toBeUndefined();
  });

  it('stores and retrieves table number', () => {
    const sid = newSid();
    cartSetTableInfo(sid, { tableNumber: '5', orderType: 'dine-in' });
    const info = cartGetTableInfo(sid);
    expect(info?.tableNumber).toBe('5');
    expect(info?.orderType).toBe('dine-in');
    cartClear(sid);
  });

  it('stores takeaway order type without table number', () => {
    const sid = newSid();
    cartSetTableInfo(sid, { orderType: 'takeaway' });
    const info = cartGetTableInfo(sid);
    expect(info?.orderType).toBe('takeaway');
    expect(info?.tableNumber).toBeUndefined();
    cartClear(sid);
  });

  it('clears table info when cart is cleared', () => {
    const sid = newSid();
    cartSetTableInfo(sid, { tableNumber: '3', orderType: 'dine-in' });
    cartClear(sid);
    expect(cartGetTableInfo(sid)).toBeUndefined();
  });
});

describe('Cart Handler — cart_set_table (US-853)', () => {
  const newSid = () => 'table-handler-' + Date.now() + '-' + Math.random();

  it('sets table number via handler', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    const result = await handlers.get('cart_set_table')!({ tableNumber: 'T5' });
    expect(result.content[0].text).toContain('5');
    const info = cartGetTableInfo(sid);
    expect(info?.tableNumber).toBe('5');
    expect(info?.orderType).toBe('dine-in');
    cartClear(sid);
  });

  it('sets takeaway via handler', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    const result = await handlers.get('cart_set_table')!({ orderType: 'takeaway' });
    expect(result.content[0].text).toContain('Takeaway');
    const info = cartGetTableInfo(sid);
    expect(info?.orderType).toBe('takeaway');
    cartClear(sid);
  });

  it('normalizes "table 5" pattern to just "5"', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_set_table')!({ tableNumber: 'table 5' });
    const info = cartGetTableInfo(sid);
    expect(info?.tableNumber).toBe('5');
    cartClear(sid);
  });

  it('returns error when no table or order type given', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    const result = await handlers.get('cart_set_table')!({});
    expect(result.content[0].text).toContain('provide');
    cartClear(sid);
  });

  it('includes table info in order confirmation summary', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Nasi Lemak', qty: 1, price: 8.50 });
    await handlers.get('cart_set_table')!({ tableNumber: '7' });
    const result = await handlers.get('order_request_confirmation')!({});
    expect(result.content[0].text).toContain('Table: 7');
    cartClear(sid);
    clearOrderStage(sid);
  });

  it('includes takeaway in order confirmation summary', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid);
    await handlers.get('cart_add_item')!({ name: 'Roti Canai', qty: 2, price: 3.00 });
    await handlers.get('cart_set_table')!({ orderType: 'takeaway' });
    const result = await handlers.get('order_request_confirmation')!({});
    expect(result.content[0].text).toContain('Takeaway');
    cartClear(sid);
    clearOrderStage(sid);
  });
});

// ─── US-881: Order Modification Store Unit Tests ────────────────────

describe('Order Modification Store (US-881)', () => {
  const newSid = () => 'mod-store-' + Date.now() + '-' + Math.random();

  it('isModificationAllowed returns true within window', () => {
    const sid = newSid();
    startModificationWindow(sid, 'MM-TEST1', [{ name: 'Nasi Lemak', qty: 1, price: 8.50 }], undefined, 120000);
    expect(isModificationAllowed(sid).allowed).toBe(true);
    closeModificationWindow(sid);
  });

  it('isModificationAllowed returns false after kitchen acceptance', () => {
    const sid = newSid();
    const orderId = 'MM-TEST2';
    startModificationWindow(sid, orderId, [{ name: 'Teh Tarik', qty: 1 }], undefined, 120000);
    markKitchenAccepted(orderId);
    expect(isModificationAllowed(sid).allowed).toBe(false);
    expect(isModificationAllowed(sid).reason).toBe('kitchen_accepted');
    closeModificationWindow(sid);
  });

  it('isModificationAllowed returns false for unknown session', () => {
    expect(isModificationAllowed('nonexistent-session').allowed).toBe(false);
    expect(isModificationAllowed('nonexistent-session').reason).toBe('no_order');
  });

  it('getModificationTimeRemaining returns positive value within window', () => {
    const sid = newSid();
    startModificationWindow(sid, 'MM-TEST3', [{ name: 'Milo', qty: 1 }], undefined, 60000);
    const remaining = getModificationTimeRemaining(sid);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(60);
    closeModificationWindow(sid);
  });

  it('getModificationTimeRemaining returns 0 for expired/closed window', () => {
    expect(getModificationTimeRemaining('nonexistent')).toBe(0);
  });
});

// ─── US-881: Cart Handler — order_modify_request ─────────────────────

describe('Cart handlers — order_modify_request tool (US-881)', () => {
  const newSid = () => 'mod-handler-' + Date.now() + '-' + Math.random();

  it('re-opens cart with original items within modification window', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, { modificationWindowMs: 120000 });

    // Place an order
    await handlers.get('cart_add_item')!({ name: 'Nasi Lemak', qty: 1, price: 8.50 });
    await handlers.get('cart_add_item')!({ name: 'Teh Tarik', qty: 2, price: 2.50 });
    setOrderStage(sid, 'CONFIRMING');
    await handlers.get('order_confirm_submit')!({ tableNumber: '5' });

    // Cart should be empty after placement
    expect(cartGetItems(sid)).toHaveLength(0);

    // Request modification within window
    const modResult = await handlers.get('order_modify_request')!({});
    expect(modResult.content[0].text).toContain('re-opened');
    expect(modResult.content[0].text).toContain('Nasi Lemak');
    expect(modResult.content[0].text).toContain('Teh Tarik');

    // Cart should be repopulated
    const items = cartGetItems(sid);
    expect(items).toHaveLength(2);
    expect(getOrderStage(sid)).toBe('ORDERING');

    cartClear(sid);
    clearOrderStage(sid);
  });

  it('returns polite rejection when no order to modify', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, { modificationWindowMs: 120000 });

    const result = await handlers.get('order_modify_request')!({});
    expect(result.content[0].text).toContain('no recent order');
  });

  it('returns polite rejection when kitchen has accepted', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, { modificationWindowMs: 120000 });
    const testOrderId = 'MM-TEST-KITCHEN';

    // Manually set up modification window with a known order ID
    // (bypasses fnb_create_order which may not resolve in test env)
    startModificationWindow(
      sid,
      testOrderId,
      [{ name: 'Roti Canai', qty: 1, price: 3.50 }],
      { tableNumber: '3', orderType: 'dine-in' },
      120000
    );

    // Simulate kitchen acceptance via webhook
    markKitchenAccepted(testOrderId);

    const result = await handlers.get('order_modify_request')!({});
    expect(result.content[0].text).toContain('kitchen');

    closeModificationWindow(sid);
    cartClear(sid);
    clearOrderStage(sid);
  });

  it('prevents double modification (snapshot consumed on first request)', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, { modificationWindowMs: 120000 });

    // Place an order
    await handlers.get('cart_add_item')!({ name: 'Laksa', qty: 1, price: 10.00 });
    setOrderStage(sid, 'CONFIRMING');
    await handlers.get('order_confirm_submit')!({ tableNumber: '1' });

    // First modification — should succeed
    const mod1 = await handlers.get('order_modify_request')!({});
    expect(mod1.content[0].text).toContain('re-opened');

    // Clear cart and stage to simulate user is done modifying
    cartClear(sid);
    clearOrderStage(sid);

    // Second modification — snapshot consumed, should fail
    const mod2 = await handlers.get('order_modify_request')!({});
    expect(mod2.content[0].text).toContain('no recent order');
  });
});
