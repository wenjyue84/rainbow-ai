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
    }
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
    }
  },
  {
    name: 'fnb_get_operating_hours',
    description: 'Check if the cafe is currently open and get today\'s operating hours',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  // Admin tools (require FNB_MCP_SECRET)
  {
    name: 'fnb_get_pending_orders',
    description: 'List pending orders for staff review (admin only)',
    inputSchema: {
      type: 'object',
      properties: {}
    }
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
    }
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
    }
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
      const text = await res.text();
      return {
        content: [{ type: 'text', text: `FnB MCP error (${res.status}): ${text}` }],
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
      content: [{ type: 'text', text: `FnB MCP connection error: ${error.message}` }],
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
