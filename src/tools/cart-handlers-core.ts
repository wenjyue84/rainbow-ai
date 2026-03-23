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
  cartFormatSummary, type CartItem, type TableInfo,
} from '../assistant/cart-store.js';
import { transitionOrderStage, clearOrderStage, getOrderStage } from '../assistant/order-stage-store.js';
import { getAllergenEntry, formatAllergenWarning } from '../lib/allergen-store.js';
import { setPendingAllergenItem } from '../lib/allergen-pending-store.js';
import { hasUpsellBeenOffered, markUpsellOffered, getUpsellSuggestion } from '../assistant/upsell-tracker.js';
import { markCorrected } from '../assistant/order-accuracy-tracker.js';
import { clearPendingSetMeal } from '../assistant/set-meal-store.js';

type HandlerMap = Map<string, (args: any) => Promise<MCPToolResult>>;

export function registerCoreHandlers(handlers: HandlerMap, sessionId: string): void {

  handlers.set('cart_add_item', async (args: any) => {
    const item: CartItem = {
      name: args.name,
      qty: typeof args.qty === 'number' && args.qty > 0 ? Math.floor(args.qty) : 1,
      code: args.code || undefined,
      price: typeof args.price === 'number' ? args.price : undefined,
      notes: args.notes || undefined,
    };

    // US-877: Check allergen data before adding to cart
    if (item.code) {
      const allergenEntry = getAllergenEntry(item.code);
      const hasAllergens = allergenEntry && (allergenEntry.allergens.length > 0 || allergenEntry.dietary_flags.length > 0);
      if (hasAllergens) {
        const warning = formatAllergenWarning(item.code, item.name);
        setPendingAllergenItem(sessionId, item, warning);
        return {
          content: [{
            type: 'text',
            text: `${warning}\n\nWould you like to add ${item.qty}x ${item.name} to your cart? Reply *YES* to confirm or *NO* to cancel.`,
          }],
        };
      }
    }

    // US-902: If modifying cart while in CONFIRMING stage, record correction
    if (getOrderStage(sessionId) === 'CONFIRMING') markCorrected(sessionId);

    const items = cartAddItem(sessionId, item);
    transitionOrderStage(sessionId, 'ORDERING');
    const summary = cartFormatSummary(items);
    const allergenAdvisory = item.code
      ? ''
      : '\n\n⚠️ Please inform our staff of any allergies before ordering.';

    // US-857: Suggest an upsell after first main item is added
    let upsellMessage = '';
    if (!hasUpsellBeenOffered(sessionId) && item.code) {
      const { message } = getUpsellSuggestion(args.category);
      markUpsellOffered(sessionId);
      upsellMessage = `\n\n${message}`;
    }

    return {
      content: [{
        type: 'text',
        text: `Added ${item.qty}x ${item.name} to cart.${allergenAdvisory}\n\nCurrent cart:\n${summary}${upsellMessage}`,
      }],
    };
  });

  handlers.set('cart_remove_item', async (args: any) => {
    // US-902: If modifying cart while in CONFIRMING stage, record correction
    if (getOrderStage(sessionId) === 'CONFIRMING') markCorrected(sessionId);

    const { removed, items } = cartRemoveItem(sessionId, args.name);
    if (!removed) {
      return {
        content: [{ type: 'text', text: `"${args.name}" was not found in the cart.` }],
      };
    }
    // If cart is now empty, go back to BROWSING
    if (items.length === 0) {
      transitionOrderStage(sessionId, 'BROWSING');
    }
    const summary = cartFormatSummary(items);
    const cartMsg = items.length > 0 ? `\n\nUpdated cart:\n${summary}` : '\n\nYour cart is now empty.';
    return {
      content: [{ type: 'text', text: `Removed ${removed.qty}x ${removed.name} from cart.${cartMsg}` }],
    };
  });

  handlers.set('cart_update_qty', async (args: any) => {
    // US-902: If modifying cart while in CONFIRMING stage, record correction
    if (getOrderStage(sessionId) === 'CONFIRMING') markCorrected(sessionId);

    const name: string = String(args.name || '').trim();
    const qty: number = typeof args.qty === 'number' ? Math.max(0, Math.floor(args.qty)) : 0;

    if (!name) {
      return { content: [{ type: 'text', text: 'Please tell me which item to update.' }] };
    }

    const { found, removed, items } = cartUpdateItemQty(sessionId, name, qty);

    if (!found) {
      return {
        content: [{
          type: 'text',
          text: `"${name}" is not in your order yet. Would you like me to add it?`,
        }],
      };
    }

    if (removed) {
      if (items.length === 0) {
        transitionOrderStage(sessionId, 'BROWSING');
      }
      const cartMsg = items.length > 0
        ? `\n\nUpdated cart:\n${cartFormatSummary(items)}`
        : '\n\nYour cart is now empty.';
      return {
        content: [{ type: 'text', text: `Removed ${name} from your cart (quantity set to 0).${cartMsg}` }],
      };
    }

    const summary = cartFormatSummary(items);
    return {
      content: [{ type: 'text', text: `Updated ${name} to ${qty}x.\n\nCurrent cart:\n${summary}` }],
    };
  });

  handlers.set('cart_view', async (_args: any) => {
    const items = cartGetItems(sessionId);
    const summary = cartFormatSummary(items);
    return {
      content: [{ type: 'text', text: summary }],
    };
  });

  handlers.set('cart_clear', async (_args: any) => {
    cartClear(sessionId);
    clearPendingSetMeal(sessionId);
    clearOrderStage(sessionId);
    return {
      content: [{ type: 'text', text: 'Cart cleared.' }],
    };
  });

  handlers.set('cart_set_item_notes', async (args: any) => {
    const name: string = String(args.name || '').trim();
    const notes: string = String(args.notes || '').trim();

    if (!name || !notes) {
      return { content: [{ type: 'text', text: 'Please specify which item and what special instruction to add.' }] };
    }

    const { found, items } = cartSetItemNotes(sessionId, name, notes);

    if (!found) {
      const currentItems = cartGetItems(sessionId);
      if (currentItems.length === 1) {
        const only = currentItems[0];
        return {
          content: [{
            type: 'text',
            text: `"${name}" is not in the cart. Did you mean ${only.name}? Please confirm and I'll add the note "${notes}" to it.`,
          }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: `"${name}" is not in your cart. Please check your order and tell me which item you'd like to add the note to.`,
        }],
      };
    }

    const summary = cartFormatSummary(items);
    return {
      content: [{
        type: 'text',
        text: `Got it! Added "${notes}" to ${name}.\n\nCurrent cart:\n${summary}`,
      }],
    };
  });

  handlers.set('cart_set_table', async (args: any) => {
    const info: TableInfo = {};

    if (args.tableNumber) {
      // Normalize table number: extract digits from patterns like "T5", "table 5", "table5"
      const raw = String(args.tableNumber).trim();
      const match = raw.match(/^(?:t(?:able)?\s*)?(\d+)$/i);
      info.tableNumber = match ? match[1] : raw;
      info.orderType = 'dine-in';
    }

    if (args.orderType) {
      const ot = String(args.orderType).trim().toLowerCase();
      if (ot === 'takeaway' || ot === 'tapau' || ot === 'bawa balik' || ot === 'bungkus') {
        info.orderType = 'takeaway';
        delete info.tableNumber;
      } else {
        info.orderType = 'dine-in';
      }
    }

    if (!info.tableNumber && !info.orderType) {
      return { content: [{ type: 'text', text: 'Please provide a table number or specify takeaway/tapau.' }] };
    }

    const saved = cartSetTableInfo(sessionId, info);
    const desc = saved.orderType === 'takeaway'
      ? 'Takeaway order noted!'
      : `Table ${saved.tableNumber || ''} noted!`.trim();
    return { content: [{ type: 'text', text: desc }] };
  });
}
