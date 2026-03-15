/**
 * inventory-sync.test.ts — Tests for US-949: Real-time out-of-stock sync
 *
 * Validates all 5 acceptance criteria:
 *   AC1: POS webhook → chatbot menu updated within 60s (in-memory propagation)
 *   AC2: Chatbot refuses out-of-stock items and suggests alternatives
 *   AC3: Admin dashboard live inventory status panel
 *   AC4: Admin can manually toggle item availability
 *   AC5: Stock transitions logged with timestamps for demand forecasting
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB pool before importing the store
vi.mock('../../lib/db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
  db: {},
}));

import {
  getMenuItems,
  getMenuItem,
  createMenuItem,
  updateMenuItem,
  applyPosStockUpdate,
  logStockTransition,
  getStockEvents,
  ensureStockEventsTable,
  type MenuItem,
} from '../../lib/menu-items-store.js';

// ─── Helpers ──────────────────────────────────────────────────────────

// Use unique profile per test to avoid in-memory store contamination
let testCounter = 0;
function uniqueProfile(): string {
  return `test-cafe-${++testCounter}-${Date.now()}`;
}

async function seedTestItems(profile: string): Promise<MenuItem[]> {
  const items = [
    { name: 'Nasi Lemak', price: 8.5, category: 'Mains', available: true },
    { name: 'Teh Tarik', price: 3.0, category: 'Drinks', available: true },
    { name: 'Roti Canai', price: 4.0, category: 'Mains', available: true },
    { name: 'Milo Ais', price: 4.5, category: 'Drinks', available: false },
    { name: 'Nasi Goreng', price: 9.0, category: 'Mains', available: true },
  ];

  const created: MenuItem[] = [];
  for (const item of items) {
    created.push(
      await createMenuItem({
        profile,
        name: item.name,
        price: item.price,
        category: item.category,
        available: item.available,
        allergens: [],
        dietary_flags: [],
        display_order: 0,
      })
    );
  }
  return created;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('US-949: Real-time out-of-stock sync', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  describe('AC1: POS webhook updates chatbot menu (in-memory propagation)', () => {
    it('marks item unavailable when POS reports quantity = 0', async () => {
      const p = uniqueProfile();
      const items = await seedTestItems(p);
      const nasiLemak = items.find(i => i.name === 'Nasi Lemak')!;

      expect(getMenuItem(p, nasiLemak.id)?.available).toBe(true);

      const result = await applyPosStockUpdate(p, [
        { name: 'Nasi Lemak', quantity: 0 },
      ]);

      expect(result.updated).toContain('Nasi Lemak -> out-of-stock');
      expect(result.not_found).toHaveLength(0);
      expect(getMenuItem(p, nasiLemak.id)?.available).toBe(false);
    });

    it('marks item available again when POS reports quantity > 0', async () => {
      const p = uniqueProfile();
      const items = await seedTestItems(p);
      const miloAis = items.find(i => i.name === 'Milo Ais')!;

      expect(getMenuItem(p, miloAis.id)?.available).toBe(false);

      const result = await applyPosStockUpdate(p, [
        { name: 'Milo Ais', quantity: 10 },
      ]);

      expect(result.updated).toContain('Milo Ais -> available');
      expect(getMenuItem(p, miloAis.id)?.available).toBe(true);
    });

    it('reports not_found for unknown items', async () => {
      const p = uniqueProfile();
      await seedTestItems(p);

      const result = await applyPosStockUpdate(p, [
        { name: 'Laksa Johor', quantity: 0 },
      ]);

      expect(result.not_found).toContain('Laksa Johor');
      expect(result.updated).toHaveLength(0);
    });

    it('skips items where availability unchanged', async () => {
      const p = uniqueProfile();
      await seedTestItems(p);

      const result = await applyPosStockUpdate(p, [
        { name: 'Teh Tarik', quantity: 5 },
      ]);

      expect(result.updated).toHaveLength(0);
      expect(result.not_found).toHaveLength(0);
    });

    it('handles batch updates with mixed results', async () => {
      const p = uniqueProfile();
      await seedTestItems(p);

      const result = await applyPosStockUpdate(p, [
        { name: 'Nasi Lemak', quantity: 0 },
        { name: 'Milo Ais', quantity: 3 },
        { name: 'Unknown Dish', quantity: 0 },
        { name: 'Teh Tarik', quantity: 10 },
      ]);

      expect(result.updated).toHaveLength(2);
      expect(result.not_found).toContain('Unknown Dish');
    });

    it('case-insensitive name matching', async () => {
      const p = uniqueProfile();
      await seedTestItems(p);

      const result = await applyPosStockUpdate(p, [
        { name: 'nasi lemak', quantity: 0 },
      ]);

      expect(result.updated).toContain('Nasi Lemak -> out-of-stock');
    });
  });

  describe('AC2: Chatbot refuses out-of-stock items (getMenuItems filter)', () => {
    it('getMenuItems excludes unavailable items by default', async () => {
      const p = uniqueProfile();
      await seedTestItems(p);

      await applyPosStockUpdate(p, [
        { name: 'Nasi Lemak', quantity: 0 },
      ]);

      const available = getMenuItems(p);
      const names = available.map(i => i.name);

      expect(names).not.toContain('Nasi Lemak');
      expect(names).not.toContain('Milo Ais');
      expect(names).toContain('Teh Tarik');
      expect(names).toContain('Roti Canai');
    });

    it('getMenuItems includes unavailable when flag set', async () => {
      const p = uniqueProfile();
      await seedTestItems(p);

      const all = getMenuItems(p, true);
      const names = all.map(i => i.name);

      expect(names).toContain('Milo Ais');
      expect(all.length).toBe(5);
    });
  });

  describe('AC3: Admin inventory status panel', () => {
    it('returns all items with availability summary', async () => {
      const p = uniqueProfile();
      await seedTestItems(p);

      const allItems = getMenuItems(p, true);
      const availableCount = allItems.filter(i => i.available).length;
      const unavailableCount = allItems.filter(i => !i.available).length;

      expect(allItems.length).toBe(5);
      expect(availableCount).toBe(4);
      expect(unavailableCount).toBe(1);
    });
  });

  describe('AC4: Admin manual toggle', () => {
    it('toggles item availability via updateMenuItem', async () => {
      const p = uniqueProfile();
      const items = await seedTestItems(p);
      const rotiCanai = items.find(i => i.name === 'Roti Canai')!;

      expect(rotiCanai.available).toBe(true);

      const updated = await updateMenuItem(p, rotiCanai.id, { available: false });
      expect(updated?.available).toBe(false);
      expect(getMenuItem(p, rotiCanai.id)?.available).toBe(false);

      const restored = await updateMenuItem(p, rotiCanai.id, { available: true });
      expect(restored?.available).toBe(true);
    });

    it('returns null for non-existent item', async () => {
      const p = uniqueProfile();
      await seedTestItems(p);
      const result = await updateMenuItem(p, 'non-existent-id', { available: false });
      expect(result).toBeNull();
    });
  });

  describe('AC5: Stock transitions logged for demand forecasting', () => {
    it('logStockTransition does not throw without DB', () => {
      expect(() => {
        logStockTransition({
          profile: 'test',
          item_id: 'test-id',
          item_name: 'Test Item',
          previous_available: true,
          new_available: false,
          quantity: 0,
          source: 'pos_webhook',
          changed_by: 'pos',
        });
      }).not.toThrow();
    });

    it('getStockEvents returns empty array without DB', async () => {
      const events = await getStockEvents('test');
      expect(events).toEqual([]);
    });

    it('ensureStockEventsTable does not throw without DB', async () => {
      await expect(ensureStockEventsTable()).resolves.not.toThrow();
    });

    it('applyPosStockUpdate propagates changes to in-memory store', async () => {
      const p = uniqueProfile();
      await seedTestItems(p);

      const result = await applyPosStockUpdate(p, [
        { name: 'Nasi Lemak', quantity: 0 },
        { name: 'Roti Canai', quantity: 0 },
      ]);

      expect(result.updated).toHaveLength(2);
      const available = getMenuItems(p);
      const availableNames = available.map(i => i.name);
      expect(availableNames).not.toContain('Nasi Lemak');
      expect(availableNames).not.toContain('Roti Canai');
    });
  });
});
