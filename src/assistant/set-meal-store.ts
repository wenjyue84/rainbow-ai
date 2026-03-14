/**
 * set-meal-store.ts — Per-session pending set meal customisation state
 *
 * When a guest orders a set meal / combo that has choices (e.g. pick a drink,
 * pick a side), this store tracks which choices have been filled and which
 * are still pending. Once all choices are filled the item is added to cart
 * with the chosen components.
 */

import type { SetMealChoice } from './disambiguation-store.js';
import type { SetMealComponent } from './cart-store.js';

export interface PendingSetMeal {
  /** Menu item name (e.g. "Set A") */
  name: string;
  /** Menu item code (e.g. "SA01") */
  code?: string;
  /** Unit price in MYR */
  price?: number;
  /** Quantity to add once all choices are filled */
  qty: number;
  /** Special instructions */
  notes?: string;
  /** All choice groups from the menu item */
  choices: SetMealChoice[];
  /** Filled selections so far (index maps to choices[]) */
  selections: (string | null)[];
  /** Timestamp for TTL cleanup */
  createdAt: number;
}

const SET_MEAL_TTL_MS = 30 * 60 * 1000; // 30-minute TTL

const store = new Map<string, PendingSetMeal>();

// Cleanup stale states every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.createdAt > SET_MEAL_TTL_MS) store.delete(k);
  }
}, 10 * 60 * 1000);

/** Start a pending set meal customisation for a session. */
export function startSetMeal(sessionId: string, pending: Omit<PendingSetMeal, 'selections' | 'createdAt'>): PendingSetMeal {
  const state: PendingSetMeal = {
    ...pending,
    selections: new Array(pending.choices.length).fill(null),
    createdAt: Date.now(),
  };
  store.set(sessionId, state);
  return state;
}

/** Get current pending set meal, or null if none/expired. */
export function getPendingSetMeal(sessionId: string): PendingSetMeal | null {
  const s = store.get(sessionId);
  if (!s) return null;
  if (Date.now() - s.createdAt > SET_MEAL_TTL_MS) {
    store.delete(sessionId);
    return null;
  }
  return s;
}

/** Clear pending set meal state. */
export function clearPendingSetMeal(sessionId: string): void {
  store.delete(sessionId);
}

/** Get the index of the next unfilled choice, or -1 if all filled. */
export function getNextUnfilledChoice(pending: PendingSetMeal): number {
  return pending.selections.findIndex(s => s === null);
}

/**
 * Fill a choice by index. Returns true if the selection was valid.
 */
export function fillChoice(pending: PendingSetMeal, choiceIndex: number, selection: string): boolean {
  if (choiceIndex < 0 || choiceIndex >= pending.choices.length) return false;
  pending.selections[choiceIndex] = selection;
  return true;
}

/** Check if all choices have been filled. */
export function allChoicesFilled(pending: PendingSetMeal): boolean {
  return pending.selections.every(s => s !== null);
}

/** Convert filled selections to CartItem components. */
export function toCartComponents(pending: PendingSetMeal): SetMealComponent[] {
  return pending.choices.map((choice, i) => ({
    choiceName: choice.name,
    selectedItem: pending.selections[i] || choice.options[0], // fallback to first option
  }));
}

/**
 * Format the next choice prompt for the guest.
 * Returns a numbered list of options for the next unfilled choice.
 */
export function formatChoicePrompt(pending: PendingSetMeal): string | null {
  const idx = getNextUnfilledChoice(pending);
  if (idx === -1) return null;

  const choice = pending.choices[idx];
  const optionLines = choice.options.map((opt, i) => `${i + 1}. ${opt}`);

  return `For your ${pending.name}, which *${choice.name}* would you like?\n\n${optionLines.join('\n')}`;
}
