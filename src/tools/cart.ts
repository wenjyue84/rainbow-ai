/**
 * cart.ts — Conversational cart MCP tools for the AI waiter
 *
 * These tools are injected per-request in webchat-api.ts, with handlers
 * closing over the sessionId so the AI can mutate the correct cart.
 */

import type { MCPTool, MCPToolResult } from '../types/mcp.js';
import {
  cartAddItem, cartRemoveItem, cartGetItems, cartClear,
  cartUpdateItemQty, cartSetItemNotes, cartFormatSummary,
  cartSetTableInfo, cartGetTableInfo,
  type CartItem, type TableInfo
} from '../assistant/cart-store.js';
import {
  transitionOrderStage, clearOrderStage, getOrderStage,
} from '../assistant/order-stage-store.js';
import { fnbCreateOrder, fnbGetOrderStatus, fnbGetKitchenStatus } from './fnb-orders.js';
import { setSessionOrderId, getSessionOrderId } from '../assistant/order-id-store.js';
import { hasUpsellBeenOffered, markUpsellOffered, getUpsellSuggestion } from '../assistant/upsell-tracker.js';
import {
  setDisambiguation, getDisambiguation, clearDisambiguation,
  formatDisambiguationList, type DisambiguationCandidate,
} from '../assistant/disambiguation-store.js';
import {
  startSetMeal, getPendingSetMeal, clearPendingSetMeal,
  getNextUnfilledChoice, fillChoice, allChoicesFilled,
  toCartComponents, formatChoicePrompt,
} from '../assistant/set-meal-store.js';
import type { SetMealComponent } from '../assistant/cart-store.js';
import { fetchMenuItems } from './fnb-menu.js';
import { findMenuItemMatches } from '../assistant/menu-matcher.js';
import { getAllergenEntry, formatAllergenWarning } from '../lib/allergen-store.js';
import {
  setPendingAllergenItem, getPendingAllergenItem, clearPendingAllergenItem,
} from '../lib/allergen-pending-store.js';
import { sendToKds, buildKdsPayload, type KdsWebhookResult } from '../lib/kds-webhook.js';
import {
  startModificationWindow, isModificationAllowed, consumeModificationWindow,
  getModificationTimeRemaining,
} from '../assistant/order-modification-store.js';
import { saveOrderHistory } from '../assistant/order-history-store.js';
import {
  markConfirmationShown, markCorrected, recordOrderSubmitted,
  recordConfirmationDeclined, clearAccuracyTracking,
} from '../assistant/order-accuracy-tracker.js';
import { markCartCompleted } from '../assistant/cart-recovery.js';
import { orderItemExtractionSchema } from '../assistant/schemas.js';
import { recordValidationEvent } from '../assistant/llm-validation-metrics.js';

// ─── Tool Definitions ──────────────────────────────────────────────

