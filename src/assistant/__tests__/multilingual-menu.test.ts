/**
 * multilingual-menu.test.ts — Tests for US-937 multi-language menu item name lookup
 *
 * Verifies that menu item disambiguation searches across Malay (ms) and
 * Chinese (zh) translation variants, not just the English name.
 */

import { describe, it, expect } from 'vitest';
import { findMenuItemMatches } from '../menu-matcher.js';
import type { DisambiguationCandidate } from '../disambiguation-store.js';

const multilingualMenu: DisambiguationCandidate[] = [
  {
    name: 'Fried Rice',
    price: 9.00,
    category: 'Rice',
    translations: { ms: 'Nasi Goreng', zh: '炒饭' },
  },
  {
    name: 'Chicken Rice',
    price: 8.00,
    category: 'Rice',
    translations: { ms: 'Nasi Ayam', zh: '鸡饭' },
  },
  {
    name: 'Iced Coffee',
    price: 4.00,
    category: 'Drinks',
    translations: { ms: 'Kopi Ais', zh: '冰咖啡' },
  },
  {
    name: 'Teh Tarik',
    price: 2.50,
    category: 'Drinks',
    // No translations — tests that items without translations still work
  },
  {
    name: 'Mee Goreng',
    price: 8.50,
    category: 'Noodles',
    translations: { ms: 'Mi Goreng', zh: '炒面' },
  },
  {
    name: 'Nasi Lemak',
    price: 8.50,
    category: 'Rice',
    translations: { ms: 'Nasi Lemak', zh: '椰浆饭' },
  },
];

describe('US-937: Multi-language menu item name lookup', () => {
  // ─── Malay term resolution ──────────────────────────────────────────────────

  it('resolves Malay term "nasi goreng" to Fried Rice', () => {
    const results = findMenuItemMatches('nasi goreng', multilingualMenu);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Fried Rice');
  });

  it('resolves Malay term "nasi ayam" to Chicken Rice', () => {
    const results = findMenuItemMatches('nasi ayam', multilingualMenu);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Chicken Rice');
  });

  it('resolves Malay term "kopi ais" to Iced Coffee', () => {
    const results = findMenuItemMatches('kopi ais', multilingualMenu);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Iced Coffee');
  });

  it('resolves Malay term "mi goreng" to Mee Goreng', () => {
    const results = findMenuItemMatches('mi goreng', multilingualMenu);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Mee Goreng');
  });

  // ─── Chinese term resolution ────────────────────────────────────────────────

  it('resolves Chinese term "炒饭" to Fried Rice', () => {
    const results = findMenuItemMatches('炒饭', multilingualMenu);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Fried Rice');
  });

  it('resolves Chinese term "鸡饭" to Chicken Rice', () => {
    const results = findMenuItemMatches('鸡饭', multilingualMenu);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Chicken Rice');
  });

  it('resolves Chinese term "冰咖啡" to Iced Coffee', () => {
    const results = findMenuItemMatches('冰咖啡', multilingualMenu);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Iced Coffee');
  });

  it('resolves Chinese term "炒面" to Mee Goreng', () => {
    const results = findMenuItemMatches('炒面', multilingualMenu);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Mee Goreng');
  });

  it('resolves Chinese term "椰浆饭" to Nasi Lemak', () => {
    const results = findMenuItemMatches('椰浆饭', multilingualMenu);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Nasi Lemak');
  });

  // ─── English still works ────────────────────────────────────────────────────

  it('English name "fried rice" still resolves correctly', () => {
    const results = findMenuItemMatches('fried rice', multilingualMenu);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Fried Rice');
  });

  it('items without translations still match by English name', () => {
    const results = findMenuItemMatches('teh tarik', multilingualMenu);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Teh Tarik');
  });

  // ─── Unrecognised term returns no match ──────────────────────────────────────

  it('unrecognised term returns empty results (triggers disambiguation prompt)', () => {
    const results = findMenuItemMatches('pizza margherita', multilingualMenu, { threshold: 2 });
    expect(results).toHaveLength(0);
  });

  // ─── Best score wins across variants ────────────────────────────────────────

  it('Malay "nasi goreng" scores better than English substring match for Fried Rice', () => {
    const results = findMenuItemMatches('nasi goreng', multilingualMenu);
    // The Malay translation is an exact match, so Fried Rice should be first
    expect(results[0].name).toBe('Fried Rice');
  });

  // ─── translations field in DisambiguationCandidate ──────────────────────────

  it('DisambiguationCandidate supports optional translations field', () => {
    const item: DisambiguationCandidate = {
      name: 'Test Item',
      translations: { ms: 'Item Ujian', zh: '测试项目' },
    };
    expect(item.translations).toBeDefined();
    expect(item.translations!.ms).toBe('Item Ujian');
    expect(item.translations!.zh).toBe('测试项目');
  });

  it('DisambiguationCandidate works without translations field', () => {
    const item: DisambiguationCandidate = { name: 'Plain Item' };
    expect(item.translations).toBeUndefined();
  });
});
