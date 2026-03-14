import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { fnbGetMenu, fnbGetMenuItem } from '../../tools/fnb-menu.js';
import { fnbGetOrderStatus, fnbCreateOrder } from '../../tools/fnb-orders.js';

describe('FnB Tool Handlers - MCPToolResult Shape', () => {
  beforeAll(() => {
    process.env.FNB_MCP_URL = 'http://test-mock/api/mcp';
    process.env.FNB_MCP_SECRET = 'test-secret';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fnbGetMenu({}) with successful fetch returns correct MCPToolResult shape', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Menu items list...' }]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await fnbGetMenu({});

    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text');
    expect(result.content[0].text).toContain('Menu items list');
    expect(result.isError).toBeUndefined();
  });

  it('fnbGetMenu({}) with fetch throwing returns { content: [...], isError: true }', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await fnbGetMenu({});

    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('isError', true);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0].text).toContain('FnB MCP connection error');
  });

  it('fnbGetOrderStatus({orderId:"MM-1234"}) calls fetch and returns result', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Order status: pending' }]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await fnbGetOrderStatus({ orderId: 'MM-1234' });

    expect(mockFetch).toHaveBeenCalled();
    expect(result).toHaveProperty('content');
    expect(result.content[0].text).toContain('Order status');
  });

  it('fnbCreateOrder with valid args returns MCPToolResult', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Order created: MM-ABC123' }]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await fnbCreateOrder({
      items: [{ code: 'NR01', qty: 2 }],
      phone: '60123456789',
      estimated_arrival: '2026-03-14T18:00:00Z'
    });

    expect(result).toHaveProperty('content');
    expect(result.content[0].text).toContain('Order created');
  });

  it('fnbGetMenuItem with fetch HTTP error returns isError: true', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Item not found'
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await fnbGetMenuItem({ code: 'INVALID' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('FnB MCP error');
  });
});
