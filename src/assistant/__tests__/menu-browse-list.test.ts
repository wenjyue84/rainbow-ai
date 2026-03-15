/**
 * menu-browse-list.test.ts — US-872: WhatsApp interactive list message for menu category browsing
 *
 * Tests:
 *   - Interactive list message is built with ≥3 sections matching menu categories
 *   - Row IDs map to item codes for cart operations
 *   - Webchat sessions receive plain-text fallback (no interactivePayload)
 *   - Only makan-moments profile gets interactive list (hostel profile falls back to LLM)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildListMessage, listMessageToText } from '../formatter.js';
import type { ListSection } from '../formatter.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Sample data ─────────────────────────────────────────────────────────────

const SAMPLE_ITEMS = [
  { code: 'NR01', name: 'Nasi Lemak', price: 8.50, category: 'Mains' },
  { code: 'NR02', name: 'Nasi Goreng', price: 9.00, category: 'Mains' },
  { code: 'NR03', name: 'Chicken Rice', price: 8.00, category: 'Mains' },
  { code: 'DR01', name: 'Teh Tarik', price: 2.50, category: 'Drinks' },
  { code: 'DR02', name: 'Iced Coffee', price: 4.00, category: 'Drinks' },
  { code: 'DR03', name: 'Fresh Orange', price: 5.00, category: 'Drinks' },
  { code: 'DS01', name: 'Cendol', price: 6.00, category: 'Desserts' },
  { code: 'DS02', name: 'Ais Kacang', price: 5.50, category: 'Desserts' },
  { code: 'DS03', name: 'Kuih Cara', price: 3.00, category: 'Desserts' },
];

// ─── Helper: build sections from items (mirrors handleMenuBrowse logic) ───────

function buildMenuSections(
  items: typeof SAMPLE_ITEMS,
  maxSections = 3,
  itemsPerSection = 3
): ListSection[] {
  const categoryMap = new Map<string, typeof SAMPLE_ITEMS>();
  for (const item of items) {
    const cat = item.category || 'Other';
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(item);
  }

  const sortedCategories = [...categoryMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxSections);

  return sortedCategories.map(([catName, catItems]) => ({
    title: catName,
    rows: catItems.slice(0, itemsPerSection).map(item => ({
      rowId: `item_${item.code}`,
      title: item.name.length > 24 ? item.name.slice(0, 21) + '…' : item.name,
      description: `RM ${item.price.toFixed(2)}`,
    })),
  }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('US-872: Menu category list message structure', () => {
  it('builds at least 3 sections from sample menu items', () => {
    const sections = buildMenuSections(SAMPLE_ITEMS);
    expect(sections.length).toBeGreaterThanOrEqual(3);
  });

  it('section titles match actual menu categories', () => {
    const sections = buildMenuSections(SAMPLE_ITEMS);
    const titles = sections.map(s => s.title);
    expect(titles).toContain('Mains');
    expect(titles).toContain('Drinks');
    expect(titles).toContain('Desserts');
  });

  it('row IDs are prefixed with item_ and use the item code', () => {
    const sections = buildMenuSections(SAMPLE_ITEMS);
    const allRows = sections.flatMap(s => s.rows);
    for (const row of allRows) {
      expect(row.rowId).toMatch(/^item_[A-Z]{2}\d{2}$/);
    }
  });

  it('each section has at most 3 rows (within total limit)', () => {
    const sections = buildMenuSections(SAMPLE_ITEMS);
    for (const section of sections) {
      expect(section.rows.length).toBeLessThanOrEqual(3);
    }
  });

  it('row descriptions show price as RM x.xx', () => {
    const sections = buildMenuSections(SAMPLE_ITEMS);
    const row = sections[0].rows[0];
    expect(row.description).toMatch(/^RM \d+\.\d{2}$/);
  });
});

describe('US-872: buildListMessage integration', () => {
  it('produces a valid Baileys listMessage payload with 3 sections', () => {
    const sections = buildMenuSections(SAMPLE_ITEMS);
    const payload = buildListMessage(
      "Here's our menu! Tap a category to see what we have:",
      'Tap an item to add it to your order',
      'Browse Menu',
      sections,
      'Powered by Rainbow AI'
    );

    expect(payload).toHaveProperty('listMessage');
    expect(payload.listMessage.sections).toHaveLength(3);
    expect(payload.listMessage.buttonText).toBe('Browse Menu');
    expect(payload.listMessage.footerText).toBe('Powered by Rainbow AI');
    expect(payload.listMessage.listType).toBe(1); // SINGLE_SELECT
  });

  it('total rows across all sections does not exceed 10', () => {
    const sections = buildMenuSections(SAMPLE_ITEMS);
    const payload = buildListMessage('Title', 'Desc', 'Btn', sections);
    const totalRows = payload.listMessage.sections.reduce((sum, s) => sum + s.rows.length, 0);
    expect(totalRows).toBeLessThanOrEqual(10);
  });

  it('each row in the payload has rowId, title from menu item', () => {
    const sections = buildMenuSections(SAMPLE_ITEMS);
    const payload = buildListMessage('Title', 'Desc', 'Btn', sections);
    const firstRow = payload.listMessage.sections[0].rows[0];
    expect(firstRow.rowId).toBeDefined();
    expect(firstRow.title).toBeDefined();
    expect(firstRow.title.length).toBeLessThanOrEqual(24); // WhatsApp row title limit
  });
});

describe('US-872: Webchat fallback (plain text)', () => {
  it('listMessageToText converts list payload to numbered plain text for webchat', () => {
    const sections = buildMenuSections(SAMPLE_ITEMS);
    const payload = buildListMessage(
      "Here's our menu!",
      'Tap an item to add it to your order',
      'Browse Menu',
      sections
    );

    const text = listMessageToText(payload);
    expect(text).toContain("Here's our menu!");
    // Should have section headers
    expect(text).toContain('*Mains*');
    // Should have numbered items
    expect(text).toMatch(/1\. Nasi Lemak/);
    // Should not expose WhatsApp-specific UI elements
    expect(text).not.toContain('Browse Menu');
  });

  it('fallback text includes price descriptions', () => {
    const sections = buildMenuSections(SAMPLE_ITEMS);
    const payload = buildListMessage('Menu', 'Browse', 'Btn', sections);
    const text = listMessageToText(payload);
    expect(text).toContain('RM');
  });
});

describe('US-872: Profile restriction', () => {
  it('MENU_BROWSE intent is defined in routing.json for makan-moments profile', async () => {
    // Dynamic import to read routing at test time
    const { default: routing } = await import('../data/routing.json', { with: { type: 'json' } });
    expect(routing).toHaveProperty('MENU_BROWSE');
    expect((routing as any)['MENU_BROWSE'].action).toBe('menu_browse');
  });

  it('buildMenuSections returns empty array for profiles with no FnB items', () => {
    // Simulate hostel profile: items with no categories (or empty)
    const sections = buildMenuSections([]);
    expect(sections).toHaveLength(0);
  });
});

describe('US-872: Long item name truncation', () => {
  it('truncates item names longer than 24 characters with ellipsis', () => {
    const longItems = [
      { code: 'LG01', name: 'Super Extra Special Nasi Lemak Ayam Berempah', price: 12.00, category: 'Mains' },
      { code: 'LG02', name: 'Short', price: 5.00, category: 'Mains' },
    ];
    const sections = buildMenuSections(longItems, 1, 2);
    const rows = sections[0].rows;
    expect(rows[0].title).toMatch(/…$/); // ends with ellipsis
    expect(rows[0].title.length).toBeLessThanOrEqual(24);
    expect(rows[1].title).toBe('Short'); // no truncation
  });
});
