/**
 * returning-customer.test.ts — Unit tests for US-897
 *
 * Verifies:
 * - getLastOrder returns null for first-time sessions (no prior orders)
 * - getLastOrder returns the correct prior cart for returning sessions
 * - saveOrderHistory persists order data correctly
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoist mocks ──────────────────────────────────────────────────────
const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock('../../lib/db.js', () => ({
  pool: { query: mockPoolQuery },
}));

// Import after mocks
import { saveOrderHistory, getLastOrder } from '../order-history-store.js';
import type { CartItem } from '../cart-store.js';

describe('Returning customer order history (US-897)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Migration queries (CREATE TABLE + CREATE INDEX) — resolve silently
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('returns null for a first-time session with no prior orders', async () => {
    // SELECT query returns empty rows
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await getLastOrder('webchat-new_session_123');

    expect(result).toBeNull();
  });

  it('returns the most recent order for a returning session', async () => {
    const mockItems: CartItem[] = [
      { name: 'Nasi Lemak', code: 'NR01', qty: 1, price: 8.5 },
      { name: 'Teh Tarik', code: 'DK01', qty: 2, price: 3.0 },
    ];

    // SELECT query returns the last order
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        phone: 'webchat-returning_abc',
        order_id: 'MM-A1B2',
        items: mockItems,
        placed_at: new Date('2026-03-14T10:30:00Z'),
      }],
      rowCount: 1,
    });

    const result = await getLastOrder('webchat-returning_abc');

    expect(result).not.toBeNull();
    expect(result!.orderId).toBe('MM-A1B2');
    expect(result!.items).toHaveLength(2);
    expect(result!.items[0].name).toBe('Nasi Lemak');
    expect(result!.items[0].qty).toBe(1);
    expect(result!.items[1].name).toBe('Teh Tarik');
    expect(result!.items[1].qty).toBe(2);
  });

  it('handles items stored as JSON string', async () => {
    const mockItems: CartItem[] = [
      { name: 'Roti Canai', code: 'RC01', qty: 3, price: 2.5 },
    ];

    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        phone: 'webchat-json_str',
        order_id: 'MM-C3D4',
        items: JSON.stringify(mockItems),
        placed_at: new Date('2026-03-14T11:00:00Z'),
      }],
      rowCount: 1,
    });

    const result = await getLastOrder('webchat-json_str');

    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(1);
    expect(result!.items[0].name).toBe('Roti Canai');
    expect(result!.items[0].qty).toBe(3);
  });

  it('saveOrderHistory calls pool.query with correct params', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const items: CartItem[] = [
      { name: 'Mee Goreng', code: 'MG01', qty: 1, price: 7.0 },
    ];

    await saveOrderHistory('webchat-save_test', 'MM-E5F6', items);

    // Find the INSERT call (skip migration queries)
    const insertCall = mockPoolQuery.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO webchat_order_history')
    );

    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual([
      'webchat-save_test',
      'MM-E5F6',
      JSON.stringify(items),
    ]);
  });

  it('getLastOrder returns null on database error', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await getLastOrder('webchat-error_session');

    expect(result).toBeNull();
  });

  it('getLastOrder returns null if last order is older than 30 days (US-856)', async () => {
    // Query with 30-day filter returns empty
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await getLastOrder('webchat-old_order');

    expect(result).toBeNull();
    // Verify the query was called with a WHERE clause filtering by date
    const lastCall = mockPoolQuery.mock.calls[mockPoolQuery.mock.calls.length - 1];
    expect(lastCall[0]).toContain('placed_at > $2');
    expect(lastCall[1]).toEqual(['webchat-old_order', expect.any(Date)]);
  });

  it('getLastOrder returns order if placed within 30 days (US-856)', async () => {
    const twentyNineDaysAgo = new Date();
    twentyNineDaysAgo.setDate(twentyNineDaysAgo.getDate() - 29);

    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        phone: 'webchat-recent_order',
        order_id: 'MM-REC1',
        items: [{ name: 'Fresh Item', code: 'FR01', qty: 2, price: 6.0 }],
        placed_at: twentyNineDaysAgo,
      }],
      rowCount: 1,
    });

    const result = await getLastOrder('webchat-recent_order');

    expect(result).not.toBeNull();
    expect(result!.orderId).toBe('MM-REC1');
    expect(result!.items[0].name).toBe('Fresh Item');
    // Verify the query was called with the 30-day filter
    const lastCall = mockPoolQuery.mock.calls[mockPoolQuery.mock.calls.length - 1];
    expect(lastCall[0]).toContain('placed_at > $2');
  });
});
