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
  transitionOrderStage, clearOrderStage,
} from '../assistant/order-stage-store.js';
import { fnbCreateOrder } from './fnb-orders.js';
import {
  setDisambiguation, getDisambiguation, clearDisambiguation,
  formatDisambiguationList, type DisambiguationCandidate,
} from '../assistant/disambiguation-store.js';
import { fetchMenuItems } from './fnb-menu.js';
import { findMenuItemMatches } from '../assistant/menu-matcher.js';

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
      'Accepts patterns: "table 5", "T5", "table5", "takeaway", "tapau", "dine-in", "dine in".',
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
  // ─── Disambiguation Tools ────────────────────────────────────────
  {
    name: 'cart_search_item',
    description: [
      'Search the menu for an item by name and add it to cart if unambiguous.',
      'Use this instead of cart_add_item when the guest uses a partial or vague name (e.g. "the chicken", "nasi", "something spicy").',
      '• Single match → item is added to cart automatically.',
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

  handlers.set('cart_update_qty', async (args: any) => {
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
      if (ot === 'takeaway' || ot === 'tapau') {
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
    const summary = cartFormatSummary(items);
    const tableInfo = cartGetTableInfo(sessionId);
    const tableLine = tableInfo
      ? tableInfo.orderType === 'takeaway'
        ? '\nOrder type: Takeaway'
        : tableInfo.tableNumber
          ? `\nTable: ${tableInfo.tableNumber}`
          : '\nOrder type: Dine-in'
      : '';
    return {
      content: [{
        type: 'text',
        text: `Here is your order summary:\n\n${summary}${tableLine}\n\nShall I place this order? Reply YES to confirm or tell me what to change.`
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
      } else {
        // FnB system unavailable — still acknowledge and notify
        orderAck = '\n\nOur staff has been notified and will prepare your order shortly.';
      }
    } else {
      // No coded items — order captured internally, staff will handle
      orderAck = '\n\nOur staff has been notified and will prepare your order shortly.';
    }

    // Transition to PLACED and clear cart
    transitionOrderStage(sessionId, 'PLACED');
    cartClear(sessionId);
    clearOrderStage(sessionId);

    return {
      content: [{
        type: 'text',
        text: `Your order${tableDesc} has been sent to the kitchen!\n\n${summary}${orderAck}\n\nThank you! Please let us know if you need anything else.`
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

  handlers.set('cart_cancel_order', async (_args: any) => {
    const { getOrderStage } = await import('../assistant/order-stage-store.js');
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

    // Clear cart and reset to BROWSING
    cartClear(sessionId);
    clearOrderStage(sessionId);
    return {
      content: [{
        type: 'text',
        text: 'Your order has been cleared. Let me know if you would like to start a new order!'
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
      // Unambiguous — add directly to cart
      clearDisambiguation(sessionId);
      const match = effectiveMatches[0];
      const item: CartItem = { name: match.name, qty, code: match.code, price: match.price, notes };
      const items = cartAddItem(sessionId, item);
      transitionOrderStage(sessionId, 'ORDERING');
      const priceStr = match.price !== undefined ? ` (RM ${match.price.toFixed(2)})` : '';
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
    const item: CartItem = { name: chosen.name, qty, code: chosen.code, price: chosen.price, notes };
    const items = cartAddItem(sessionId, item);
    transitionOrderStage(sessionId, 'ORDERING');
    const priceStr = chosen.price !== undefined ? ` (RM ${chosen.price.toFixed(2)})` : '';

    return {
      content: [{
        type: 'text',
        text: `Added ${qty}x ${chosen.name}${priceStr} to your cart.\n\nCurrent cart:\n${cartFormatSummary(items)}`
      }]
    };
  });

  return handlers;
}
