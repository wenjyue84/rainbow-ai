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

const PID = 'test';
// ─── State Machine Unit Tests ───────────────────────────────────────

describe('Order Stage Store — getOrderStage', () => {
  it('returns BROWSING for a new/unknown session', () => {
    expect(getOrderStage(PID, 'new-session-xyz')).toBe('BROWSING');
  });

  it('returns the stage that was set', () => {
    const sid = 'test-set-' + Date.now();
    setOrderStage(PID, sid, 'ORDERING');
    expect(getOrderStage(PID, sid)).toBe('ORDERING');
    clearOrderStage(PID, sid);
  });

  it('clearOrderStage resets to BROWSING (undefined)', () => {
    const sid = 'test-clear-' + Date.now();
    setOrderStage(PID, sid, 'CONFIRMING');
    clearOrderStage(PID, sid);
    expect(getOrderStage(PID, sid)).toBe('BROWSING');
  });
});

describe('Order Stage Store — transitionOrderStage', () => {
  const sid = () => 'trans-' + Date.now() + '-' + Math.random();

  it('BROWSING → ORDERING is valid', () => {
    const s = sid();
    const result = transitionOrderStage(PID, s, 'ORDERING');
    expect(result).toBe('ORDERING');
    expect(getOrderStage(PID, s)).toBe('ORDERING');
    clearOrderStage(PID, s);
  });

  it('ORDERING → CONFIRMING is valid', () => {
    const s = sid();
    setOrderStage(PID, s, 'ORDERING');
    const result = transitionOrderStage(PID, s, 'CONFIRMING');
    expect(result).toBe('CONFIRMING');
    expect(getOrderStage(PID, s)).toBe('CONFIRMING');
    clearOrderStage(PID, s);
  });

  it('CONFIRMING → PLACED is valid (guest confirms)', () => {
    const s = sid();
    setOrderStage(PID, s, 'CONFIRMING');
    const result = transitionOrderStage(PID, s, 'PLACED');
    expect(result).toBe('PLACED');
    expect(getOrderStage(PID, s)).toBe('PLACED');
    clearOrderStage(PID, s);
  });

  it('CONFIRMING → ORDERING is valid (guest declines)', () => {
    const s = sid();
    setOrderStage(PID, s, 'CONFIRMING');
    const result = transitionOrderStage(PID, s, 'ORDERING');
    expect(result).toBe('ORDERING');
    expect(getOrderStage(PID, s)).toBe('ORDERING');
    clearOrderStage(PID, s);
  });

  it('PLACED → BROWSING is valid (fresh start)', () => {
    const s = sid();
    setOrderStage(PID, s, 'PLACED');
    const result = transitionOrderStage(PID, s, 'BROWSING');
    expect(result).toBe('BROWSING');
    expect(getOrderStage(PID, s)).toBe('BROWSING');
    clearOrderStage(PID, s);
  });

  it('Any → BROWSING is valid (reset)', () => {
    const stages: OrderStage[] = ['BROWSING', 'ORDERING', 'CONFIRMING', 'PLACED'];
    for (const stage of stages) {
      const s = sid();
      setOrderStage(PID, s, stage);
      const result = transitionOrderStage(PID, s, 'BROWSING');
      expect(result).toBe('BROWSING');
      clearOrderStage(PID, s);
    }
  });

  it('BROWSING → CONFIRMING is invalid (skipping ORDERING)', () => {
    const s = sid();
    // Default is BROWSING
    const result = transitionOrderStage(PID, s, 'CONFIRMING');
    expect(result).toBe('BROWSING'); // stays put
    expect(getOrderStage(PID, s)).toBe('BROWSING');
    clearOrderStage(PID, s);
  });

  it('BROWSING → PLACED is invalid', () => {
    const s = sid();
    const result = transitionOrderStage(PID, s, 'PLACED');
    expect(result).toBe('BROWSING'); // stays put
    clearOrderStage(PID, s);
  });

  it('PLACED → ORDERING is invalid', () => {
    const s = sid();
    setOrderStage(PID, s, 'PLACED');
    const result = transitionOrderStage(PID, s, 'ORDERING');
    expect(result).toBe('PLACED'); // stays put
    clearOrderStage(PID, s);
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
    cartAddItem(PID, sid, { name: 'Nasi Lemak', qty: 1, price: 8.50 });
    const { found, removed, items } = cartUpdateItemQty(PID, sid, 'Nasi Lemak', 3);
    expect(found).toBe(true);
    expect(removed).toBe(false);
    expect(items[0].qty).toBe(3);
    cartClear(PID, sid);
  });

  it('is case-insensitive for item name match', () => {
    const sid = newSid();
    cartAddItem(PID, sid, { name: 'Teh Tarik', qty: 1 });
    const { found } = cartUpdateItemQty(PID, sid, 'teh tarik', 2);
    expect(found).toBe(true);
    const items = cartGetItems(PID, sid);
    expect(items[0].qty).toBe(2);
    cartClear(PID, sid);
  });

  it('removes item when qty is 0', () => {
    const sid = newSid();
    cartAddItem(PID, sid, { name: 'Roti Canai', qty: 2 });
    const { found, removed, items } = cartUpdateItemQty(PID, sid, 'Roti Canai', 0);
    expect(found).toBe(true);
    expect(removed).toBe(true);
    expect(items).toHaveLength(0);
    cartClear(PID, sid);
  });

  it('removes item when qty is negative', () => {
    const sid = newSid();
    cartAddItem(PID, sid, { name: 'Milo Ais', qty: 1 });
    const { removed } = cartUpdateItemQty(PID, sid, 'Milo Ais', -1);
    expect(removed).toBe(true);
    expect(cartGetItems(PID, sid)).toHaveLength(0);
    cartClear(PID, sid);
  });

  it('returns found: false when item is not in cart', () => {
    const sid = newSid();
    const { found, items } = cartUpdateItemQty(PID, sid, 'Char Kway Teow', 2);
    expect(found).toBe(false);
    expect(items).toHaveLength(0);
  });
});

