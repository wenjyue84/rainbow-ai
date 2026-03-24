/**
 * disambiguation-store.ts — Per-session menu item disambiguation state
 *
 * When a guest says something ambiguous like "I want the chicken" and there are
 * multiple chicken dishes, the AI waiter stores the candidate list here so the
 * guest can select by number or name in the next turn.
 *
 * All functions accept `profileId` as the first argument to ensure
 * cross-profile isolation via composite keys.
 */

import { sessionKey } from './session-key.js';

export interface SetMealChoice {
  /** Choice group name, e.g. "Drink", "Side" */
  name: string;
  /** Available options to pick from */
  options: string[];
}

export interface DisambiguationCandidate {
  code?: string;
  name: string;
  price?: number;
  category?: string;
  available?: boolean;
  /** Set meal / combo choice groups (if present, item requires customisation) */
  choices?: SetMealChoice[];
  /** Localised name variants keyed by ISO 639-1 code (e.g. ms, zh) */
  translations?: Record<string, string>;
}

export interface DisambiguationState {
  /** Original query the guest typed (e.g. "chicken") */
  pendingItem: string;
  /** Matching menu items, numbered starting from 1 */
  candidates: DisambiguationCandidate[];
  createdAt: number;
}

const DISAMBIG_TTL_MS = 30 * 60 * 1000; // 30-minute TTL

const store = new Map<string, DisambiguationState>();

// Cleanup stale states every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.createdAt > DISAMBIG_TTL_MS) store.delete(k);
  }
}, 10 * 60 * 1000);

/** Store disambiguation candidates for a session. */
export function setDisambiguation(profileId: string, sessionId: string, state: DisambiguationState): void {
  store.set(sessionKey(profileId, sessionId), state);
}

/** Get pending disambiguation state, or null if expired/absent. */
export function getDisambiguation(profileId: string, sessionId: string): DisambiguationState | null {
  const key = sessionKey(profileId, sessionId);
  const s = store.get(key);
  if (!s) return null;
  if (Date.now() - s.createdAt > DISAMBIG_TTL_MS) {
    store.delete(key);
    return null;
  }
  return s;
}

/** Clear disambiguation state after resolution or abandonment. */
export function clearDisambiguation(profileId: string, sessionId: string): void {
  store.delete(sessionKey(profileId, sessionId));
}

/** Format disambiguation candidates as a numbered list for the AI response. */
export function formatDisambiguationList(state: DisambiguationState): string {
  const lines = state.candidates.map((c, i) => {
    const price = c.price !== undefined ? ` — RM ${c.price.toFixed(2)}` : '';
    const category = c.category ? ` (${c.category})` : '';
    return `${i + 1}. ${c.name}${price}${category}`;
  });
  return lines.join('\n');
}
