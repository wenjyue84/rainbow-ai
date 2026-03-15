/**
 * US-885: WhatsApp product catalog single-item card for item detail showcase
 *
 * Tests for:
 *   - buildProductCardText: formats item details as WhatsApp-styled text
 *   - buildProductCardButtons: builds interactive button payload
 *   - productCardToText: plain text fallback with add-to-cart hint
 *   - extractItemName: strips question prefixes from user messages
 *   - parseItemDetail: parses FnB MCP response into structured data
 */
import { describe, it, expect } from 'vitest';
import {
  buildProductCardText,
  buildProductCardButtons,
  productCardToText,
  type ProductCardItem,
} from '../formatter.js';

// ── Test Data ───────────────────────────────────────────────────────────

const fullItem: ProductCardItem = {
  name: 'Nasi Lemak Special',
  code: 'NR01',
  price: 12.5,
  description: 'Fragrant coconut rice served with sambal, peanuts, anchovies, egg, and rendang',
  category: 'Mains',
  dietary_flags: ['halal'],
  allergens: ['peanuts', 'eggs'],
};

const minimalItem: ProductCardItem = {
  name: 'Teh Tarik',
  price: 3.5,
};

const noCodeItem: ProductCardItem = {
  name: 'Chef Special Curry',
  price: 15.0,
  description: 'Daily chef special with seasonal ingredients',
  category: 'Specials',
};

// ── buildProductCardText ────────────────────────────────────────────────

describe('buildProductCardText', () => {
  it('formats a full item with all fields (EN)', () => {
    const text = buildProductCardText(fullItem, 'en');

    expect(text).toContain('*Nasi Lemak Special*');
    expect(text).toContain('_Code: NR01_');
    expect(text).toContain('Price: *RM 12.50*');
    expect(text).toContain('Category: Mains');
    expect(text).toContain('Fragrant coconut rice');
    expect(text).toContain('Dietary: halal');
    expect(text).toContain('Allergens: peanuts, eggs');
  });

  it('formats a minimal item without optional fields', () => {
    const text = buildProductCardText(minimalItem, 'en');

    expect(text).toContain('*Teh Tarik*');
    expect(text).toContain('Price: *RM 3.50*');
    expect(text).not.toContain('Code:');
    expect(text).not.toContain('Category:');
    expect(text).not.toContain('Dietary:');
    expect(text).not.toContain('Allergens:');
  });

  it('formats in Malay (ms)', () => {
    const text = buildProductCardText(fullItem, 'ms');

    expect(text).toContain('Harga: *RM 12.50*');
    expect(text).toContain('Kategori: Mains');
    expect(text).toContain('Diet: halal');
    expect(text).toContain('Alergen: peanuts, eggs');
  });

  it('formats in Chinese (zh)', () => {
    const text = buildProductCardText(fullItem, 'zh');

    expect(text).toContain('价格: *RM 12.50*');
    expect(text).toContain('类别: Mains');
    expect(text).toContain('饮食: halal');
    expect(text).toContain('过敏原: peanuts, eggs');
  });

  it('omits description when not provided', () => {
    const text = buildProductCardText(minimalItem, 'en');
    // Should just have name and price, no empty lines between
    const lines = text.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(2); // name + price
  });
});

// ── buildProductCardButtons ─────────────────────────────────────────────

describe('buildProductCardButtons', () => {
  it('creates a valid Baileys buttonsMessage payload', () => {
    const payload = buildProductCardButtons(fullItem, 'en');

    expect(payload).toHaveProperty('buttonsMessage');
    const bm = payload.buttonsMessage;

    // Body should contain the item text
    expect(bm.text).toContain('*Nasi Lemak Special*');
    expect(bm.text).toContain('Price: *RM 12.50*');

    // Should have exactly 2 buttons
    expect(bm.buttons).toHaveLength(2);

    // First button: "Add to cart"
    expect(bm.buttons[0].buttonId).toBe('add_to_cart:NR01');
    expect(bm.buttons[0].buttonText.displayText).toBe('Add to cart');

    // Second button: "View full menu"
    expect(bm.buttons[1].buttonId).toBe('view_menu');
    expect(bm.buttons[1].buttonText.displayText).toBe('View full menu');
  });

  it('uses item name in button ID when no code', () => {
    const payload = buildProductCardButtons(noCodeItem, 'en');
    expect(payload.buttonsMessage.buttons[0].buttonId).toBe('add_to_cart:Chef Special Curry');
  });

  it('uses Malay button labels', () => {
    const payload = buildProductCardButtons(fullItem, 'ms');
    expect(payload.buttonsMessage.buttons[0].buttonText.displayText).toBe('Tambah ke troli');
    expect(payload.buttonsMessage.buttons[1].buttonText.displayText).toBe('Lihat menu penuh');
  });

  it('uses Chinese button labels', () => {
    const payload = buildProductCardButtons(fullItem, 'zh');
    expect(payload.buttonsMessage.buttons[0].buttonText.displayText).toBe('加入购物车');
    expect(payload.buttonsMessage.buttons[1].buttonText.displayText).toBe('查看完整菜单');
  });
});