// ─── cart_update_qty Handler Tests (US-861) ───────────────────────

describe('Cart handlers — cart_update_qty tool (US-861)', () => {
  const newSid = () => 'qty-handler-' + Date.now() + '-' + Math.random();

  it('updates qty and returns updated cart summary', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Nasi Lemak', qty: 1, price: 8.50 });

    const result = await handlers.get('cart_update_qty')!({ name: 'Nasi Lemak', qty: 2 });
    expect(result.content[0].text).toContain('Updated Nasi Lemak to 2x');
    expect(result.content[0].text).toContain('Current cart');

    const items = cartGetItems(PID, sid);
    expect(items[0].qty).toBe(2);

    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });

  it('removes item when qty is 0 and shows empty cart message', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Kopi O', qty: 2 });

    const result = await handlers.get('cart_update_qty')!({ name: 'Kopi O', qty: 0 });
    expect(result.content[0].text).toContain('Removed Kopi O');
    expect(result.content[0].text).toContain('empty');
    expect(cartGetItems(PID, sid)).toHaveLength(0);
    expect(getOrderStage(PID, sid)).toBe('BROWSING');

    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });

  it('zero-qty removal keeps ORDERING stage when other items remain', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Laksa', qty: 1 });
    await handlers.get('cart_add_item')!({ name: 'Teh Tarik', qty: 1 });

    await handlers.get('cart_update_qty')!({ name: 'Laksa', qty: 0 });

    expect(getOrderStage(PID, sid)).toBe('ORDERING');
    expect(cartGetItems(PID, sid)).toHaveLength(1);

    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });

  it('returns not-in-cart message when item is not in order', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);

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
    expect(getOrderStage(PID, sid)).toBe('BROWSING');

    const handlers = createCartHandlers(sid, PID);
    const addHandler = handlers.get('cart_add_item')!;
    const result = await addHandler({ name: 'Nasi Lemak', qty: 1, price: 8.50 });

    expect(result.content[0].text).toContain('Added 1x Nasi Lemak');
    expect(getOrderStage(PID, sid)).toBe('ORDERING');

    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });

  it('cart_add_item merges qty and keeps ORDERING stage', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    const addHandler = handlers.get('cart_add_item')!;

    await addHandler({ name: 'Teh Tarik', qty: 1, price: 2.50 });
    await addHandler({ name: 'Teh Tarik', qty: 2, price: 2.50 });

    const items = cartGetItems(PID, sid);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(3);
    expect(getOrderStage(PID, sid)).toBe('ORDERING');

    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });

  it('cart_remove_item resets stage to BROWSING when cart becomes empty', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    const addHandler = handlers.get('cart_add_item')!;
    const removeHandler = handlers.get('cart_remove_item')!;

    await addHandler({ name: 'Milo Ais', qty: 1 });
    expect(getOrderStage(PID, sid)).toBe('ORDERING');

    await removeHandler({ name: 'Milo Ais' });
    expect(getOrderStage(PID, sid)).toBe('BROWSING');

    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });

  it('cart_remove_item keeps ORDERING stage when cart still has items', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    const addHandler = handlers.get('cart_add_item')!;
    const removeHandler = handlers.get('cart_remove_item')!;

    await addHandler({ name: 'Roti Canai', qty: 2 });
    await addHandler({ name: 'Teh Tarik', qty: 1 });
    await removeHandler({ name: 'Roti Canai' });

    expect(getOrderStage(PID, sid)).toBe('ORDERING');

    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });

  it('order_request_confirmation transitions ORDERING → CONFIRMING', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Char Kway Teow', qty: 1, price: 9.00 });

    expect(getOrderStage(PID, sid)).toBe('ORDERING');

    const result = await handlers.get('order_request_confirmation')!({});
    expect(result.content[0].text).toContain('Shall I place this order?');
    expect(result.content[0].text).toContain('Char Kway Teow');
    expect(getOrderStage(PID, sid)).toBe('CONFIRMING');

    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });

  it('order_request_confirmation returns error when cart is empty', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);

    const result = await handlers.get('order_request_confirmation')!({});
    expect(result.content[0].text).toContain('empty');
    expect(getOrderStage(PID, sid)).toBe('BROWSING'); // unchanged
  });

  it('order_confirm_submit transitions CONFIRMING → PLACED and clears cart', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Nasi Goreng', qty: 1, price: 7.50 });
    setOrderStage(PID, sid, 'CONFIRMING');

    const result = await handlers.get('order_confirm_submit')!({ tableNumber: '5' });
    expect(result.content[0].text).toContain('kitchen');
    expect(result.content[0].text).toContain('table 5');
    expect(result.content[0].text).toContain('Nasi Goreng');

    // Stage should be cleared (back to BROWSING) after placement
    expect(getOrderStage(PID, sid)).toBe('BROWSING');
    // Cart should be empty
    expect(cartGetItems(PID, sid)).toHaveLength(0);
  });

  it('order_back_to_cart transitions CONFIRMING → ORDERING', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Laksa', qty: 1, price: 10.00 });
    setOrderStage(PID, sid, 'CONFIRMING');

    const result = await handlers.get('order_back_to_cart')!({});
    expect(result.content[0].text).toContain('Laksa');
    expect(result.content[0].text).toContain('add or remove');
    expect(getOrderStage(PID, sid)).toBe('ORDERING');

    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });

  it('cart_clear resets order stage', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Satay', qty: 5, price: 1.50 });
    setOrderStage(PID, sid, 'ORDERING');

    await handlers.get('cart_clear')!({});
    expect(getOrderStage(PID, sid)).toBe('BROWSING');
    expect(cartGetItems(PID, sid)).toHaveLength(0);
  });
});

