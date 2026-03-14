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
import {
  transitionOrderStage, clearOrderStage,
} from '../assistant/order-stage-store.js';

// ─── Tool Definitions ──────────────────────────────────────────────

export const cartTools: MCPTool[] = [
  {
    name: 'cart_add_item',
    description: 'Add an item to the guest\'s cart. Use this when the guest says they want to order something. Transitions order stage to ORDERING.',
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
    description: 'Clear all items from the guest\'s cart. Use after order is placed or if guest wants to start over.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    allowedProfiles: ['makan-moments']
  },
  // ─── Order Stage Tools ───────────────────────────────────────────
  {
    name: 'order_request_confirmation',
    description: [
      'Show the guest a full itemised order summary and ask "Shall I place this order?" before submitting.',
      'Use this when the guest signals they are done ordering (e.g. "that\'s all", "place my order", "I\'m ready").',
      'This transitions the stage to CONFIRMING. Do NOT submit the order yet — wait for the guest\'s explicit yes/no.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {}
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'order_confirm_submit',
    description: [
      'Submit the order to the kitchen. Call this ONLY when the guest has explicitly confirmed with yes, go ahead, place it, etc.',
      'This transitions stage to PLACED and clears the cart.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        tableNumber: { type: 'string', description: 'Table number or seat identifier (optional, ask if not known)' }
      }
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'order_back_to_cart',
    description: [
      'Return the guest to the ORDERING stage after they decline confirmation.',
      'Use when the guest says no, wait, cancel, or changes their mind after you asked "Shall I place this order?".',
    ].join(' '),
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
    // Transition stage to ORDERING when an item is added
    transitionOrderStage(sessionId, 'ORDERING');
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
    // If cart is now empty, go back to BROWSING
    if (items.length === 0) {
      transitionOrderStage(sessionId, 'BROWSING');
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
    clearOrderStage(sessionId);
    return {
      content: [{ type: 'text', text: 'Cart cleared.' }]
    };
  });

  // ─── Order Stage Handlers ────────────────────────────────────────

  handlers.set('order_request_confirmation', async (_args: any) => {
    const items = cartGetItems(sessionId);
    if (items.length === 0) {
      return {
        content: [{ type: 'text', text: 'The cart is empty. Please add items before placing an order.' }]
      };
    }
    transitionOrderStage(sessionId, 'CONFIRMING');
    const summary = cartFormatSummary(items);
    return {
      content: [{
        type: 'text',
        text: `Here is your order summary:\n\n${summary}\n\nShall I place this order? (Reply *yes* to confirm or *no* to make changes)`
      }]
    };
  });

  handlers.set('order_confirm_submit', async (args: any) => {
    const items = cartGetItems(sessionId);
    if (items.length === 0) {
      return {
        content: [{ type: 'text', text: 'The cart is empty. Nothing to submit.' }]
      };
    }
    const summary = cartFormatSummary(items);
    const tableInfo = args.tableNumber ? ` for table ${args.tableNumber}` : '';
    // Transition to PLACED and clear cart
    transitionOrderStage(sessionId, 'PLACED');
    cartClear(sessionId);
    clearOrderStage(sessionId);
    return {
      content: [{
        type: 'text',
        text: `Your order${tableInfo} has been sent to the kitchen!\n\n${summary}\n\nThank you! Our staff will prepare your order shortly. Please let us know if you need anything else.`
      }]
    };
  });

  handlers.set('order_back_to_cart', async (_args: any) => {
    transitionOrderStage(sessionId, 'ORDERING');
    const items = cartGetItems(sessionId);
    const summary = cartFormatSummary(items);
    return {
      content: [{
        type: 'text',
        text: `No problem! Your cart still has:\n\n${summary}\n\nFeel free to add or remove items, or let me know when you're ready to order.`
      }]
    };
  });

  return handlers;
}
