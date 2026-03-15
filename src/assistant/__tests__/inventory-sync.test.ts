/**
 * US-949: Inventory sync tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mutable item store — reset before each test
const createItems = () => new Map<string, any>([
  ['item-1', {
    id: 'item-1', profile: 'makan-moments', name: 'Nasi Lemak',
    description: 'Coconut rice', price: 8.5, category: 'Rice',
    allergens: [], dietary_flags: [], available: true,
    display_order: 1, created_at: '2026-01-01', updated_at: '2026-01-01',
  }],
  ['item-2', {
    id: 'item-2', profile: 'makan-moments', name: 'Roti Canai',
    description: 'Flatbread', price: 3.0, category: 'Bread',
    allergens: [], dietary_flags: [], available: true,
    display_order: 2, created_at: '2026-01-01', updated_at: '2026-01-01',
  }],
  ['item-3', {
    id: 'item-3', profile: 'makan-moments', name: 'Mee Goreng',
    description: 'Fried noodles', price: 7.0, category: 'Rice',
    allergens: [], dietary_flags: [], available: false,
    display_order: 3, created_at: '2026-01-01', updated_at: '2026-01-01',
  }],
]);

let items = createItems();

vi.mock('../../lib/db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  dbReady: Promise.resolve(false),
}));

vi.mock('../../lib/menu-items-store.js', () => ({
  getMenuItems: vi.fn((profile: string, includeUnavailable = false) => {
    const all = Array.from(items.values()).filter(i => i.profile === profile);
    return includeUnavailable ? all : all.filter(i => i.available);
  }),
  getMenuItem: vi.fn((profile: string, id: string) => {
    const item = items.get(id);
    return item?.profile === profile ? item : undefined;
  }),
  updateMenuItem: vi.fn(async (_profile: string, id: string, patch: any) => {
    const item = items.get(id);
    if (!item) return null;
    Object.assign(item, patch, { updated_at: new Date().toISOString() });
    return item;
  }),
}));

import {
  processStockUpdate,
  toggleItemAvailability,
  getInventoryStatus,
  isItemAvailable,
} from '../inventory-sync.js';

describe('US-949: Inventory Sync', () => {
  beforeEach(() => {
    items = createItems();
    vi.clearAllMocks();
  });

  describe('processStockUpdate', () => {
    it('AC1: updates item availability when POS signals quantity=0', async () => {
      const result = await processStockUpdate([
        { itemCode: 'item-1', itemName: 'Nasi Lemak', quantity: 0 },
      ]);
      expect(result.updated).toContain('Nasi Lemak');
      expect(result.unchanged).toHaveLength(0);
      expect(result.notFound).toHaveLength(0);
    });

    it('AC1: marks item as available when quantity > 0', async () => {
      const result = await processStockUpdate([
        { itemCode: 'item-3', itemName: 'Mee Goreng', quantity: 5 },
      ]);
      expect(result.updated).toContain('Mee Goreng');
    });

    it('reports unchanged when availability matches', async () => {
      const result = await processStockUpdate([
        { itemCode: 'item-2', itemName: 'Roti Canai', quantity: 10 },
      ]);
      expect(result.unchanged).toContain('Roti Canai');
      expect(result.updated).toHaveLength(0);
    });

    it('reports notFound for unknown items', async () => {
      const result = await processStockUpdate([
        { itemCode: 'unknown-item', quantity: 0 },
      ]);
      expect(result.notFound).toContain('unknown-item');
    });

    it('handles batch updates', async () => {
      const result = await processStockUpdate([
        { itemCode: 'item-1', itemName: 'Nasi Lemak', quantity: 0 },
        { itemCode: 'item-2', itemName: 'Roti Canai', quantity: 10 },
        { itemCode: 'nonexistent', quantity: 0 },
      ]);
      expect(result.updated.length + result.unchanged.length + result.notFound.length).toBe(3);
    });

    it('AC5: logs transitions with timestamp to DB', async () => {
      const { pool } = await import('../../lib/db.js');
      const mockQuery = pool.query as ReturnType<typeof vi.fn>;

      await processStockUpdate(
        [{ itemCode: 'item-1', itemName: 'Nasi Lemak', quantity: 0 }],
        'pos_webhook',
        'pos_system'
      );

      const insertCall = mockQuery.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('inventory_transitions')
      );
      expect(insertCall).toBeDefined();
      // Verify the source parameter is passed
      expect(insertCall![1]).toContain('pos_webhook');
    });
  });

  describe('toggleItemAvailability', () => {
    it('AC4: admin can toggle item to unavailable', async () => {
      const result = await toggleItemAvailability('makan-moments', 'item-2', false, 'admin-jay');
      expect(result.success).toBe(true);
      expect(result.item).toBeDefined();
      expect(result.item!.name).toBe('Roti Canai');
      expect(result.item!.available).toBe(false);
    });

    it('AC4: admin can toggle item back to available', async () => {
      const result = await toggleItemAvailability('makan-moments', 'item-3', true, 'admin-jay');
      expect(result.success).toBe(true);
      expect(result.item!.available).toBe(true);
    });

    it('returns error for unknown item', async () => {
      const result = await toggleItemAvailability('makan-moments', 'nonexistent', false);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('no-op when availability already matches', async () => {
      const result = await toggleItemAvailability('makan-moments', 'item-3', false);
      expect(result.success).toBe(true);
    });
  });

  describe('getInventoryStatus', () => {
    it('AC3: returns all items with availability status', () => {
      const status = getInventoryStatus('makan-moments');
      expect(status.length).toBe(3);
      for (const item of status) {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('category');
        expect(item).toHaveProperty('price');
        expect(item).toHaveProperty('available');
      }
    });

    it('AC3: shows correct available/unavailable split', () => {
      const status = getInventoryStatus('makan-moments');
      const available = status.filter(i => i.available);
      const unavailable = status.filter(i => !i.available);
      expect(available.length).toBe(2);
      expect(unavailable.length).toBe(1);
    });
  });

  describe('isItemAvailable', () => {
    it('AC2: returns unavailable for out-of-stock item', () => {
      const result = isItemAvailable('makan-moments', 'item-3', 'Mee Goreng');
      expect(result.available).toBe(false);
      expect(result.itemName).toBe('Mee Goreng');
    });

    it('AC2: suggests alternatives from same category', () => {
      const result = isItemAvailable('makan-moments', 'item-3', 'Mee Goreng');
      expect(result.available).toBe(false);
      // Mee Goreng is in "Rice" category, Nasi Lemak is also in "Rice"
      expect(result.alternatives).toBeDefined();
      expect(result.alternatives!.length).toBeGreaterThan(0);
      expect(result.alternatives![0].name).toBe('Nasi Lemak');
    });

    it('AC2: returns available for in-stock item', () => {
      const result = isItemAvailable('makan-moments', 'item-2', 'Roti Canai');
      expect(result.available).toBe(true);
    });

    it('returns available for unknown items (graceful fallback)', () => {
      const result = isItemAvailable('makan-moments', 'unknown', 'Unknown Dish');
      expect(result.available).toBe(true);
    });

    it('returns available when no identifiers provided', () => {
      const result = isItemAvailable('makan-moments');
      expect(result.available).toBe(true);
    });
  });
});