// ─── Full Order Flow Integration ───────────────────────────────────

describe('Full order flow: BROWSING → ORDERING → CONFIRMING → PLACED', () => {
  it('completes a full order cycle', async () => {
    const sid = 'full-flow-' + Date.now();
    const handlers = createCartHandlers(sid, PID);

    // 1. Guest is BROWSING (default)
    expect(getOrderStage(PID, sid)).toBe('BROWSING');

    // 2. Guest orders items → ORDERING
    await handlers.get('cart_add_item')!({ name: 'Nasi Lemak', qty: 1, price: 8.50 });
    await handlers.get('cart_add_item')!({ name: 'Teh Tarik', qty: 2, price: 2.50 });
    expect(getOrderStage(PID, sid)).toBe('ORDERING');
    expect(cartGetItems(PID, sid)).toHaveLength(2);

    // 3. Guest signals done → CONFIRMING
    const confirmResult = await handlers.get('order_request_confirmation')!({});
    expect(getOrderStage(PID, sid)).toBe('CONFIRMING');
    expect(confirmResult.content[0].text).toContain('Nasi Lemak');
    expect(confirmResult.content[0].text).toContain('Teh Tarik');
    expect(confirmResult.content[0].text).toContain('Shall I place this order?');

    // 4. Guest confirms → PLACED
    const placeResult = await handlers.get('order_confirm_submit')!({});
    expect(placeResult.content[0].text).toContain('kitchen');
    expect(getOrderStage(PID, sid)).toBe('BROWSING'); // cleared after placement
    expect(cartGetItems(PID, sid)).toHaveLength(0);
  });

  it('completes decline flow: BROWSING → ORDERING → CONFIRMING → ORDERING', async () => {
    const sid = 'decline-flow-' + Date.now();
    const handlers = createCartHandlers(sid, PID);

    // Add item, request confirmation, then decline
    await handlers.get('cart_add_item')!({ name: 'Roti Bakar', qty: 1, price: 4.00 });
    await handlers.get('order_request_confirmation')!({});
    expect(getOrderStage(PID, sid)).toBe('CONFIRMING');

    // Guest declines → back to ORDERING
    await handlers.get('order_back_to_cart')!({});
    expect(getOrderStage(PID, sid)).toBe('ORDERING');
    expect(cartGetItems(PID, sid)).toHaveLength(1); // cart preserved

    // Add another item and confirm
    await handlers.get('cart_add_item')!({ name: 'Kopi O', qty: 1, price: 2.00 });
    await handlers.get('order_request_confirmation')!({});
    await handlers.get('order_confirm_submit')!({});
    expect(getOrderStage(PID, sid)).toBe('BROWSING');
    expect(cartGetItems(PID, sid)).toHaveLength(0);
  });
});

