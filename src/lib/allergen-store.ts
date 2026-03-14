/**
 * allergen-store.ts — In-memory allergen data store for FnB menu items
 *
 * Stores allergen and dietary flag data per menu item code.
 * Persisted to src/assistant/data-makan/allergens.json (file-based, no DB required).
 * Editable via admin API: PATCH /api/rainbow/menu-allergens/:code
 *
 * US-877: Allergen and dietary warning display on item selection.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface AllergenEntry {
  /** Allergen names, e.g. ["peanuts", "gluten", "soy"] */
  allergens: string[];
  /** Dietary flags, e.g. ["halal", "vegetarian", "gluten-free"] */
  dietary_flags: string[];
}

type AllergenMap = Record<string, AllergenEntry>;

const DATA_FILE = join(process.cwd(), 'src', 'assistant', 'data-makan', 'allergens.json');

let store: AllergenMap = {};

/** Load allergen data from file into memory. Called once at startup. */
export function initAllergenStore(): void {
  if (!existsSync(DATA_FILE)) {
    store = {};
    return;
  }
  try {
    const raw = readFileSync(DATA_FILE, 'utf-8');
    store = JSON.parse(raw) as AllergenMap;
  } catch {
    store = {};
  }
}

/** Persist current in-memory store to file. */
function persist(): void {
  try {
    writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('[AllergenStore] Failed to persist allergen data:', err);
  }
}

/** Get allergen data for a specific item code. Returns undefined if not found. */
export function getAllergenEntry(code: string): AllergenEntry | undefined {
  return store[code.toUpperCase()];
}

/** Get all allergen data. */
export function getAllAllergenData(): AllergenMap {
  return { ...store };
}

/** Set (create or replace) allergen data for an item code. */
export function setAllergenEntry(code: string, entry: AllergenEntry): void {
  store[code.toUpperCase()] = {
    allergens: entry.allergens || [],
    dietary_flags: entry.dietary_flags || [],
  };
  persist();
}

/** Merge allergen data for an item code (only overwrites provided fields). */
export function mergeAllergenEntry(code: string, partial: Partial<AllergenEntry>): AllergenEntry {
  const existing = store[code.toUpperCase()] || { allergens: [], dietary_flags: [] };
  const merged: AllergenEntry = {
    allergens: partial.allergens !== undefined ? partial.allergens : existing.allergens,
    dietary_flags: partial.dietary_flags !== undefined ? partial.dietary_flags : existing.dietary_flags,
  };
  store[code.toUpperCase()] = merged;
  persist();
  return merged;
}

/** Delete allergen data for an item code. Returns true if it existed. */
export function deleteAllergenEntry(code: string): boolean {
  const key = code.toUpperCase();
  if (!(key in store)) return false;
  delete store[key];
  persist();
  return true;
}

/**
 * Format allergen entry into a human-readable warning string for the AI waiter.
 * Returns empty string if no allergen data is configured.
 */
export function formatAllergenWarning(code: string, itemName: string): string {
  const entry = getAllergenEntry(code);

  if (!entry || (entry.allergens.length === 0 && entry.dietary_flags.length === 0)) {
    return `⚠️ Allergen info not available for ${itemName}. Please inform our staff of any allergies before ordering.`;
  }

  const lines: string[] = [];

  if (entry.allergens.length > 0) {
    lines.push(`Contains: ${entry.allergens.join(', ')}`);
  }

  if (entry.dietary_flags.length > 0) {
    lines.push(`Suitable for: ${entry.dietary_flags.join(', ')}`);
  }

  return `⚠️ *Allergen Info — ${itemName}*\n${lines.join('\n')}`;
}
