/**
 * cart-handlers-search.ts — Menu search and disambiguation handlers
 *
 * Handles: cart_search_item, cart_pick_item
 *
 * Extracted from cart.ts to keep that file manageable.
 * Only closes over sessionId (no options dependency).
 */

import type { MCPToolResult } from '../types/mcp.js';
import {
  cartAddItem, cartFormatSummary,
  type CartItem,
} from '../assistant/cart-store.js';
import { transitionOrderStage } from '../assistant/order-stage-store.js';
import {
  setDisambiguation, getDisambiguation, clearDisambiguation,
  formatDisambiguationList, type DisambiguationCandidate,
} from '../assistant/disambiguation-store.js';
import {
  startSetMeal, formatChoicePrompt,
} from '../assistant/set-meal-store.js';
import { fetchMenuItems } from './fnb-menu.js';
import { findMenuItemMatches } from '../assistant/menu-matcher.js';
import { getAllergenEntry, formatAllergenWarning } from '../lib/allergen-store.js';
import { setPendingAllergenItem } from '../lib/allergen-pending-store.js';

type HandlerMap = Map<string, (args: any) => Promise<MCPToolResult>>;

export function registerSearchHandlers(handlers: HandlerMap, sessionId: string): void {
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

}