export const cartTools: MCPTool[] = [
  {
    name: 'cart_add_item',
    description: 'Add a known item to the guest\'s cart. Use this when you already know the exact item name, code, and price. For set meals or combos, use cart_search_item instead — it detects choices and guides customisation. Transitions order stage to ORDERING. Malay triggers: "saya nak X", "boleh bagi X", "satu X", "tolong bagi X". Manglish: "can I have X lah", "I want X lah".',
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
    description: 'Remove an item from the guest\'s cart. Use this when the guest says remove, cancel, drop, or forget an item. Malay: "tak nak X", "buang X", "cancel X", "tak jadi X".',
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
  {
    name: 'cart_update_qty',
    description: [
      'Update the quantity of an item already in the guest\'s cart.',
      'Use when the guest says "make it 2", "change the teh tarik to 3", "I want 2 of those", "update to X".',
      'If qty is 0 the item is removed from the cart.',
      'If the named item is not in the cart, tell the guest it is not in their order yet.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the menu item to update (e.g. "Nasi Lemak")' },
        qty: { type: 'number', description: 'New quantity. Set to 0 to remove the item.' }
      },
      required: ['name', 'qty']
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'cart_set_item_notes',
    description: [
      'Attach or update special instructions on an item already in the cart.',
      'Use this when the guest says things like "no onion", "extra spicy", "less sugar", "without ice", "add sambal on the side".',
      'The notes are appended to any existing notes on the item.',
      'If the cart has only one item, apply the instruction to that item.',
      'If there are multiple items and the instruction is ambiguous (guest did not name the item), ask which item it applies to before calling this tool.',
      'Common patterns: "no X", "extra X", "less X", "without X", "add X on the side", "X on the side".',
      'Malay patterns: "kurang manis" (less sugar), "pedas sikit" (a little spicy), "tanpa bawang" (no onion), "tanpa ais" (no ice), "tambah sambal" (extra sambal), "kosong" (plain/no sugar no milk), "lebih pedas" (extra spicy), "suam" (warm). Translate to English before passing as notes.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the cart item to attach the note to' },
        notes: { type: 'string', description: 'Special instruction text (e.g. "no onion", "extra spicy", "less sugar")' }
      },
      required: ['name', 'notes']
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'cart_set_table',
    description: [
      'Set the table number or order type (dine-in / takeaway) for this order.',
      'Call this after the guest provides their table number or says takeaway/tapau.',
      'Accepts patterns: "table 5", "T5", "table5", "takeaway", "tapau", "bawa balik", "bungkus", "dine-in", "dine in".',
      'Only call this once per session — do not ask again if already set.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        tableNumber: { type: 'string', description: 'Table number (e.g. "5", "T5"). Omit if takeaway.' },
        orderType: { type: 'string', enum: ['dine-in', 'takeaway'], description: 'Order type: "dine-in" or "takeaway"' }
      }
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
  },
  {
    name: 'cart_cancel_order',
    description: [
      'Cancel the entire order and clear the cart. Use when the guest says:',
      '"cancel my order", "forget it", "start over", "clear my cart", "nevermind", "I changed my mind", "scratch that".',
      'Acts immediately — no confirmation required.',
      '• If cart is empty (nothing to cancel), tell the guest there is nothing to cancel.',
      '• If order is already in the kitchen (PLACED stage), tell the guest and offer to contact staff.',
      '• Otherwise, clear the cart and reset to BROWSING.',
      'Do NOT use this to cancel a single item — use cart_remove_item for that.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {}
    },
    allowedProfiles: ['makan-moments']
  },
  // ─── Order Status Tool ──────────────────────────────────────────
  {
    name: 'order_check_status',
    description: [
      'Check the status of the guest\'s placed order.',
      'Use when the guest asks "where is my order?", "how long more?", "is my food ready?", "check my order".',
      'Automatically uses the session\'s last placed order ID. If the guest provides an order ID (e.g. "MM-A1B2"), pass it as orderId.',
      'If no order has been placed in this session and no orderId is provided, tells the guest there is no active order.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'Order ID (e.g. "MM-A1B2"). Optional — auto-detected from session if omitted.' }
      }
    },
    allowedProfiles: ['makan-moments']
  },
  // ─── Disambiguation Tools ────────────────────────────────────────
  {
    name: 'cart_search_item',
    description: [
      'Search the menu for an item by name and add it to cart if unambiguous.',
      'Use this instead of cart_add_item when the guest uses a partial or vague name (e.g. "the chicken", "nasi", "something spicy").',
      'Also use this for set meals and combos — it detects items with choices and guides the guest through customisation.',
      '• Single match (regular item) → item is added to cart automatically.',
      '• Single match (set meal/combo) → starts choice-by-choice customisation flow.',
      '• Multiple matches → shows a numbered list and asks the guest to choose.',
      '• No match → apologises and offers to show the full menu.',
      'If there is already a pending disambiguation, the guest may reply with a number — use cart_pick_item for that.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the guest is looking for (e.g. "chicken", "nasi lemak", "iced coffee")' },
        qty: { type: 'number', description: 'Quantity to add if a single match is found (default 1)' },
        notes: { type: 'string', description: 'Special instructions for this item (optional)' }
      },
      required: ['query']
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'cart_pick_item',
    description: [
      'Select an item from a pending disambiguation list by number or name.',
      'Use this when the guest replies with a number (e.g. "1", "number 2") or a more specific name after you showed them a disambiguation list.',
      'The selected item is added to the cart. If there is no pending disambiguation, this tool does nothing useful.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        selection: { type: 'string', description: 'The guest\'s selection — a number (e.g. "2") or a name (e.g. "Chicken Rice")' },
        qty: { type: 'number', description: 'Quantity to add (default 1)' },
        notes: { type: 'string', description: 'Special instructions for this item (optional)' }
      },
      required: ['selection']
    },
    allowedProfiles: ['makan-moments']
  },
  // ─── Set Meal / Combo Tools ────────────────────────────────────
  {
    name: 'cart_set_meal_choose',
    description: [
      'Select an option for a pending set meal / combo customisation.',
      'Use this when the guest is choosing a component for their set meal (e.g. picking a drink or side).',
      'The guest can reply with a number (e.g. "1", "2") or the option name (e.g. "Teh Tarik").',
      'If the guest says "any", "anything", "you choose", or "skip", the first/default option is chosen.',
      'After all choices are filled, the set meal is automatically added to the cart.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        selection: { type: 'string', description: 'The guest\'s choice — a number (e.g. "1") or option name (e.g. "Teh Tarik"), or "any"/"skip" for default' }
      },
      required: ['selection']
    },
    allowedProfiles: ['makan-moments']
  },
  // ─── Allergen Confirmation Tool (US-877) ──────────────────────
  {
    name: 'cart_allergen_confirm',
    description: [
      'Confirm adding a pending item to the cart after the guest has acknowledged the allergen warning.',
      'Use this ONLY when you have already shown the guest an allergen warning (via cart_search_item or cart_add_item) and they reply with "yes", "ok", "proceed", "confirm", or equivalent affirmative.',
      'If the guest is not responding to an allergen warning, use cart_add_item or cart_search_item instead.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {}
    },
    allowedProfiles: ['makan-moments']
  },
  // ─── Order Modification Tool (US-881) ───────────────────────────
  {
    name: 'order_modify_request',
    description: [
      'Re-open a recently placed order for modification within the allowed time window.',
      'Use when the guest says "change order", "modify order", "I made a mistake", "wait I want to change", "tukar order", "ubah order" AFTER their order was already placed.',
      'If the modification window has expired or the kitchen has already accepted, tells the guest politely that changes are no longer possible.',
      'If allowed, re-populates the cart with the original items and transitions back to ORDERING stage.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {}
    },
    allowedProfiles: ['makan-moments']
  },
  // ─── Reorder Last Order Tool (US-897) ──────────────────────────────
  {
    name: 'reorder_last_order',
    description: [
      'Populate the cart with the guest\'s most recent completed order.',
      'Use when the guest says "yes" to the "Order your usual again?" prompt,',
      'or when they say "reorder", "same as last time", "order lagi", "sama macam semalam".',
      'Checks each item for current menu availability and omits out-of-stock items with a notification.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {}
    },
    allowedProfiles: ['makan-moments']
  }
];

// ─── Handler Factories ─────────────────────────────────────────────

