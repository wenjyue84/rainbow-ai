/**
 * cart-handlers-special.ts — Special flow handlers
 *
 * Handles: cart_set_meal_choose, cart_allergen_confirm,
 *          order_modify_request, reorder_last_order
 */

import type { MCPToolResult } from '../types/mcp.js';
import {
  cartAddItem, cartGetItems, cartFormatSummary, cartSetTableInfo,
  type CartItem,
} from '../assistant/cart-store.js';
import { transitionOrderStage } from '../assistant/order-stage-store.js';
import {
  getPendingSetMeal, clearPendingSetMeal,
  getNextUnfilledChoice, fillChoice, allChoicesFilled,
  toCartComponents, formatChoicePrompt,
} from '../assistant/set-meal-store.js';
import type { SetMealComponent } from '../assistant/cart-store.js';
import { getPendingAllergenItem, clearPendingAllergenItem } from '../lib/allergen-pending-store.js';
import { isModificationAllowed, consumeModificationWindow } from '../assistant/order-modification-store.js';
import { fetchMenuItems } from './fnb-menu.js';

type HandlerMap = Map<string, (args: any) => Promise<MCPToolResult>>;

export function registerSpecialHandlers(handlers: HandlerMap, sessionId: string): void {

  // ─── Set Meal Choice Handler (US-865) ─────────────────────────
  handlers.set('cart_set_meal_choose', async (args: any) => {
    const selection: string = String(args.selection || '').trim();
    const pending = getPendingSetMeal(sessionId);
    if (!pending) {
      return { content: [{ type: 'text', text: 'There is no pending set meal to customise. Please order a set meal first.' }] };
    }
    const choiceIdx = getNextUnfilledChoice(pending);
    if (choiceIdx === -1) {
      clearPendingSetMeal(sessionId);
      return { content: [{ type: 'text', text: 'All choices have already been made. The set meal should be in your cart.' }] };
    }

    const choice = pending.choices[choiceIdx];
    const isSkip = /^(any|anything|skip|you choose|surprise me|whatever|apa-apa|apa saja|随便|都可以)$/i.test(selection);
    let selectedOption: string;

    if (isSkip) {
      selectedOption = choice.options[0];
    } else {
      const num = parseInt(selection, 10);
      if (!isNaN(num) && num >= 1 && num <= choice.options.length) {
        selectedOption = choice.options[num - 1];
      } else {
        const found = choice.options.find(o => o.toLowerCase().includes(selection.toLowerCase()));
        if (found) {
          selectedOption = found;
        } else {
          const optionLines = choice.options.map((opt, i) => `${i + 1}. ${opt}`);
          return {
            content: [{
              type: 'text',
              text: `Sorry, "${selection}" is not one of the options for ${choice.name}.\n\nPlease choose:\n${optionLines.join('\n')}\n\nOr say "any" to pick the default.`
            }]
          };
        }
      }
    }

    fillChoice(pending, choiceIdx, selectedOption);
    const defaultNote = isSkip ? ` (default: ${selectedOption})` : '';
    const confirmText = `${choice.name}: ${selectedOption}${defaultNote} ✓`;

    if (!allChoicesFilled(pending)) {
      return { content: [{ type: 'text', text: `${confirmText}\n\n${formatChoicePrompt(pending)}` }] };
    }

    const components: SetMealComponent[] = toCartComponents(pending);
    const item: CartItem = {
      name: pending.name, code: pending.code, qty: pending.qty,
      price: pending.price, notes: pending.notes, components,
    };
    const items = cartAddItem(sessionId, item);
    clearPendingSetMeal(sessionId);
    const summary = cartFormatSummary(items);
    return {
      content: [{
        type: 'text',
        text: `${confirmText}\n\nAll choices made! Added ${pending.qty}x ${pending.name} to your cart.\n\nCurrent cart:\n${summary}`
      }]
    };
  });

  // ─── Allergen Confirmation Handler (US-877) ────────────────────
  handlers.set('cart_allergen_confirm', async (_args: any) => {
    const pending = getPendingAllergenItem(sessionId);
    if (!pending) {
      return {
        content: [{ type: 'text', text: 'There is no pending item waiting for allergen confirmation. Please add an item to your cart first.' }]
      };
    }
    clearPendingAllergenItem(sessionId);
    const items = cartAddItem(sessionId, pending.item);
    transitionOrderStage(sessionId, 'ORDERING');
    const priceStr = pending.item.price !== undefined ? ` (RM ${pending.item.price.toFixed(2)})` : '';
    return {
      content: [{
        type: 'text',
        text: `Added ${pending.item.qty}x ${pending.item.name}${priceStr} to your cart.\n\nCurrent cart:\n${cartFormatSummary(items)}`
      }]
    };
  });

  // ─── US-881: Order Modification Request ─────────────────────────
  handlers.set('order_modify_request', async (_args: any) => {
    const check = isModificationAllowed(sessionId);
    if (!check.allowed) {
      if (check.reason === 'no_order') {
        return { content: [{ type: 'text', text: 'There is no recent order to modify. Would you like to start a new order?' }] };
      }
      if (check.reason === 'kitchen_accepted') {
        return {
          content: [{ type: 'text', text: 'Sorry, the kitchen has already accepted your order so changes can no longer be made. Please contact our staff if you need assistance.' }]
        };
      }
      return {
        content: [{ type: 'text', text: 'Sorry, the modification window has expired. Your order is being prepared. Please contact our staff if you need to make changes.' }]
      };
    }
    const snapshot = consumeModificationWindow(sessionId);
    if (!snapshot) {
      return { content: [{ type: 'text', text: 'There is no recent order to modify. Would you like to start a new order?' }] };
    }
    for (const item of snapshot.items) {
      cartAddItem(sessionId, { ...item });
    }
    if (snapshot.tableInfo) {
      cartSetTableInfo(sessionId, snapshot.tableInfo);
    }
    transitionOrderStage(sessionId, 'ORDERING');
    const summary = cartFormatSummary(cartGetItems(sessionId));
    return {
      content: [{
        type: 'text',
        text: `Your order has been re-opened for changes. Here are your current items:\n\n${summary}\n\nYou can add, remove, or change items. When you're done, just say "place my order".`
      }]
    };
  });

  // ─── US-897: Reorder Last Order ─────────────────────────────────
  handlers.set('reorder_last_order', async (_args: any) => {
    const { getLastOrder } = await import('../assistant/order-history-store.js');
    const phone = 'webchat-' + sessionId;
    const lastOrder = await getLastOrder(phone);
    if (!lastOrder || lastOrder.items.length === 0) {
      return {
        content: [{ type: 'text', text: "I don't have a previous order on file for this session. Would you like to browse the menu instead?" }]
      };
    }
    const menuItems = await fetchMenuItems();
    const unavailableNameSet = new Set(
      menuItems.filter(m => m.available === false).map(m => m.name.toLowerCase())
    );
    const added: string[] = [];
    const omitted: string[] = [];
    for (const item of lastOrder.items) {
      if (unavailableNameSet.has(item.name.toLowerCase())) {
        omitted.push(item.name);
        continue;
      }
      cartAddItem(sessionId, { name: item.name, code: item.code, qty: item.qty, price: item.price, notes: item.notes });
      added.push(`${item.qty}x ${item.name}`);
    }
    if (added.length > 0) transitionOrderStage(sessionId, 'ORDERING');
    const items = cartGetItems(sessionId);
    const summary = cartFormatSummary(items);
    let response = `Welcome back! I've added your previous order to the cart:\n\n${summary}`;
    if (omitted.length > 0) {
      response += `\n\nNote: ${omitted.join(', ')} ${omitted.length === 1 ? 'is' : 'are'} currently unavailable and ${omitted.length === 1 ? 'has' : 'have'} been omitted.`;
    }
    response += '\n\nWould you like to place this order, or make any changes?';
    return { content: [{ type: 'text', text: response }] };
  });
}
