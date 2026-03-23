/**
 * cart-tool-defs.ts — MCP tool definitions for the AI waiter cart
 *
 * Static tool schemas (name, description, inputSchema, allowedProfiles).
 * Handler implementations are in cart.ts via createCartHandlers().
 */

import type { MCPTool } from '../types/mcp.js';

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