// ─── US-862: Order Cancellation ────────────────────────────────────

describe('cart_cancel_order handler (US-862)', () => {
  const newSid = () => 'cancel-' + Math.random().toString(36).slice(2);

  it('clears cart and resets to BROWSING when order is in progress', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Nasi Lemak', qty: 1, price: 8.50 });
    await handlers.get('cart_add_item')!({ name: 'Teh Tarik', qty: 2, price: 2.50 });
    expect(getOrderStage(PID, sid)).toBe('ORDERING');

    const result = await handlers.get('cart_cancel_order')!({});
    expect(result.content[0].text).toContain('cleared');
    expect(getOrderStage(PID, sid)).toBe('BROWSING');
    expect(cartGetItems(PID, sid)).toHaveLength(0);
  });

  it('clears cart even from CONFIRMING stage', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Roti Canai', qty: 1, price: 3.50 });
    setOrderStage(PID, sid, 'CONFIRMING');

    const result = await handlers.get('cart_cancel_order')!({});
    expect(result.content[0].text).toContain('cleared');
    expect(getOrderStage(PID, sid)).toBe('BROWSING');
    expect(cartGetItems(PID, sid)).toHaveLength(0);
  });

  it('returns nothing-to-cancel message when cart is already empty', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);

    const result = await handlers.get('cart_cancel_order')!({});
    expect(result.content[0].text).toContain('nothing to cancel');
    expect(getOrderStage(PID, sid)).toBe('BROWSING');
  });

  it('returns kitchen message when order is already placed (PLACED stage)', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    setOrderStage(PID, sid, 'PLACED');

    const result = await handlers.get('cart_cancel_order')!({});
    expect(result.content[0].text).toContain('kitchen');
    expect(result.content[0].text).toContain('staff');
  });

  it('message includes invitation to start new order after cancellation', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
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
    cartAddItem(PID, sid, { name: 'Nasi Lemak', qty: 1, price: 8.50 });
    const { found, items } = cartSetItemNotes(PID, sid, 'Nasi Lemak', 'no onion');
    expect(found).toBe(true);
    expect(items[0].notes).toBe('no onion');
    cartClear(PID, sid);
  });

  it('appends to existing notes', () => {
    const sid = newSid();
    cartAddItem(PID, sid, { name: 'Teh Tarik', qty: 1, notes: 'less sugar' });
    const { found, items } = cartSetItemNotes(PID, sid, 'Teh Tarik', 'extra hot');
    expect(found).toBe(true);
    expect(items[0].notes).toBe('less sugar, extra hot');
    cartClear(PID, sid);
  });

  it('is case-insensitive for item name', () => {
    const sid = newSid();
    cartAddItem(PID, sid, { name: 'Roti Canai', qty: 1 });
    const { found } = cartSetItemNotes(PID, sid, 'roti canai', 'extra crispy');
    expect(found).toBe(true);
    cartClear(PID, sid);
  });

  it('returns found: false for non-existent item', () => {
    const sid = newSid();
    cartAddItem(PID, sid, { name: 'Laksa', qty: 1 });
    const { found } = cartSetItemNotes(PID, sid, 'Char Kway Teow', 'no bean sprouts');
    expect(found).toBe(false);
    cartClear(PID, sid);
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
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Nasi Lemak', qty: 1, price: 8.50 });

    const result = await handlers.get('cart_set_item_notes')!({ name: 'Nasi Lemak', notes: 'extra spicy' });
    expect(result.content[0].text).toContain('extra spicy');
    expect(result.content[0].text).toContain('Nasi Lemak');
    expect(result.content[0].text).toContain('Current cart');

    const items = cartGetItems(PID, sid);
    expect(items[0].notes).toBe('extra spicy');
    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });

  it('appends notes when item already has notes', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Teh Tarik', qty: 1, notes: 'less sugar' });

    const result = await handlers.get('cart_set_item_notes')!({ name: 'Teh Tarik', notes: 'extra hot' });
    expect(result.content[0].text).toContain('extra hot');

    const items = cartGetItems(PID, sid);
    expect(items[0].notes).toBe('less sugar, extra hot');
    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });

  it('returns not-in-cart message for unknown item', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Laksa', qty: 1 });

    const result = await handlers.get('cart_set_item_notes')!({ name: 'Satay', notes: 'no peanuts' });
    expect(result.content[0].text).toContain('not in');
    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });

  it('suggests the only cart item when target name does not match', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Roti Canai', qty: 1 });

    const result = await handlers.get('cart_set_item_notes')!({ name: 'Nasi', notes: 'no egg' });
    expect(result.content[0].text).toContain('Roti Canai');
    expect(result.content[0].text).toContain('Did you mean');
    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });

  it('notes are included in cart_add_item when passed directly', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Mee Goreng', qty: 1, notes: 'without cucumber' });

    const items = cartGetItems(PID, sid);
    expect(items[0].notes).toBe('without cucumber');
    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });
});

