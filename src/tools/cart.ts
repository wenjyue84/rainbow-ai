/**
 * cart.ts — Conversational cart MCP tools for the AI waiter
 *
 * These tools are injected per-request in webchat-api.ts, with handlers
 * closing over the sessionId so the AI can mutate the correct cart.
 */

import type { MCPTool, MCPToolResult } from '../types/mcp.js';
import {
  cartAddItem, cartRemoveItem, cartGetItems, cartClear,
  cartFormatSummary, type CartItem
} from '../assistant/cart-store.js';

// ─── Tool Definitions ──────────────────────────────────────────────

export const cartTools: MCPTool[] = [
  {
    name: 'cart_add_item',
    description: 'Add an item to the guest\'s cart. Use this when the guest says they want to order something.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the menu item (e.g. "Nasi Lemak")' },
        qty: { type: 'number', description: 'Quantity to add (default 1)' },
        code: { type: 'string', description: 'Menu item code if known (e.g. "NR01")' },
        price: { type: 'number', description: 'Unit price in MYR if known (e.g. 8.50)' },
        notes: { type: 'string', description: 'Special instructions for this item (optional)' }
      },
      required: ['name']
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'cart_remove_item',
    description: 'Remove an item from the guest\'s cart. Use this when the guest says remove, cancel, drop, or forget an item.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the menu item to remove' }
      },
      required: ['name']
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'cart_view',
    description: 'Show the guest their current cart contents. Use when they ask what have I ordered, show my cart, etc.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'cart_clear',
    description: 'Clear all items from the guest\'s cart. Use after order is confirmed/placed or if guest wants to start over.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    allowedProfiles: ['makan-moments']
  }
];

// ─── Handler Factories ─────────────────────────────────────────────

/**
 * Create per-session cart handlers that close over the sessionId.
 * Call this once per webchat request and merge the result into the tool handlers map.
 */
export function createCartHandlers(sessionId: string): Map<string, (args: any) => Promise<MCPToolResult>> {
  const handlers = new Map<string, (args: any) => Promise<MCPToolResult>>();

  handlers.set('cart_add_item', async (args: any) => {
    const item: CartItem = {
      name: args.name,
      qty: typeof args.qty === 'number' && args.qty > 0 ? Math.floor(args.qty) : 1,
      code: args.code || undefined,
      price: typeof args.price === 'number' ? args.price : undefined,
      notes: args.notes || undefined
    };
    const items = cartAddItem(sessionId, item);
    const summary = cartFormatSummary(items);
    return {
      content: [{
        type: 'text',
        text: `Added ${item.qty}x ${item.name} to cart.\n\nCurrent cart:\n${summary}`
      }]
    };
  });

  handlers.set('cart_remove_item', async (args: any) => {
    const { removed, items } = cartRemoveItem(sessionId, args.name);
    if (!removed) {
      return {
        content: [{ type: 'text', text: `"${args.name}" was not found in the cart.` }]
      };
    }
    const summary = cartFormatSummary(items);
    const cartMsg = items.length > 0 ? `\n\nUpdated cart:\n${summary}` : '\n\nYour cart is now empty.';
    return {
      content: [{ type: 'text', text: `Removed ${removed.qty}x ${removed.name} from cart.${cartMsg}` }]
    };
  });

  handlers.set('cart_view', async (_args: any) => {
    const items = cartGetItems(sessionId);
    const summary = cartFormatSummary(items);
    return {
      content: [{ type: 'text', text: summary }]
    };
  });

  handlers.set('cart_clear', async (_args: any) => {
    cartClear(sessionId);
    return {
      content: [{ type: 'text', text: 'Cart cleared.' }]
    };
  });

  return handlers;
}