/** Options for creating per-session cart handlers */
export interface CartHandlerOptions {
  /** Available payment methods for the profile (US-867). Default: ['cash'] */
  paymentMethods?: string[];
  /** Kitchen queue warning thresholds (US-868) */
  kitchenQueue?: {
    queueWarningThreshold?: number;
    waitTimeWarningMinutes?: number;
  };
  /** US-876: KDS/POS webhook integration */
  kds?: {
    enabled?: boolean;
    opsNotifyPhone?: string;
    profileId?: string;
  };
  /** US-881: Order modification window in milliseconds. Default: 120000 (2 min) */
  modificationWindowMs?: number;
}

/**
 * Build a brief, multilingual-ready payment guidance string from configured methods.
 * Returns empty string if no methods configured.
 */
function formatPaymentGuidance(methods: string[]): string {
  if (!methods || methods.length === 0) return '';

  const labels: Record<string, string> = {
    cash: 'cash',
    qr: 'QR code at the counter',
    card: 'card',
    online: 'online payment',
  };
  const readable = methods.map(m => labels[m.toLowerCase()] || m);

  if (readable.length === 1) {
    return `\n\nYou can pay by ${readable[0]} when ready.`;
  }
  const last = readable.pop();
  return `\n\nYou can pay by ${readable.join(', ')} or ${last} when ready.`;
}

/**
 * Create per-session cart handlers that close over the sessionId.
 * Call this once per webchat request and merge the result into the tool handlers map.
 */
/**
 * Check kitchen status and return a warning string if the kitchen is busy.
 * Returns empty string if kitchen is not busy or status unavailable (non-blocking).
 */
async function getKitchenWarning(queueThreshold: number, waitThreshold: number): Promise<string> {
  try {
    const result = await fnbGetKitchenStatus();
    if (result.isError) return '';

    const text = result.content.map((c: any) => c.text || '').join('\n').trim();
    if (!text) return '';

    // Extract pending order count
    const pendingMatch = text.match(/pending[:\s]*(\d+)/i)
      || text.match(/queue[:\s]*(\d+)/i)
      || text.match(/orders?[:\s]*(\d+)/i);
    const pendingCount = pendingMatch ? parseInt(pendingMatch[1], 10) : 0;

    // Extract estimated wait time in minutes
    const waitMatch = text.match(/(?:estimated?|wait|eta)[:\s]*(\d+)\s*(?:min|minute)/i);
    const waitMinutes = waitMatch ? parseInt(waitMatch[1], 10) : 0;

    if (pendingCount > queueThreshold || waitMinutes > waitThreshold) {
      const waitStr = waitMinutes > 0
        ? `about ${waitMinutes} minutes`
        : `about ${Math.max(waitThreshold, 25)} minutes`;
      return `\n\n⚠️ Note: Kitchen is currently busy. Estimated wait is ${waitStr}.`;
    }
  } catch {
    // Non-blocking: silently skip if anything fails
  }
  return '';
}