// ─── US-853: Table Number / Order Type Tests ─────────────────────────

describe('Cart Store — Table Info (US-853)', () => {
  const newSid = () => 'table-unit-' + Date.now() + '-' + Math.random();

  it('returns undefined when no table info is set', () => {
    expect(cartGetTableInfo(PID, 'no-table-session')).toBeUndefined();
  });

  it('stores and retrieves table number', () => {
    const sid = newSid();
    cartSetTableInfo(PID, sid, { tableNumber: '5', orderType: 'dine-in' });
    const info = cartGetTableInfo(PID, sid);
    expect(info?.tableNumber).toBe('5');
    expect(info?.orderType).toBe('dine-in');
    cartClear(PID, sid);
  });

  it('stores takeaway order type without table number', () => {
    const sid = newSid();
    cartSetTableInfo(PID, sid, { orderType: 'takeaway' });
    const info = cartGetTableInfo(PID, sid);
    expect(info?.orderType).toBe('takeaway');
    expect(info?.tableNumber).toBeUndefined();
    cartClear(PID, sid);
  });

  it('clears table info when cart is cleared', () => {
    const sid = newSid();
    cartSetTableInfo(PID, sid, { tableNumber: '3', orderType: 'dine-in' });
    cartClear(PID, sid);
    expect(cartGetTableInfo(PID, sid)).toBeUndefined();
  });
});

describe('Cart Handler — cart_set_table (US-853)', () => {
  const newSid = () => 'table-handler-' + Date.now() + '-' + Math.random();

  it('sets table number via handler', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    const result = await handlers.get('cart_set_table')!({ tableNumber: 'T5' });
    expect(result.content[0].text).toContain('5');
    const info = cartGetTableInfo(PID, sid);
    expect(info?.tableNumber).toBe('5');
    expect(info?.orderType).toBe('dine-in');
    cartClear(PID, sid);
  });

  it('sets takeaway via handler', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    const result = await handlers.get('cart_set_table')!({ orderType: 'takeaway' });
    expect(result.content[0].text).toContain('Takeaway');
    const info = cartGetTableInfo(PID, sid);
    expect(info?.orderType).toBe('takeaway');
    cartClear(PID, sid);
  });

  it('normalizes "table 5" pattern to just "5"', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_set_table')!({ tableNumber: 'table 5' });
    const info = cartGetTableInfo(PID, sid);
    expect(info?.tableNumber).toBe('5');
    cartClear(PID, sid);
  });

  it('returns error when no table or order type given', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    const result = await handlers.get('cart_set_table')!({});
    expect(result.content[0].text).toContain('provide');
    cartClear(PID, sid);
  });

  it('includes table info in order confirmation summary', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Nasi Lemak', qty: 1, price: 8.50 });
    await handlers.get('cart_set_table')!({ tableNumber: '7' });
    const result = await handlers.get('order_request_confirmation')!({});
    expect(result.content[0].text).toContain('Table: 7');
    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });

  it('includes takeaway in order confirmation summary', async () => {
    const sid = newSid();
    const handlers = createCartHandlers(sid, PID);
    await handlers.get('cart_add_item')!({ name: 'Roti Canai', qty: 2, price: 3.00 });
    await handlers.get('cart_set_table')!({ orderType: 'takeaway' });
    const result = await handlers.get('order_request_confirmation')!({});
    expect(result.content[0].text).toContain('Takeaway');
    cartClear(PID, sid);
    clearOrderStage(PID, sid);
  });
});
