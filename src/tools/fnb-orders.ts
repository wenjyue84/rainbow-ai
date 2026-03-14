import { MCPTool, MCPToolResult } from '../types/mcp.js';

const FNB_MCP_URL = process.env.FNB_MCP_URL || 'http://localhost:3031/api/mcp';
const FNB_MCP_SECRET = process.env.FNB_MCP_SECRET || '';

// --- Tool definitions ---

export const fnbOrderTools: MCPTool[] = [
  // Public tools (no auth required)
  {
    name: 'fnb_create_order',
    description: 'Create a new pre-order for a customer. Returns the order ID for tracking.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Array of items to order',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Menu item code (e.g. "NR01")' },
              qty: { type: 'number', description: 'Quantity to order' }
            },
            required: ['code', 'qty']
          }
        },
        phone: { type: 'string', description: 'Customer phone number' },
        estimated_arrival: { type: 'string', description: 'Estimated arrival time (ISO datetime string)' },
        notes: { type: 'string', description: 'Special instructions or notes (optional)' }
      },
      required: ['items', 'phone', 'estimated_arrival']
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'fnb_get_order_status',
    description: 'Check order status by order ID (short ID like MM-XXXX or full order ID)',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'Order ID (short ID e.g. "MM-A1B2" or full UUID)' }
      },
      required: ['orderId']
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'fnb_get_operating_hours',
    description: 'Check if the cafe is currently open and get today\'s operating hours',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    allowedProfiles: ['makan-moments']
  },
  // Admin tools (require FNB_MCP_SECRET)
  {
    name: 'fnb_get_pending_orders',
    description: 'List pending orders for staff review (admin only)',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'fnb_approve_order',
    description: 'Approve a pending order (admin only)',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'Order ID to approve' }
      },
      required: ['orderId']
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'fnb_update_order_status',
    description: 'Update order status (admin only)',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'Order ID to update' },
        status: { type: 'string', description: 'New status (e.g. "preparing", "ready", "completed", "cancelled")' }
      },
      required: ['orderId', 'status']
    },
    allowedProfiles: ['makan-moments']
  }
];

// --- MCP call helpers ---

async function callFnbMcp(tool: string, input: Record<string, any> = {}, requireAuth = false): Promise<MCPToolResult> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (requireAuth) {
      if (!FNB_MCP_SECRET) {
        return {
          content: [{ type: 'text', text: 'Admin operation requires FNB_MCP_SECRET to be configured' }],
          isError: true
        };
      }
      headers['x-mcp-secret'] = FNB_MCP_SECRET;
    }

    const res = await fetch(FNB_MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool, input })
    });

    if (!res.ok) {
      return {
        content: [{ type: 'text', text: 'The cafe ordering system returned an error. Please try again or contact staff.' }],
        isError: true
      };
    }

    const data = await res.json();
    const text = data.content
      ? data.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
      : JSON.stringify(data, null, 2);

    return { content: [{ type: 'text', text }] };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: 'Unable to reach the cafe ordering system right now. Please try again or ask our staff for help.' }],
      isError: true
    };
  }
}

// --- Public tool handlers ---

export async function fnbCreateOrder(args: any): Promise<MCPToolResult> {
  return callFnbMcp('fnb_create_order', {
    items: args.items,
    phone: args.phone,
    estimated_arrival: args.estimated_arrival,
    ...(args.notes ? { notes: args.notes } : {})
  });
}

export async function fnbGetOrderStatus(args: any): Promise<MCPToolResult> {
  return callFnbMcp('fnb_get_order', { orderId: args.orderId });
}

export async function fnbGetOperatingHours(_args: any): Promise<MCPToolResult> {
  return callFnbMcp('fnb_get_operating_hours');
}

// --- Kitchen status with 2-minute cache (US-868) ---

let kitchenStatusCache: { data: MCPToolResult; timestamp: number } | null = null;
const KITCHEN_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export async function fnbGetKitchenStatus(): Promise<MCPToolResult> {
  // Return cached result if fresh
  if (kitchenStatusCache && Date.now() - kitchenStatusCache.timestamp < KITCHEN_CACHE_TTL_MS) {
    return kitchenStatusCache.data;
  }

  // 2-second timeout to keep it non-blocking
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (FNB_MCP_SECRET) headers['x-mcp-secret'] = FNB_MCP_SECRET;

    const res = await fetch(FNB_MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool: 'get_kitchen_status', input: {} }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return { content: [{ type: 'text', text: '' }], isError: true };
    }

    const data = await res.json();
    const text = data.content
      ? data.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
      : JSON.stringify(data, null, 2);

    const result: MCPToolResult = { content: [{ type: 'text', text }] };
    kitchenStatusCache = { data: result, timestamp: Date.now() };
    return result;
  } catch {
    clearTimeout(timeoutId);
    return { content: [{ type: 'text', text: '' }], isError: true };
  }
}

// --- Admin tool handlers ---

export async function fnbGetPendingOrders(_args: any): Promise<MCPToolResult> {
  return callFnbMcp('fnb_get_pending_orders', {}, true);
}

export async function fnbApproveOrder(args: any): Promise<MCPToolResult> {
  return callFnbMcp('fnb_approve_order', { orderId: args.orderId }, true);
}

export async function fnbUpdateOrderStatus(args: any): Promise<MCPToolResult> {
  return callFnbMcp('fnb_update_order_status', { orderId: args.orderId, status: args.status }, true);
}