export function createCartHandlers(sessionId: string, options?: CartHandlerOptions): Map<string, (args: any) => Promise<MCPToolResult>> {
  const paymentMethods = options?.paymentMethods ?? ['cash'];
  const queueThreshold = options?.kitchenQueue?.queueWarningThreshold ?? 5;
  const waitThreshold = options?.kitchenQueue?.waitTimeWarningMinutes ?? 20;
  // US-876: KDS webhook config
  const kdsEnabled = options?.kds?.enabled ?? false;
  const kdsOpsPhone = options?.kds?.opsNotifyPhone ?? '';
  const kdsProfileId = options?.kds?.profileId ?? 'makan-moments';
  // US-881: Order modification window (default 2 minutes)
  const modificationWindowMs = options?.modificationWindowMs ?? 2 * 60 * 1000;
  const handlers = new Map<string, (args: any) => Promise<MCPToolResult>>();

  handlers.set('cart_add_item', async (args: any) => {
    // US-933 AC3: Validate order extraction output against schema before cart mutation
    const validation = orderItemExtractionSchema.safeParse(args);
    if (!validation.success) {
      const errors = validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      console.warn(`[Cart] cart_add_item schema validation failed: ${errors}`, JSON.stringify(args));
      recordValidationEvent('cart_add_item', false, false, errors);
      // Attempt graceful recovery with coerced values
      if (!args.name || typeof args.name !== 'string' || args.name.trim().length === 0) {
        return {
          content: [{ type: 'text', text: 'Could not add item: item name is missing or invalid.' }],
          isError: true
        };
      }
    } else {
      recordValidationEvent('cart_add_item', true);
    }

    const item: CartItem = {
      name: args.name,
      qty: typeof args.qty === 'number' && args.qty > 0 ? Math.floor(args.qty) : 1,
      code: args.code || undefined,
      price: typeof args.price === 'number' ? args.price : undefined,
      notes: args.notes || undefined
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
            text: `${warning}\n\nWould you like to add ${item.qty}x ${item.name} to your cart? Reply *YES* to confirm or *NO* to cancel.`
          }]
        };
      }
    }

    // US-902: If modifying cart while in CONFIRMING stage, record correction
    if (getOrderStage(sessionId) === 'CONFIRMING') markCorrected(sessionId);

    // No allergen data — add item and show advisory
    const items = cartAddItem(sessionId, item);
    // Transition stage to ORDERING when an item is added
    transitionOrderStage(sessionId, 'ORDERING');
    const summary = cartFormatSummary(items);
    const allergenAdvisory = item.code
      ? '' // Known item with no allergen data on file — skip advisory to avoid noise
      : '\n\n⚠️ Please inform our staff of any allergies before ordering.';

    // US-857: Suggest an upsell after first main item is added
    let upsellMessage = '';
    if (!hasUpsellBeenOffered(sessionId) && item.code) {
      // Only suggest upsell for items with a code (known menu items)
      const { message } = getUpsellSuggestion(args.category);
      markUpsellOffered(sessionId);
      upsellMessage = `\n\n${message}`;
    }

    return {
      content: [{
        type: 'text',
        text: `Added ${item.qty}x ${item.name} to cart.${allergenAdvisory}\n\nCurrent cart:\n${summary}${upsellMessage}`
      }]
    };
  });

  handlers.set('cart_remove_item', async (args: any) => {
    // US-902: If modifying cart while in CONFIRMING stage, record correction
    if (getOrderStage(sessionId) === 'CONFIRMING') markCorrected(sessionId);

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
          text: `"${name}" is not in your order yet. Would you like me to add it?`
        }]
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
        content: [{ type: 'text', text: `Removed ${name} from your cart (quantity set to 0).${cartMsg}` }]
      };
    }

    const summary = cartFormatSummary(items);
    return {
      content: [{ type: 'text', text: `Updated ${name} to ${qty}x.\n\nCurrent cart:\n${summary}` }]
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
    clearPendingSetMeal(sessionId);
    clearOrderStage(sessionId);
    return {
      content: [{ type: 'text', text: 'Cart cleared.' }]
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
      // If only one item in cart, suggest it
      const currentItems = cartGetItems(sessionId);
      if (currentItems.length === 1) {
        const only = currentItems[0];
        return {
          content: [{
            type: 'text',
            text: `"${name}" is not in the cart. Did you mean ${only.name}? Please confirm and I'll add the note "${notes}" to it.`
          }]
        };
      }
      return {
        content: [{
          type: 'text',
          text: `"${name}" is not in your cart. Please check your order and tell me which item you'd like to add the note to.`
        }]
      };
    }

    const summary = cartFormatSummary(items);
    return {
      content: [{
        type: 'text',
        text: `Got it! Added "${notes}" to ${name}.\n\nCurrent cart:\n${summary}`
      }]
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
        delete info.tableNumber; // No table for takeaway
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

  // ─── Order Stage Handlers ────────────────────────────────────────

  handlers.set('order_request_confirmation', async (_args: any) => {
    const items = cartGetItems(sessionId);
    if (items.length === 0) {
      return {
        content: [{ type: 'text', text: 'The cart is empty. Please add items before placing an order.' }]
      };
    }
    transitionOrderStage(sessionId, 'CONFIRMING');
    // US-902: Track that confirmation was shown for accuracy KPI
    markConfirmationShown(sessionId);
    const summary = cartFormatSummary(items);
    const tableInfo = cartGetTableInfo(sessionId);
    const tableLine = tableInfo
      ? tableInfo.orderType === 'takeaway'
        ? '\nOrder type: Takeaway'
        : tableInfo.tableNumber
          ? `\nTable: ${tableInfo.tableNumber}`
          : '\nOrder type: Dine-in'
      : '';

    // US-868: Check kitchen queue status (non-blocking)
    const kitchenWarning = await getKitchenWarning(queueThreshold, waitThreshold);

    return {
      content: [{
        type: 'text',
        text: `Here is your order summary:\n\n${summary}${tableLine}${kitchenWarning}\n\nShall I place this order? Reply YES to confirm or tell me what to change.`
      }]
    };
  });

  handlers.set('order_confirm_submit', async (args: any) => {
    // US-950 AC2: Enforce confirmation step — order can only be submitted from CONFIRMING stage
    if (getOrderStage(sessionId) !== 'CONFIRMING') {
      return {
        content: [{
          type: 'text',
          text: 'Please call order_request_confirmation first to show the guest an order summary before submitting.'
        }]
      };
    }

    const items = cartGetItems(sessionId);
    if (items.length === 0) {
      return {
        content: [{ type: 'text', text: 'The cart is empty. Nothing to submit.' }]
      };
    }
    const summary = cartFormatSummary(items);

    // Resolve table info: prefer stored session state, fall back to args
    const storedTable = cartGetTableInfo(sessionId);
    const effectiveTableNumber = args.tableNumber || storedTable?.tableNumber;
    const effectiveOrderType = storedTable?.orderType || (args.tableNumber ? 'dine-in' : undefined);

    let tableDesc = '';
    if (effectiveOrderType === 'takeaway') {
      tableDesc = ' (Takeaway)';
    } else if (effectiveTableNumber) {
      tableDesc = ` for table ${effectiveTableNumber}`;
    }

    // Build FnB MCP payload — only include items that have a menu code
    const codedItems = items
      .filter(i => i.code)
      .map(i => ({
        code: i.code as string,
        qty: i.qty,
        ...(i.notes ? { notes: i.notes } : {})
      }));

    let orderAck = '';
    let placedOrderId = `ORD-${Date.now()}`;

    // Build notes for FnB MCP with table/order type info
    const fnbNotes: string[] = [];
    if (effectiveTableNumber) fnbNotes.push(`Table: ${effectiveTableNumber}`);
    if (effectiveOrderType) fnbNotes.push(`Type: ${effectiveOrderType}`);

    if (codedItems.length > 0) {
      // Call FnB MCP to create the order
      const fnbResult = await fnbCreateOrder({
        items: codedItems,
        phone: 'webchat-' + sessionId,
        estimated_arrival: new Date().toISOString(),
        ...(fnbNotes.length > 0 ? { notes: fnbNotes.join(', ') } : {}),
        ...(effectiveTableNumber ? { tableNumber: effectiveTableNumber } : {}),
        ...(effectiveOrderType ? { orderType: effectiveOrderType } : {}),
      });

      if (!fnbResult.isError) {
        // Surface order ID and estimated wait from FnB response
        const fnbText = fnbResult.content.map((c: any) => c.text || '').join('\n').trim();
        orderAck = fnbText
          ? `\n\n${fnbText}`
          : '\n\nEstimated wait time: 15–20 minutes.';

        // Extract and store order ID for later status checks (US-855)
        const orderIdMatch = fnbText.match(/\b(MM-[A-Z0-9]{4,})\b/i)
          || fnbText.match(/order\s*(?:id|#|number)?[:\s]*([A-Za-z0-9-]{4,})/i);
        const extractedOrderId = orderIdMatch ? (orderIdMatch[1] || orderIdMatch[0]) : placedOrderId;
        placedOrderId = extractedOrderId;
        if (orderIdMatch) {
          setSessionOrderId(sessionId, extractedOrderId);
        }

        // US-876: Fire-and-forget KDS webhook for kitchen display
        if (kdsEnabled) {
          const kdsPayload = buildKdsPayload({
            orderId: extractedOrderId,
            items: items.map(i => ({ name: i.name, code: i.code, qty: i.qty, notes: i.notes })),
            tableNumber: effectiveTableNumber,
            orderType: effectiveOrderType,
            jid: 'webchat-' + sessionId,
            profileId: kdsProfileId,
          });
          sendToKds(kdsPayload, kdsOpsPhone).then((kdsResult: KdsWebhookResult) => {
            if (kdsResult.posStatus === 'rejected' && kdsResult.posMessage) {
              // POS rejected — log for admin visibility (customer already notified of order sent)
              console.warn(`[KDS] Order ${extractedOrderId} rejected by POS: ${kdsResult.posMessage}`);
            }
          }).catch(() => { /* retry queue handles failures */ });
        }
      } else {
        // FnB system unavailable — still acknowledge and notify
        orderAck = '\n\nOur staff has been notified and will prepare your order shortly.';
      }
    } else {
      // No coded items — order captured internally, staff will handle
      orderAck = '\n\nOur staff has been notified and will prepare your order shortly.';
    }

    // US-881: Snapshot order for modification window before clearing cart
    const snapshotItems = items.map(i => ({ ...i }));
    const snapshotTable = storedTable ? { ...storedTable } : undefined;

    // US-897: Save order history for returning-customer feature (fire-and-forget)
    saveOrderHistory('webchat-' + sessionId, placedOrderId, snapshotItems).catch(err => {
      console.error('[OrderHistory] Save failed:', err.message);
    });

    // US-902: Record order accuracy events (fire-and-forget)
    recordOrderSubmitted(sessionId, kdsProfileId || 'makan-moments').catch(err => {
      console.error('[OrderAccuracy] Record failed:', err.message);
    });

    // Transition to PLACED and clear cart
    transitionOrderStage(sessionId, 'PLACED');
    cartClear(sessionId);
    clearOrderStage(sessionId);

    // US-917: Mark abandoned cart as completed (converted) if applicable
    markCartCompleted(sessionId).catch(err => {
      console.error('[CartRecovery] Mark completed failed:', err.message);
    });

    // US-881: Start modification window
    if (modificationWindowMs > 0) {
      startModificationWindow(sessionId, placedOrderId, snapshotItems, snapshotTable, modificationWindowMs);
    }

    // US-867: Append payment method guidance after successful order placement
    const paymentGuidance = formatPaymentGuidance(paymentMethods);

    // US-868: Include kitchen wait time in acknowledgement
    const kitchenWarning = await getKitchenWarning(queueThreshold, waitThreshold);

    // US-881: Modification window notice
    const modWindowMinutes = Math.round(modificationWindowMs / 60000);
    const modNotice = modificationWindowMs > 0
      ? `\n\nYou have ${modWindowMinutes} minute${modWindowMinutes !== 1 ? 's' : ''} to request changes. Just say "change order" if you need to modify anything.`
      : '';

    return {
      content: [{
        type: 'text',
        text: `Your order${tableDesc} has been sent to the kitchen!\n\n${summary}${orderAck}${kitchenWarning}${paymentGuidance}${modNotice}\n\nThank you! Please let us know if you need anything else.`
      }]
    };
  });

  handlers.set('order_back_to_cart', async (_args: any) => {
    // US-950 AC5: Record that guest declined at the confirmation step
    if (getOrderStage(sessionId) === 'CONFIRMING') {
      recordConfirmationDeclined(sessionId, kdsProfileId).catch(() => {});
    }
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

  handlers.set('cart_cancel_order', async (_args: any) => {
    const stage = getOrderStage(sessionId);

    // Order already sent to kitchen — cannot cancel
    if (stage === 'PLACED') {
      return {
        content: [{
          type: 'text',
          text: 'Your order has already been sent to the kitchen and cannot be cancelled here. Please speak to our staff directly and they will assist you.'
        }]
      };
    }

    const items = cartGetItems(sessionId);

    // Nothing to cancel
    if (items.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'There is nothing to cancel — your cart is already empty. Let me know if you would like to order something!'
        }]
      };
    }

    // US-950 AC5: If cancelling from CONFIRMING stage, record confirmation_declined event
    if (stage === 'CONFIRMING') {
      recordConfirmationDeclined(sessionId, kdsProfileId).catch(() => {});
    }

    // Clear cart, pending set meals, and reset to BROWSING
    cartClear(sessionId);
    clearPendingSetMeal(sessionId);
    clearOrderStage(sessionId);
    // US-902: Clear accuracy tracking on cancel (no order to count; declined already recorded above if CONFIRMING)
    clearAccuracyTracking(sessionId);
    return {
      content: [{
        type: 'text',
        text: 'Your order has been cleared. Let me know if you would like to start a new order!'
      }]
    };
  });

  // ─── Order Status Handler (US-855) ─────────────────────────────

  handlers.set('order_check_status', async (args: any) => {
    // Resolve order ID: explicit arg > session store
    const orderId = (args.orderId && String(args.orderId).trim())
      || getSessionOrderId(sessionId);

    if (!orderId) {
      return {
        content: [{
          type: 'text',
          text: 'There is no active order for you yet. Place an order first and then you can check its status!'
        }]
      };
    }

    const result = await fnbGetOrderStatus({ orderId });

    if (result.isError) {
      return {
        content: [{
          type: 'text',
          text: `I wasn't able to check the status of order ${orderId} right now. Please try again in a moment or ask our staff for an update.`
        }]
      };
    }

    // Map raw status codes to guest-friendly descriptions
    const statusMap: Record<string, string> = {
      'pending':    'Received — your order has been received and is waiting to be prepared.',
      'received':   'Received — your order has been received and is waiting to be prepared.',
      'confirmed':  'Received — your order has been confirmed and will be prepared shortly.',
      'approved':   'Received — your order has been approved and will be prepared shortly.',
      'preparing':  'Preparing — the kitchen is working on your order right now!',
      'cooking':    'Preparing — the kitchen is working on your order right now!',
      'in_progress':'Preparing — the kitchen is working on your order right now!',
      'ready':      'Ready — your order is ready for pickup/serving!',
      'completed':  'Served — your order has been completed. Enjoy your meal!',
      'served':     'Served — your order has been completed. Enjoy your meal!',
      'cancelled':  'Cancelled — this order has been cancelled.',
    };

    const rawText = result.content.map((c: any) => c.text || '').join('\n').trim();

    // Try to extract and map the status
    const statusMatch = rawText.match(/status[:\s]*["']?(\w+)["']?/i);
    const rawStatus = statusMatch?.[1]?.toLowerCase();
    const friendlyStatus = rawStatus ? statusMap[rawStatus] : null;

    // Extract estimated wait time if present
    const waitMatch = rawText.match(/(?:estimated?|wait|eta|time)[:\s]*(\d+[\s-]*\d*\s*(?:min(?:ute)?s?|hours?))/i);
    const waitTime = waitMatch ? `\nEstimated wait: ${waitMatch[1]}` : '';

    if (friendlyStatus) {
      return {
        content: [{
          type: 'text',
          text: `Order ${orderId}: ${friendlyStatus}${waitTime}`
        }]
      };
    }

    // Fallback: return the raw FnB response if we couldn't parse it
    return {
      content: [{
        type: 'text',
        text: `Order ${orderId} status:\n${rawText}${waitTime}`
      }]
    };
  });

  // ─── Disambiguation Handlers ─────────────────────────────────────

  handlers.set('cart_search_item', async (args: any) => {
    const query: string = String(args.query || '').trim();
    const qty: number = typeof args.qty === 'number' && args.qty > 0 ? Math.floor(args.qty) : 1;
    const notes: string | undefined = args.notes || undefined;

    if (!query) {
      return { content: [{ type: 'text', text: 'Please tell me what item you are looking for.' }] };
    }

    // Fetch menu items from FnB MCP
    const menuItems = await fetchMenuItems();

    if (menuItems.length === 0) {
      // FnB system unavailable — fall back to direct cart_add_item behaviour
      const items = cartAddItem(sessionId, { name: query, qty, notes });
      transitionOrderStage(sessionId, 'ORDERING');
      return {
        content: [{
          type: 'text',
          text: `Added ${qty}x ${query} to your cart.\n\nCurrent cart:\n${cartFormatSummary(items)}`
        }]
      };
    }

    const matches = findMenuItemMatches(query, menuItems);

    if (matches.length === 0) {
      clearDisambiguation(sessionId);
      return {
        content: [{
          type: 'text',
          text: `Sorry, I couldn't find anything matching "${query}" on the menu.\n\nWould you like me to show you the full menu, or can you describe what you're looking for?`
        }]
      };
    }

    // ─── Out-of-stock handling (US-854) ──────────────────────────────
    // Check if the top match(es) are unavailable and suggest alternatives
    const unavailableMatch = matches.find(m => m.available === false);
    const availableMatches = matches.filter(m => m.available !== false);

    // If the best match is unavailable (single match or top match is the one they wanted)
    if (matches.length === 1 && unavailableMatch) {
      clearDisambiguation(sessionId);
      // Fetch alternatives from the same category
      const category = unavailableMatch.category;
      let alternativesText = '';

      if (category) {
        const categoryItems = await fetchMenuItems(category);
        const alternatives = categoryItems
          .filter(item => item.available !== false && item.name.toLowerCase() !== unavailableMatch.name.toLowerCase())
          .slice(0, 3);

        if (alternatives.length > 0) {
          // Store alternatives as disambiguation so guest can pick one
          const state = { pendingItem: query, candidates: alternatives, createdAt: Date.now() };
          setDisambiguation(sessionId, state);
          const list = formatDisambiguationList(state);
          alternativesText = `\n\nHere are some similar items from ${category} you might enjoy:\n\n${list}\n\nWould you like any of these instead? (Reply with a number or name)`;
        }
      }

      if (!alternativesText) {
        alternativesText = '\n\nWould you like me to show you the full menu so you can pick something else?';
      }

      return {
        content: [{
          type: 'text',
          text: `Sorry, ${unavailableMatch.name} is currently out of stock.${alternativesText}`
        }]
      };
    }

    // Multiple matches — filter to available only if some are available
    const effectiveMatches = availableMatches.length > 0 ? availableMatches : matches;

    if (effectiveMatches.length === 1) {
      // Unambiguous match found
      clearDisambiguation(sessionId);
      const match = effectiveMatches[0];

      // US-865: Detect set meal / combo — if item has choices, start customisation flow
      if (match.choices && match.choices.length > 0) {
        const pending = startSetMeal(sessionId, {
          name: match.name,
          code: match.code,
          price: match.price,
          qty,
          notes,
          choices: match.choices,
        });
        transitionOrderStage(sessionId, 'ORDERING');
        const priceStr = match.price !== undefined ? ` (RM ${match.price.toFixed(2)})` : '';
        const prompt = formatChoicePrompt(pending);
        return {
          content: [{
            type: 'text',
            text: `Great choice! ${match.name}${priceStr} is a set meal with ${match.choices.length} choice${match.choices.length > 1 ? 's' : ''} to make.\n\n${prompt}`
          }]
        };
      }

      // Regular item — check allergens before adding to cart (US-877)
      const item: CartItem = { name: match.name, qty, code: match.code, price: match.price, notes };
      const priceStr = match.price !== undefined ? ` (RM ${match.price.toFixed(2)})` : '';

      if (match.code) {
        const allergenEntry = getAllergenEntry(match.code);
        const hasAllergens = allergenEntry && (allergenEntry.allergens.length > 0 || allergenEntry.dietary_flags.length > 0);
        if (hasAllergens) {
          const warning = formatAllergenWarning(match.code, match.name);
          setPendingAllergenItem(sessionId, item, warning);
          return {
            content: [{
              type: 'text',
              text: `${warning}\n\nWould you like to add ${qty}x ${match.name}${priceStr} to your cart? Reply *YES* to confirm or *NO* to cancel.`
            }]
          };
        }
      }

      const items = cartAddItem(sessionId, item);
      transitionOrderStage(sessionId, 'ORDERING');
      return {
        content: [{
          type: 'text',
          text: `Added ${qty}x ${match.name}${priceStr} to your cart.\n\nCurrent cart:\n${cartFormatSummary(items)}`
        }]
      };
    }

    // Multiple matches — store disambiguation state and ask guest to choose
    const state = { pendingItem: query, candidates: effectiveMatches, createdAt: Date.now() };
    setDisambiguation(sessionId, state);
    const list = formatDisambiguationList(state);

    return {
      content: [{
        type: 'text',
        text: `I found a few items that match "${query}":\n\n${list}\n\nWhich one would you like? (Reply with a number or the full name)`
      }]
    };
  });

  handlers.set('cart_pick_item', async (args: any) => {
    const selection: string = String(args.selection || '').trim();
    const qty: number = typeof args.qty === 'number' && args.qty > 0 ? Math.floor(args.qty) : 1;
    const notes: string | undefined = args.notes || undefined;

    const state = getDisambiguation(sessionId);

    if (!state || state.candidates.length === 0) {
      return {
        content: [{ type: 'text', text: 'There is no pending item selection. Please tell me what you would like to order.' }]
      };
    }

    let chosen: DisambiguationCandidate | undefined;

    // Try numeric selection first
    const num = parseInt(selection, 10);
    if (!isNaN(num) && num >= 1 && num <= state.candidates.length) {
      chosen = state.candidates[num - 1];
    } else {
      // Try name match (case-insensitive substring)
      const q = selection.toLowerCase();
      chosen = state.candidates.find(c => c.name.toLowerCase().includes(q));

      // If still not found, try fuzzy match within the candidate list
      if (!chosen) {
        const fuzzy = findMenuItemMatches(selection, state.candidates, { threshold: 3, maxResults: 1 });
        chosen = fuzzy[0];
      }
    }

    if (!chosen) {
      const list = formatDisambiguationList(state);
      return {
        content: [{
          type: 'text',
          text: `Sorry, I didn't recognise "${selection}". Please choose from:\n\n${list}`
        }]
      };
    }

    clearDisambiguation(sessionId);

    // US-865: If chosen item is a set meal, start customisation flow
    if (chosen.choices && chosen.choices.length > 0) {
      const pending = startSetMeal(sessionId, {
        name: chosen.name,
        code: chosen.code,
        price: chosen.price,
        qty,
        notes,
        choices: chosen.choices,
      });
      transitionOrderStage(sessionId, 'ORDERING');
      const priceStr = chosen.price !== undefined ? ` (RM ${chosen.price.toFixed(2)})` : '';
      const prompt = formatChoicePrompt(pending);
      return {
        content: [{
          type: 'text',
          text: `Great choice! ${chosen.name}${priceStr} is a set meal with ${chosen.choices.length} choice${chosen.choices.length > 1 ? 's' : ''} to make.\n\n${prompt}`
        }]
      };
    }

    // US-877: Check allergens before adding to cart
    const item: CartItem = { name: chosen.name, qty, code: chosen.code, price: chosen.price, notes };
    const priceStr = chosen.price !== undefined ? ` (RM ${chosen.price.toFixed(2)})` : '';

    if (chosen.code) {
      const allergenEntry = getAllergenEntry(chosen.code);
      const hasAllergens = allergenEntry && (allergenEntry.allergens.length > 0 || allergenEntry.dietary_flags.length > 0);
      if (hasAllergens) {
        const warning = formatAllergenWarning(chosen.code, chosen.name);
        setPendingAllergenItem(sessionId, item, warning);
        return {
          content: [{
            type: 'text',
            text: `${warning}\n\nWould you like to add ${qty}x ${chosen.name}${priceStr} to your cart? Reply *YES* to confirm or *NO* to cancel.`
          }]
        };
      }
    }

    const items = cartAddItem(sessionId, item);
    transitionOrderStage(sessionId, 'ORDERING');

    return {
      content: [{
        type: 'text',
        text: `Added ${qty}x ${chosen.name}${priceStr} to your cart.\n\nCurrent cart:\n${cartFormatSummary(items)}`
      }]
    };
  });

  // ─── Set Meal Choice Handler (US-865) ─────────────────────────

  handlers.set('cart_set_meal_choose', async (args: any) => {
    const selection: string = String(args.selection || '').trim();

    const pending = getPendingSetMeal(sessionId);
    if (!pending) {
      return {
        content: [{
          type: 'text',
          text: 'There is no pending set meal to customise. Please order a set meal first.'
        }]
      };
    }

    const choiceIdx = getNextUnfilledChoice(pending);
    if (choiceIdx === -1) {
      // All filled already — shouldn't happen, but handle gracefully
      clearPendingSetMeal(sessionId);
      return {
        content: [{
          type: 'text',
          text: 'All choices have already been made. The set meal should be in your cart.'
        }]
      };
    }

    const choice = pending.choices[choiceIdx];
    const isSkip = /^(any|anything|skip|you choose|surprise me|whatever|apa-apa|apa saja|随便|都可以)$/i.test(selection);

    let selectedOption: string;

    if (isSkip) {
      // Default to first option
      selectedOption = choice.options[0];
    } else {
      // Try numeric selection
      const num = parseInt(selection, 10);
      if (!isNaN(num) && num >= 1 && num <= choice.options.length) {
        selectedOption = choice.options[num - 1];
      } else {
        // Try name match (case-insensitive substring)
        const q = selection.toLowerCase();
        const found = choice.options.find(o => o.toLowerCase().includes(q));
        if (found) {
          selectedOption = found;
        } else {
          // No match — show options again
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

    // Fill the choice
    fillChoice(pending, choiceIdx, selectedOption);

    const defaultNote = isSkip ? ` (default: ${selectedOption})` : '';
    const confirmText = `${choice.name}: ${selectedOption}${defaultNote} ✓`;

    // Check if more choices remain
    if (!allChoicesFilled(pending)) {
      const nextPrompt = formatChoicePrompt(pending);
      return {
        content: [{
          type: 'text',
          text: `${confirmText}\n\n${nextPrompt}`
        }]
      };
    }

    // All choices filled — add to cart with components
    const components: SetMealComponent[] = toCartComponents(pending);
    const item: CartItem = {
      name: pending.name,
      code: pending.code,
      qty: pending.qty,
      price: pending.price,
      notes: pending.notes,
      components,
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
        content: [{
          type: 'text',
          text: 'There is no pending item waiting for allergen confirmation. Please add an item to your cart first.'
        }]
      };
    }

    clearPendingAllergenItem(sessionId);
    const items = cartAddItem(sessionId, pending.item);
    transitionOrderStage(sessionId, 'ORDERING');
    const priceStr = pending.item.price !== undefined ? ` (RM ${pending.item.price.toFixed(2)})` : '';
    const summary = cartFormatSummary(items);

    return {
      content: [{
        type: 'text',
        text: `Added ${pending.item.qty}x ${pending.item.name}${priceStr} to your cart.\n\nCurrent cart:\n${summary}`
      }]
    };
  });

  // ─── US-881: Order Modification Request ─────────────────────────
  handlers.set('order_modify_request', async (_args: any) => {
    const check = isModificationAllowed(sessionId);

    if (!check.allowed) {
      if (check.reason === 'no_order') {
        return {
          content: [{
            type: 'text',
            text: 'There is no recent order to modify. Would you like to start a new order?'
          }]
        };
      }
      if (check.reason === 'kitchen_accepted') {
        return {
          content: [{
            type: 'text',
            text: 'Sorry, the kitchen has already accepted your order so changes can no longer be made. Please contact our staff if you need assistance.'
          }]
        };
      }
      // window_expired
      return {
        content: [{
          type: 'text',
          text: 'Sorry, the modification window has expired. Your order is being prepared. Please contact our staff if you need to make changes.'
        }]
      };
    }

    // Window is still open — re-populate the cart from the snapshot
    const snapshot = consumeModificationWindow(sessionId);
    if (!snapshot) {
      return {
        content: [{
          type: 'text',
          text: 'There is no recent order to modify. Would you like to start a new order?'
        }]
      };
    }

    // Re-add items to cart
    for (const item of snapshot.items) {
      cartAddItem(sessionId, { ...item });
    }
    // Restore table info
    if (snapshot.tableInfo) {
      cartSetTableInfo(sessionId, snapshot.tableInfo);
    }
    // Set stage to ORDERING so the guest can add/remove/modify
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
        content: [{
          type: 'text',
          text: 'I don\'t have a previous order on file for this session. Would you like to browse the menu instead?'
        }]
      };
    }

    // Fetch current menu to check availability
    const menuItems = await fetchMenuItems();
    const menuNameSet = new Set(menuItems.map(m => m.name.toLowerCase()));
    const unavailableItems = menuItems.filter(m => m.available === false);
    const unavailableNameSet = new Set(unavailableItems.map(m => m.name.toLowerCase()));

    const added: string[] = [];
    const omitted: string[] = [];

    for (const item of lastOrder.items) {
      const nameLower = item.name.toLowerCase();
      // Check if item is explicitly out of stock
      if (unavailableNameSet.has(nameLower)) {
        omitted.push(item.name);
        continue;
      }
      // If menu was fetched and item is not found at all, still try to add
      // (menu structure may have changed but item could still exist)
      cartAddItem(sessionId, {
        name: item.name,
        code: item.code,
        qty: item.qty,
        price: item.price,
        notes: item.notes,
      });
      added.push(`${item.qty}x ${item.name}`);
    }

    if (added.length > 0) {
      transitionOrderStage(sessionId, 'ORDERING');
    }

    const items = cartGetItems(sessionId);
    const summary = cartFormatSummary(items);

    let response = `Welcome back! I've added your previous order to the cart:\n\n${summary}`;
    if (omitted.length > 0) {
      response += `\n\nNote: ${omitted.join(', ')} ${omitted.length === 1 ? 'is' : 'are'} currently unavailable and ${omitted.length === 1 ? 'has' : 'have'} been omitted.`;
    }
    response += '\n\nWould you like to place this order, or make any changes?';

    return {
      content: [{ type: 'text', text: response }]
    };
  });

  return handlers;
}
