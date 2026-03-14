/**
 * menu-disambig.test.ts — Unit tests for US-850 menu disambiguation
 *
 * Tests:
 *   - levenshtein() correctness
 *   - findMenuItemMatches() scoring and ranking
 *   - disambiguation-store CRUD + TTL behaviour
 *   - formatDisambiguationList() output
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { levenshtein, findMenuItemMatches } from '../menu-matcher.js';
import {
  setDisambiguation, getDisambiguation, clearDisambiguation,
  formatDisambiguationList, type DisambiguationState,
} from '../disambiguation-store.js';

// ─── levenshtein ──────────────────────────────────────────────────────────────

describe('levenshtein()', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('chicken', 'chicken')).toBe(0);
  });

  it('returns string length for empty comparison', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('computes distance for single substitution', () => {
    expect(levenshtein('cat', 'bat')).toBe(1);
  });

  it('computes distance for single insertion', () => {
    expect(levenshtein('nasi', 'nasii')).toBe(1);
  });

  it('computes distance for single deletion', () => {
    expect(levenshtein('chicken', 'chiken')).toBe(1);
  });

  it('computes distance for transposition-like case', () => {
    // "chickne" vs "chicken" — 2 operations (swap n and e)
    expect(levenshtein('chickne', 'chicken')).toBeLessThanOrEqual(2);
  });
});

// ─── findMenuItemMatches ──────────────────────────────────────────────────────

const sampleMenu = [
  { name: 'Nasi Lemak', price: 8.50, category: 'Rice' },
  { name: 'Nasi Goreng', price: 9.00, category: 'Rice' },
  { name: 'Chicken Rice', price: 8.00, category: 'Rice' },
  { name: 'Chicken Chop', price: 15.00, category: 'Western' },
  { name: 'Fried Chicken', price: 12.00, category: 'Snacks' },
  { name: 'Mee Goreng', price: 8.50, category: 'Noodles' },
  { name: 'Teh Tarik', price: 2.50, category: 'Drinks' },
  { name: 'Iced Coffee', price: 4.00, category: 'Drinks' },
];

describe('findMenuItemMatches()', () => {
  it('returns exact match first', () => {
    const results = findMenuItemMatches('Teh Tarik', sampleMenu);
    expect(results[0].name).toBe('Teh Tarik');
  });

  it('returns all chicken items when query is "chicken"', () => {
    const results = findMenuItemMatches('chicken', sampleMenu);
    const names = results.map(r => r.name);
    expect(names).toContain('Chicken Rice');
    expect(names).toContain('Chicken Chop');
    expect(names).toContain('Fried Chicken');
  });

  it('returns nasi items when query is "nasi"', () => {
    const results = findMenuItemMatches('nasi', sampleMenu);
    const names = results.map(r => r.name);
    expect(names).toContain('Nasi Lemak');
    expect(names).toContain('Nasi Goreng');
    expect(names).not.toContain('Teh Tarik');
  });

  it('returns single result when query is specific enough', () => {
    const results = findMenuItemMatches('mee goreng', sampleMenu);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Mee Goreng');
  });

  it('returns empty array for unrecognised query', () => {
    const results = findMenuItemMatches('pizza', sampleMenu, { threshold: 2 });
    expect(results).toHaveLength(0);
  });

  it('respects maxResults limit', () => {
    const results = findMenuItemMatches('a', sampleMenu, { maxResults: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('handles typos via Levenshtein (chikin → Chicken Rice)', () => {
    const results = findMenuItemMatches('chikin', sampleMenu, { threshold: 5 });
    const names = results.map(r => r.name);
    // Should find chicken items despite typo
    const hasChicken = names.some(n => n.toLowerCase().includes('chicken'));
    expect(hasChicken).toBe(true);
  });

  it('is case-insensitive', () => {
    const results1 = findMenuItemMatches('NASI', sampleMenu);
    const results2 = findMenuItemMatches('nasi', sampleMenu);
    expect(results1.map(r => r.name)).toEqual(results2.map(r => r.name));
  });
});

// ─── disambiguation-store ────────────────────────────────────────────────────

describe('disambiguation-store', () => {
  const sessionId = 'test-session-123';

  beforeEach(() => {
    clearDisambiguation(sessionId);
  });

  it('returns null when no state is set', () => {
    expect(getDisambiguation(sessionId)).toBeNull();
  });

  it('stores and retrieves disambiguation state', () => {
    const state: DisambiguationState = {
      pendingItem: 'chicken',
      candidates: [
        { name: 'Chicken Rice', price: 8.00 },
        { name: 'Chicken Chop', price: 15.00 },
      ],
      createdAt: Date.now(),
    };
    setDisambiguation(sessionId, state);
    const retrieved = getDisambiguation(sessionId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.pendingItem).toBe('chicken');
    expect(retrieved!.candidates).toHaveLength(2);
  });

  it('clears state after clearDisambiguation()', () => {
    setDisambiguation(sessionId, {
      pendingItem: 'nasi',
      candidates: [{ name: 'Nasi Lemak' }],
      createdAt: Date.now(),
    });
    clearDisambiguation(sessionId);
    expect(getDisambiguation(sessionId)).toBeNull();
  });

  it('isolates state by sessionId', () => {
    const session2 = 'other-session';
    setDisambiguation(sessionId, {
      pendingItem: 'chicken',
      candidates: [{ name: 'Chicken Rice' }],
      createdAt: Date.now(),
    });
    expect(getDisambiguation(session2)).toBeNull();
    clearDisambiguation(session2);
  });

  it('formatDisambiguationList outputs numbered list with prices', () => {
    const state: DisambiguationState = {
      pendingItem: 'chicken',
      candidates: [
        { name: 'Chicken Rice', price: 8.00, category: 'Rice' },
        { name: 'Chicken Chop', price: 15.00, category: 'Western' },
        { name: 'Fried Chicken', price: 12.00 },
      ],
      createdAt: Date.now(),
    };
    const list = formatDisambiguationList(state);
    expect(list).toContain('1. Chicken Rice');
    expect(list).toContain('RM 8.00');
    expect(list).toContain('2. Chicken Chop');
    expect(list).toContain('3. Fried Chicken');
    expect(list).toContain('(Rice)');
    expect(list).toContain('(Western)');
  });

  it('returns null for expired state (simulated via fake createdAt)', () => {
    const THIRTY_ONE_MINUTES_AGO = Date.now() - 31 * 60 * 1000;
    setDisambiguation(sessionId, {
      pendingItem: 'old',
      candidates: [{ name: 'Old Item' }],
      createdAt: THIRTY_ONE_MINUTES_AGO,
    });
    // The store checks TTL on read
    expect(getDisambiguation(sessionId)).toBeNull();
  });
});
