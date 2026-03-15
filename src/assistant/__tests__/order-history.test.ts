/**
 * order-history.test.ts — Tests for US-897 returning-customer order history
 *
 * Validates the order history store: save, retrieve, first-time empty lookup,
 * and returning-session correct cart retrieval.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock the DB pool before importing ────────────────────────────────────────
// Default to resolving (needed for startup CREATE TABLE migration)
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
vi.mock('../../lib/db.js', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

// Import after mocks are set up
const { saveOrderHistory, getLastOrder } = await import('../order-history-store.js');

describe('US-897: Order History Store', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('getLastOrder returns null for a first-time session with no orders', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getLastOrder('new-session-123', 'makan-moments');

    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT'),
      ['new-session-123', 'makan-moments'],
    );
  });

  test('getLastOrder returns correct prior cart for a returning session', async () => {
    const savedItems = [
      { name: 'Nasi Lemak', code: 'NR01', qty: 1, price: 8.5 },
      { name: 'Teh Tarik', code: 'DK01', qty: 2, price: 3.0 },
    ];

    mockQuery.mockResolvedValueOnce({
      rows: [{
        items_json: JSON.stringify(savedItems),
        table_info_json: JSON.stringify({ tableNumber: '5', orderType: 'dine-in' }),
        order_id: 'MM-A1B2',
        total_amount: 14.5,
        created_at: new Date('2026-03-14T10:00:00Z'),
      }],
    });

    const result = await getLastOrder('returning-session-456', 'makan-moments');

    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(2);
    expect(result!.items[0].name).toBe('Nasi Lemak');
    expect(result!.items[1].name).toBe('Teh Tarik');
    expect(result!.orderId).toBe('MM-A1B2');
    expect(result!.totalAmount).toBe(14.5);
    expect(result!.placedAt).toBe('2026-03-14T10:00:00.000Z');
  });

  test('saveOrderHistory persists items to DB with correct parameters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const items = [
      { name: 'Chicken Rice', code: 'CR01', qty: 1, price: 10.0 },
    ];

    await saveOrderHistory({
      sessionId: 'test-session',
      phone: 'webchat-test-session',
      items,
      orderId: 'MM-X1Y2',
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO webchat_order_history'),
      expect.arrayContaining([
        'test-session',
        'webchat-test-session',
        'makan-moments',
        JSON.stringify(items),
      ]),
    );
  });

  test('getLastOrder handles DB error gracefully, returns null', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await getLastOrder('error-session', 'makan-moments');
    expect(result).toBeNull();
  });

  test('saveOrderHistory handles DB error gracefully without throwing', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

    // Should not throw
    await expect(
      saveOrderHistory({
        sessionId: 'error-session',
        phone: 'webchat-error-session',
        items: [{ name: 'Test Item', qty: 1 }],
      })
    ).resolves.toBeUndefined();
  });
});
