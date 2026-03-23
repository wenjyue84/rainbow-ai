/**
 * cart-handlers-core.ts — Basic cart CRUD handlers
 *
 * Handles: cart_add_item, cart_remove_item, cart_view, cart_clear,
 *          cart_update_qty, cart_set_item_notes, cart_set_table
 */

import type { MCPToolResult } from '../types/mcp.js';
import {
  cartAddItem, cartRemoveItem, cartGetItems, cartClear,
  cartUpdateItemQty, cartSetItemNotes, cartSetTableInfo,
  cartFormatSummary, type CartItem,
} from '../assistant/cart-store.js';
import { transitionOrderStage } from '../assistant/order-stage-store.js';
import { markCorrected } from '../assistant/order-accuracy-tracker.js';

type HandlerMap = Map<string, (args: any) => Promise<MCPToolResult>>;

export function registerCoreHandlers(handlers: HandlerMap, sessionId: string): void {

  handlers.set('cart_add_item', async (args: any) => {
    const name: string = String(args.name || '').trim();
    if (!name) {
      return { content: [{ type: 'text', text: 'Please provide the item name to add.' }] };
    }
    const qty: number = typeof args.qty === 'number' && args.qty > 0 ? Math.floor(args.qty) : 1;
    const item: CartItem = {
      name,
      qty,
      ...(args.code ? { code: String(args.code) } : {}),
      ...(typeof args.price === 'number' ? { price: args.price } : {}),
      ...(args.notes ? { notes: String(args.notes) } : {}),
    };
    const items = cartAddItem(sessionId, item);
    transitionOrderStage(sessionId, 'ORDERING');
    const summary = cartFormatSummary(items);
    return {
      content: [{
        type: 'text',
        text: `Added ${qty}x ${name} to your cart.\n\nYour cart:\n${summary}`,
      }],
    };
  });

  handlers.set('cart_remove_item', async (args: any) => {
    const name: string = String(args.name || '').trim();
    if (!name) {
      return { content: [{ type: 'text', text: 'Please tell me which item to remove.' }] };
    }
    const { removed, items } = cartRemoveItem(sessionId, name);
    if (!removed) {
      return {
        content: [{
          type: 'text',
          text: `I couldn't find "${name}" in your cart. Here is what you have:\n\n${cartFormatSummary(items)}`,
        }],
      };
    }
    // US-902: Record correction event for accuracy tracking
    markCorrected(sessionId);
    const summary = cartFormatSummary(items);
    return {
      content: [{
        type: 'text',
        text: `Removed ${removed.qty}x ${removed.name} from your cart.\n\nYour cart:\n${summary}`,
      }],
    };
  });

  handlers.set('cart_view', async (_args: any) => {
    const items = cartGetItems(sessionId);
    return {
      content: [{
        type: 'text',
        text: cartFormatSummary(items),
      }],
    };
  });

  handlers.set('cart_clear', async (_args: any) => {
    cartClear(sessionId);
    return {
      content: [{ type: 'text', text: 'Your cart has been cleared.' }],
    };
  });

  handlers.set('cart_update_qty', async (args: any) => {
    const name: string = String(args.name || '').trim();
    const qty: number = typeof args.qty === 'number' ? args.qty : 0;
    if (!name) {
      return { content: [{ type: 'text', text: 'Please tell me which item to update.' }] };
    }
    const { found, removed, items } = cartUpdateItemQty(sessionId, name, qty);
    if (!found) {
      return {
        content: [{
          type: 'text',
          text: `"${name}" is not in your cart yet. Here is what you have:\n\n${cartFormatSummary(items)}`,
        }],
      };
    }
    // US-902: Record correction for accuracy tracking when modifying
    markCorrected(sessionId);
    const summary = cartFormatSummary(items);
    const action = removed ? `Removed ${name} from your cart.` : `Updated ${name} to ${qty}x.`;
    return {
      content: [{ type: 'text', text: `${action}\n\nYour cart:\n${summary}` }],
    };
  });

  handlers.set('cart_set_item_notes', async (args: any) => {
    const name: string = String(args.name || '').trim();
    const notes: string = String(args.notes || '').trim();
    if (!name || !notes) {
      return { content: [{ type: 'text', text: 'Please provide both the item name and the instruction.' }] };
    }
    const { found, items } = cartSetItemNotes(sessionId, name, notes);
    if (!found) {
      return {
        content: [{
          type: 'text',
          text: `"${name}" is not in your cart. Here is what you have:\n\n${cartFormatSummary(items)}`,
        }],
      };
    }
    const summary = cartFormatSummary(items);
    return {
      content: [{ type: 'text', text: `Got it — noted "${notes}" for ${name}.\n\nYour cart:\n${summary}` }],
    };
  });

  handlers.set('cart_set_table', async (args: any) => {
    const rawTable: string = String(args.tableNumber || '').trim();
    const orderType: string = String(args.orderType || '').trim().toLowerCase();

    const isTakeaway = orderType === 'takeaway';
    const tableNumber = rawTable || undefined;
    const resolvedOrderType = isTakeaway ? 'takeaway' : (tableNumber ? 'dine-in' : undefined);

    const info = cartSetTableInfo(sessionId, {
      ...(tableNumber ? { tableNumber } : {}),
      ...(resolvedOrderType ? { orderType: resolvedOrderType } : {}),
    });

    if (info.orderType === 'takeaway') {
      return { content: [{ type: 'text', text: 'Got it — your order will be packed as takeaway.' }] };
    }
    if (info.tableNumber) {
      return { content: [{ type: 'text', text: `Got it — your order is for table ${info.tableNumber}.` }] };
    }
    return { content: [{ type: 'text', text: 'Table information has been updated.' }] };
  });
}
