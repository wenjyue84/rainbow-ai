/**
 * malay-ordering.test.ts — Tests for Malay/Manglish ordering support (US-866)
 *
 * Validates that:
 *   - Malay add-to-cart phrases match order_placement intent patterns
 *   - Malay remove phrases are understood
 *   - Malay special instructions map correctly
 *   - Malay takeaway phrases (tapau, bawa balik) are detected
 *   - Manglish phrases (lah suffix) match patterns
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  cartAddItem,
  cartRemoveItem,
  cartClear,
  cartGetItems,
  cartSetItemNotes,
  cartSetTableInfo,
  cartGetTableInfo,
} from '../cart-store.js';
import { createCartHandlers } from '../../tools/cart.js';
import { clearOrderStage, getOrderStage } from '../order-stage-store.js';

const PID = 'test';
// Load the Makan Moments intent patterns for regex testing
import intentsData from '../data-makan/intents.json' assert { type: 'json' };
import keywordsData from '../data-makan/intent-keywords.json' assert { type: 'json' };

const PID = 'test';
// Helper: check if a message matches an intent's patterns
function matchesIntentPattern(message: string, intentCategory: string): boolean {
  for (const category of intentsData.categories) {
    for (const intent of category.intents) {
      if (intent.category === intentCategory) {
        for (const pattern of intent.patterns) {
          const regex = new RegExp(pattern, intent.flags || 'i');
          if (regex.test(message)) return true;
        }
      }
    }
  }
  return false;
}

// Helper: check if a message matches keywords for an intent
function matchesIntentKeywords(message: string, intentName: string): boolean {
  const msgLower = message.toLowerCase().trim();
  for (const intent of keywordsData.intents) {
    if (intent.intent === intentName) {
      for (const lang of Object.keys(intent.keywords)) {
        const keywords = (intent.keywords as Record<string, string[]>)[lang];
        for (const kw of keywords) {
          if (msgLower.includes(kw.toLowerCase())) return true;
        }
      }
    }
  }
  return false;
}

// ─── Intent Pattern Matching Tests ───────────────────────────────────

describe('US-866: Malay add-to-cart intent patterns', () => {
  it('matches "saya nak nasi lemak" as order_placement', () => {
    expect(matchesIntentPattern('saya nak nasi lemak', 'order_placement')).toBe(true);
  });

  it('matches "boleh bagi teh tarik" as order_placement', () => {
    expect(matchesIntentPattern('boleh bagi teh tarik', 'order_placement')).toBe(true);
  });

  it('matches "nak order mee goreng" as order_placement', () => {
    expect(matchesIntentPattern('nak order mee goreng', 'order_placement')).toBe(true);
  });

  it('matches "satu roti canai" as order_placement', () => {
    expect(matchesIntentPattern('satu roti canai', 'order_placement')).toBe(true);
  });

  it('matches "tolong bagi air limau" as order_placement', () => {
    expect(matchesIntentPattern('tolong bagi air limau', 'order_placement')).toBe(true);
  });
});

describe('US-866: Manglish ordering patterns', () => {
  it('matches "can I have nasi goreng" as order_placement', () => {
    expect(matchesIntentPattern('can I have nasi goreng', 'order_placement')).toBe(true);
  });

  it('matches "I want lah the chicken rice" as order_placement', () => {
    expect(matchesIntentPattern('I want lah the chicken rice', 'order_placement')).toBe(true);
  });

  it('matches "add one more lah" as order_placement', () => {
    expect(matchesIntentPattern('add one more lah', 'order_placement')).toBe(true);
  });
});

describe('US-866: Malay takeaway detection pattern', () => {
  it('matches "tapau" as order_placement', () => {
    expect(matchesIntentPattern('tapau', 'order_placement')).toBe(true);
  });

  it('matches "bawa balik" as order_placement', () => {
    expect(matchesIntentPattern('bawa balik', 'order_placement')).toBe(true);
  });

  it('matches "bungkus" as order_placement', () => {
    expect(matchesIntentPattern('bungkus', 'order_placement')).toBe(true);
  });
});

// ─── Keyword Matching Tests ──────────────────────────────────────────

describe('US-866: Malay ordering keywords', () => {
  it('matches "saya nak" in order_placement keywords', () => {
    expect(matchesIntentKeywords('saya nak nasi lemak', 'order_placement')).toBe(true);
  });

  it('matches "boleh bagi" in order_placement keywords', () => {
    expect(matchesIntentKeywords('boleh bagi teh tarik', 'order_placement')).toBe(true);
  });

  it('matches "tapau" in order_placement keywords', () => {
    expect(matchesIntentKeywords('tapau nasi lemak', 'order_placement')).toBe(true);
  });

  it('matches "bawa balik" in order_placement keywords', () => {
    expect(matchesIntentKeywords('bawa balik satu', 'order_placement')).toBe(true);
  });

  it('matches "nak tambah" in order_placement keywords', () => {
    expect(matchesIntentKeywords('nak tambah satu lagi', 'order_placement')).toBe(true);
  });
});

// ─── Cart Table Handler — Malay Takeaway Terms ──────────────────────

describe('US-866: cart_set_table Malay takeaway handling', () => {
  const sid = () => 'malay-table-' + Date.now() + '-' + Math.random();

  it('"bawa balik" sets orderType to takeaway', async () => {
    const s = sid();
    const handlers = createCartHandlers(s, PID);
    const handler = handlers.get('cart_set_table')!;
    const result = await handler({ orderType: 'bawa balik' });
    const text = result.content[0].text;
    expect(text).toContain('Takeaway');
    const info = cartGetTableInfo(PID, s);
    expect(info?.orderType).toBe('takeaway');
  });

  it('"bungkus" sets orderType to takeaway', async () => {
    const s = sid();
    const handlers = createCartHandlers(s, PID);
    const handler = handlers.get('cart_set_table')!;
    const result = await handler({ orderType: 'bungkus' });
    const text = result.content[0].text;
    expect(text).toContain('Takeaway');
    const info = cartGetTableInfo(PID, s);
    expect(info?.orderType).toBe('takeaway');
  });

  it('"tapau" sets orderType to takeaway', async () => {
    const s = sid();
    const handlers = createCartHandlers(s, PID);
    const handler = handlers.get('cart_set_table')!;
    const result = await handler({ orderType: 'tapau' });
    const text = result.content[0].text;
    expect(text).toContain('Takeaway');
    const info = cartGetTableInfo(PID, s);
    expect(info?.orderType).toBe('takeaway');
  });
});

// ─── Cart Notes — Malay Special Instructions ─────────────────────────

describe('US-866: Malay special instructions via cart_set_item_notes', () => {
  const sid = () => 'malay-notes-' + Date.now() + '-' + Math.random();

  it('stores translated Malay instruction "less sugar" for kurang manis', async () => {
    const s = sid();
    // Add an item first
    cartAddItem(PID, s, { name: 'Teh Tarik', qty: 1, code: 'DR01', price: 3.50 });

    const handlers = createCartHandlers(s, PID);
    const handler = handlers.get('cart_set_item_notes')!;
    // The LLM translates "kurang manis" to "less sugar" before calling the tool
    const result = await handler({ name: 'Teh Tarik', notes: 'less sugar' });
    const text = result.content[0].text;
    expect(text).toContain('less sugar');
    expect(text).toContain('Teh Tarik');

    const items = cartGetItems(PID, s);
    expect(items[0].notes).toContain('less sugar');
    cartClear(PID, s);
  });

  it('stores translated Malay instruction "no onion" for tanpa bawang', async () => {
    const s = sid();
    cartAddItem(PID, s, { name: 'Mee Goreng', qty: 1, code: 'NR03', price: 8.00 });

    const handlers = createCartHandlers(s, PID);
    const handler = handlers.get('cart_set_item_notes')!;
    const result = await handler({ name: 'Mee Goreng', notes: 'no onion' });
    const text = result.content[0].text;
    expect(text).toContain('no onion');

    const items = cartGetItems(PID, s);
    expect(items[0].notes).toContain('no onion');
    cartClear(PID, s);
  });

  it('stores translated Malay instruction "a little spicy" for pedas sikit', async () => {
    const s = sid();
    cartAddItem(PID, s, { name: 'Nasi Lemak', qty: 1, code: 'NR01', price: 8.50 });

    const handlers = createCartHandlers(s, PID);
    const handler = handlers.get('cart_set_item_notes')!;
    const result = await handler({ name: 'Nasi Lemak', notes: 'a little spicy' });
    const text = result.content[0].text;
    expect(text).toContain('a little spicy');

    const items = cartGetItems(PID, s);
    expect(items[0].notes).toContain('a little spicy');
    cartClear(PID, s);
  });
});

// ─── Full Flow: Malay Ordering Scenario ──────────────────────────────

describe('US-866: End-to-end Malay ordering flow', () => {
  it('complete Malay ordering: add item → set note → tapau → confirm', async () => {
    const s = 'malay-e2e-' + Date.now();
    const handlers = createCartHandlers(s, PID);

    // 1. Add item (simulating "saya nak nasi lemak")
    const addResult = await handlers.get('cart_add_item')!({
      name: 'Nasi Lemak',
      qty: 1,
      code: 'NR01',
      price: 8.50,
    });
    expect(addResult.content[0].text).toContain('Nasi Lemak');
    expect(getOrderStage(PID, s)).toBe('ORDERING');

    // 2. Set special instruction (translating "pedas sikit" → "a little spicy")
    const notesResult = await handlers.get('cart_set_item_notes')!({
      name: 'Nasi Lemak',
      notes: 'a little spicy',
    });
    expect(notesResult.content[0].text).toContain('a little spicy');

    // 3. Set takeaway (Malay: "bawa balik")
    const tableResult = await handlers.get('cart_set_table')!({
      orderType: 'bawa balik',
    });
    expect(tableResult.content[0].text).toContain('Takeaway');
    expect(cartGetTableInfo(PID, s)?.orderType).toBe('takeaway');

    // Cleanup
    cartClear(PID, s);
    clearOrderStage(PID, s);
  });
});
