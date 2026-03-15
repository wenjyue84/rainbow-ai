/**
 * US-921: WCAG 2.2 SC 3.3.7 — Redundant Entry Prevention Tests
 *
 * Verifies that session data (name, table, address) persists across order cycles
 * and is surfaced in system prompts to prevent re-asking.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSessionData,
  saveSessionData,
  clearSessionData,
  formatSessionDataPrompt,
  type SessionData,
} from '../session-data-store.js';
import {
  cartSetTableInfo,
  cartGetTableInfo,
  cartClear,
} from '../cart-store.js';
import { createCartHandlers } from '../../tools/cart.js';

const SESSION_ID = 'test-redundant-entry-session';

beforeEach(() => {
  clearSessionData(SESSION_ID);
  cartClear(SESSION_ID);
});

// ─── AC1: Name from onboarding pre-fills checkout ─────────────────

describe('AC1: Customer name persists from onboarding to checkout', () => {
  it('saves customer name via session_save_info tool', async () => {
    const handlers = createCartHandlers(SESSION_ID);
    const handler = handlers.get('session_save_info')!;

    const result = await handler({ customerName: 'Sarah' });
    expect(result.content[0].text).toContain('customerName');

    const data = getSessionData(SESSION_ID);
    expect(data.customerName).toBe('Sarah');
  });

  it('customer name survives cart clear (order placement)', async () => {
    saveSessionData(SESSION_ID, { customerName: 'Ahmad' });
    cartClear(SESSION_ID);

    const data = getSessionData(SESSION_ID);
    expect(data.customerName).toBe('Ahmad');
  });

  it('system prompt includes customer name with do-not-ask instruction', () => {
    const data: SessionData = { customerName: 'Sarah' };
    const prompt = formatSessionDataPrompt(data);
    expect(prompt).toContain('Sarah');
    expect(prompt).toContain('do NOT ask again');
  });
});

// ─── AC2: Table/seat number carried through to order confirmation ──

describe('AC2: Table number carried through without re-asking', () => {
  it('cart_set_table persists table to session data store', async () => {
    const handlers = createCartHandlers(SESSION_ID);
    const handler = handlers.get('cart_set_table')!;

    await handler({ tableNumber: '5' });

    // Cart has it
    const tableInfo = cartGetTableInfo(SESSION_ID);
    expect(tableInfo?.tableNumber).toBe('5');

    // Session data store also has it
    const sessionData = getSessionData(SESSION_ID);
    expect(sessionData.tableNumber).toBe('5');
    expect(sessionData.orderType).toBe('dine-in');
  });

  it('table info persists in session data after cart clear', async () => {
    const handlers = createCartHandlers(SESSION_ID);
    await handlers.get('cart_set_table')!({ tableNumber: '7' });

    // Simulate order placement: cart is cleared
    cartClear(SESSION_ID);

    // Cart table info is gone
    expect(cartGetTableInfo(SESSION_ID)).toBeUndefined();

    // Session data still has it
    const sessionData = getSessionData(SESSION_ID);
    expect(sessionData.tableNumber).toBe('7');
    expect(sessionData.orderType).toBe('dine-in');
  });

  it('takeaway order type persists across orders', async () => {
    const handlers = createCartHandlers(SESSION_ID);
    await handlers.get('cart_set_table')!({ orderType: 'takeaway' });

    cartClear(SESSION_ID);

    const sessionData = getSessionData(SESSION_ID);
    expect(sessionData.orderType).toBe('takeaway');
  });
});

// ─── AC3: Delivery address pre-fill for next order ──────────────────

describe('AC3: Delivery address offered as pre-fill for next order', () => {
  it('saves delivery address via session_save_info', async () => {
    const handlers = createCartHandlers(SESSION_ID);
    const handler = handlers.get('session_save_info')!;

    await handler({ deliveryAddress: '123 Jalan Merdeka, Johor Bahru' });

    const data = getSessionData(SESSION_ID);
    expect(data.deliveryAddress).toBe('123 Jalan Merdeka, Johor Bahru');
  });

  it('delivery address survives cart clear', () => {
    saveSessionData(SESSION_ID, { deliveryAddress: '456 Taman Sentosa' });
    cartClear(SESSION_ID);

    const data = getSessionData(SESSION_ID);
    expect(data.deliveryAddress).toBe('456 Taman Sentosa');
  });

  it('system prompt shows delivery address with offer-as-default instruction', () => {
    const data: SessionData = { deliveryAddress: '789 Permas Jaya' };
    const prompt = formatSessionDataPrompt(data);
    expect(prompt).toContain('789 Permas Jaya');
    expect(prompt).toContain('offer as default');
  });
});

// ─── AC4: Auto-populated fields show saved value with edit option ──

describe('AC4: Session data shows saved values with edit option', () => {
  it('formatSessionDataPrompt returns empty string when no data', () => {
    const prompt = formatSessionDataPrompt({});
    expect(prompt).toBe('');
  });

  it('formatSessionDataPrompt includes all saved fields', () => {
    const data: SessionData = {
      customerName: 'Lim',
      tableNumber: '3',
      orderType: 'dine-in',
      deliveryAddress: '100 JB Central',
    };
    const prompt = formatSessionDataPrompt(data);
    expect(prompt).toContain('Lim');
    expect(prompt).toContain('Table Number: 3');
    expect(prompt).toContain('dine-in');
    expect(prompt).toContain('100 JB Central');
    expect(prompt).toContain('do NOT ask again');
  });

  it('session_save_info updates existing fields without losing others', async () => {
    const handlers = createCartHandlers(SESSION_ID);
    const handler = handlers.get('session_save_info')!;

    await handler({ customerName: 'Mei' });
    await handler({ tableNumber: '10' });

    const data = getSessionData(SESSION_ID);
    expect(data.customerName).toBe('Mei');
    expect(data.tableNumber).toBe('10');
  });

  it('session_save_info allows updating a previously saved field', async () => {
    const handlers = createCartHandlers(SESSION_ID);
    const handler = handlers.get('session_save_info')!;

    await handler({ customerName: 'Sarah' });
    await handler({ customerName: 'Sarah Lee' });

    const data = getSessionData(SESSION_ID);
    expect(data.customerName).toBe('Sarah Lee');
  });
});

// ─── AC5: Automated test — zero redundant entry violations ──────────

describe('AC5: No redundant entry in multi-order flow', () => {
  it('complete multi-order scenario: data persists across cart clears', async () => {
    const handlers = createCartHandlers(SESSION_ID);

    // Order 1: Guest provides name and table
    await handlers.get('session_save_info')!({ customerName: 'Ahmad' });
    await handlers.get('cart_set_table')!({ tableNumber: '5' });

    // Simulate order placed and cart cleared
    cartClear(SESSION_ID);

    // Order 2: Session data still available
    const data = getSessionData(SESSION_ID);
    expect(data.customerName).toBe('Ahmad');
    expect(data.tableNumber).toBe('5');
    expect(data.orderType).toBe('dine-in');

    // System prompt should show all saved data with no-reask instructions
    const prompt = formatSessionDataPrompt(data);
    expect(prompt).toContain('Ahmad');
    expect(prompt).toContain('5');
    expect(prompt).toContain('do NOT ask again');
    expect(prompt).not.toBe('');
  });

  it('session_save_info rejects empty input gracefully', async () => {
    const handlers = createCartHandlers(SESSION_ID);
    const handler = handlers.get('session_save_info')!;

    const result = await handler({});
    expect(result.content[0].text).toContain('No information provided');
  });

  it('clearSessionData removes all stored data', () => {
    saveSessionData(SESSION_ID, {
      customerName: 'Test',
      tableNumber: '1',
      orderType: 'dine-in',
      deliveryAddress: 'Addr',
    });
    clearSessionData(SESSION_ID);

    const data = getSessionData(SESSION_ID);
    expect(data.customerName).toBeUndefined();
    expect(data.tableNumber).toBeUndefined();
    expect(data.orderType).toBeUndefined();
    expect(data.deliveryAddress).toBeUndefined();
  });
});
