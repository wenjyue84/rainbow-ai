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
} from '../cart-store.js';
import { createCartHandlers } from '../../tools/cart.js';

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