// ── productCardToText ───────────────────────────────────────────────────

describe('productCardToText', () => {
  it('includes item details and add-to-cart hint (EN)', () => {
    const text = productCardToText(fullItem, 'en');

    expect(text).toContain('*Nasi Lemak Special*');
    expect(text).toContain('RM 12.50');
    expect(text).toContain('Reply "add to cart"');
  });

  it('includes Malay add-to-cart hint', () => {
    const text = productCardToText(fullItem, 'ms');
    expect(text).toContain('Balas "tambah ke troli"');
  });

  it('includes Chinese add-to-cart hint', () => {
    const text = productCardToText(fullItem, 'zh');
    expect(text).toContain('回复\u201C加入购物车\u201D');
  });
});

// ── extractItemName (imported indirectly via action-dispatch, test the logic) ──

describe('extractItemName logic', () => {
  // Test the extraction patterns directly
  function extractItemName(text: string): string | null {
    const stripped = text
      .replace(/\b(tell\s+me\s+(more\s+)?about|what\s+is\s+(the\s+)?|what's\s+(the\s+)?|describe\s+(the\s+)?|info\s+(on|about)\s+(the\s+)?|details?\s+(of|on|about|for)\s+(the\s+)?|how\s+is\s+(the\s+)?|is\s+the\s+|what\s+(comes?|does\s+it)\s+(with|include)\s+|ingredients?\s+(of|in)\s+(the\s+)?)/gi, '')
      .replace(/\b(apa\s+(itu|tu)\s+|ceritakan\s+(tentang\s+)?|maklumat\s+(tentang|pasal)\s+|lebih\s+lanjut\s+tentang\s+|sedap\s+tak\s+)/gi, '')
      .replace(/(介绍|什么是|告诉我|这个怎么样|有什么|里面有什么)/g, '')
      .replace(/[?？。.!！]+$/g, '')
      .trim();
    return stripped.length >= 2 ? stripped : null;
  }

  it('extracts item from "tell me about the nasi lemak"', () => {
    // "the" remains since it's not part of the prefix pattern — fuzzy match handles it
    expect(extractItemName('tell me about the nasi lemak')).toBe('the nasi lemak');
  });

  it('extracts item from "tell me more about nasi goreng"', () => {
    expect(extractItemName('tell me more about nasi goreng')).toBe('nasi goreng');
  });

  it('extracts item from "what is the teh tarik"', () => {
    expect(extractItemName('what is the teh tarik')).toBe('teh tarik');
  });

  it('extracts item from "describe the chicken chop"', () => {
    expect(extractItemName('describe the chicken chop')).toBe('chicken chop');
  });

  it('extracts item from "how is the mee goreng?"', () => {
    expect(extractItemName('how is the mee goreng?')).toBe('mee goreng');
  });

  it('extracts item from Malay "apa itu roti canai"', () => {
    expect(extractItemName('apa itu roti canai')).toBe('roti canai');
  });

  it('extracts item from Chinese "介绍鸡饭"', () => {
    expect(extractItemName('介绍鸡饭')).toBe('鸡饭');
  });

  it('returns null for too-short queries', () => {
    expect(extractItemName('what is a')).toBeNull();
  });

  it('strips trailing punctuation', () => {
    expect(extractItemName('what is the nasi lemak?')).toBe('nasi lemak');
    expect(extractItemName('tell me about laksa!')).toBe('laksa');
  });
});

// ── parseItemDetail ─────────────────────────────────────────────────────

describe('parseItemDetail logic', () => {
  function parseItemDetail(text: string): Partial<ProductCardItem> | null {
    if (!text || text.trim().length === 0) return null;
    const result: Partial<ProductCardItem> = {};
    const lines = text.split('\n').filter(l => l.trim());
    const descLines: string[] = [];
    for (const line of lines) {
      if (/^(code|price|category|allergen|dietary|RM\s)/i.test(line.trim())) continue;
      if (/^[\*_]*(code|price|category|allergen|dietary)/i.test(line.trim())) continue;
      descLines.push(line.trim());
      if (descLines.length >= 3) break;
    }
    if (descLines.length > 0) result.description = descLines.join('\n');
    const allergenMatch = text.match(/allergens?:?\s*(.+)/i);
    if (allergenMatch) {
      const allergens = allergenMatch[1].split(/[,;]/).map(a => a.trim()).filter(Boolean);
      if (allergens.length > 0) result.allergens = allergens;
    }
    const dietaryMatch = text.match(/dietary[_ ]?flags?:?\s*(.+)/i);
    if (dietaryMatch) {
      const flags = dietaryMatch[1].split(/[,;]/).map(f => f.trim()).filter(Boolean);
      if (flags.length > 0) result.dietary_flags = flags;
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  it('extracts description from plain text', () => {
    const result = parseItemDetail('Nasi Lemak Special\nFragrant coconut rice with sambal');
    expect(result).not.toBeNull();
    expect(result!.description).toContain('Nasi Lemak Special');
    expect(result!.description).toContain('Fragrant coconut rice');
  });

  it('extracts allergens from response text', () => {
    const result = parseItemDetail('Nasi Lemak\nAllergens: peanuts, eggs, shellfish');
    expect(result).not.toBeNull();
    expect(result!.allergens).toEqual(['peanuts', 'eggs', 'shellfish']);
  });

  it('extracts dietary flags from response text', () => {
    const result = parseItemDetail('Nasi Lemak\nDietary flags: halal, no-pork');
    expect(result).not.toBeNull();
    expect(result!.dietary_flags).toEqual(['halal', 'no-pork']);
  });

  it('skips metadata lines in description', () => {
    const result = parseItemDetail('Code: NR01\nPrice: RM 12.50\nFragrant coconut rice');
    expect(result).not.toBeNull();
    expect(result!.description).toBe('Fragrant coconut rice');
    expect(result!.description).not.toContain('Code');
    expect(result!.description).not.toContain('Price');
  });

  it('returns null for empty text', () => {
    expect(parseItemDetail('')).toBeNull();
    expect(parseItemDetail('  ')).toBeNull();
  });
});

// ── US-885: Button press ID patterns (state-executor interception) ────────

describe('add_to_cart button ID parsing', () => {
  it('matches add_to_cart:CODE pattern', () => {
    const match = 'add_to_cart:NR01'.match(/^add_to_cart:(.+)$/i);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('NR01');
  });

  it('matches add_to_cart with item name when code absent', () => {
    const match = 'add_to_cart:Chef Special Curry'.match(/^add_to_cart:(.+)$/i);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('Chef Special Curry');
  });

  it('is case insensitive', () => {
    const match = 'Add_To_Cart:RC01'.match(/^add_to_cart:(.+)$/i);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('RC01');
  });

  it('does not match plain "add to cart" text', () => {
    const match = 'I want to add to cart'.match(/^add_to_cart:(.+)$/i);
    expect(match).toBeNull();
  });

  it('does not match empty code', () => {
    const match = 'add_to_cart:'.match(/^add_to_cart:(.+)$/i);
    expect(match).toBeNull();
  });
});

describe('view_menu button ID matching', () => {
  it('matches exact "view_menu" button ID', () => {
    expect(/^view_menu$/i.test('view_menu')).toBe(true);
  });

  it('matches "View full menu" display text', () => {
    expect(/^view full menu$/i.test('View full menu')).toBe(true);
  });

  it('does not match embedded text', () => {
    expect(/^view_menu$/i.test('please view_menu')).toBe(false);
  });
});
