/**
 * menu-matcher.ts — Fuzzy menu item search (no external dependencies)
 *
 * Combines substring matching and Levenshtein distance to find the best
 * matching menu items for a guest's partial or ambiguous query.
 */

import type { DisambiguationCandidate } from './disambiguation-store.js';

/** Compute Levenshtein edit distance between two strings (case-insensitive). */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Use a 1D rolling array for memory efficiency
  const prev = new Uint16Array(n + 1);
  const curr = new Uint16Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
      }
    }
    prev.set(curr);
  }
  return prev[n];
}

interface ScoredCandidate {
  item: DisambiguationCandidate;
  score: number; // lower is better
}

/**
 * Score a single candidate name against the query.
 * Returns a numeric score (lower = better match):
 *   0   — exact match
 *   1   — name starts with query
 *   2   — name contains query as substring
 *   3+  — Levenshtein distance between query and shortest word in name
 */
function scoreName(q: string, name: string): number {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;

  const words = n.split(/\s+/);
  const minWordDist = Math.min(...words.map(w => levenshtein(q, w)));
  const fullDist = levenshtein(q, n);
  const normFullDist = fullDist - Math.abs(n.length - q.length);
  return Math.min(minWordDist, normFullDist) + 3;
}

/**
 * Find menu items that match a guest's query.
 *
 * Searches the English name AND all translation variants (ms, zh, etc.).
 * The best (lowest) score across all name variants is used for ranking.
 *
 * Scoring (lower = better match):
 *   0   — exact name match
 *   1   — name starts with query
 *   2   — name contains query as substring
 *   3+  — Levenshtein distance between query and shortest word in name
 *
 * Returns items with score <= threshold, sorted by score, limited to maxResults.
 */
export function findMenuItemMatches(
  query: string,
  items: DisambiguationCandidate[],
  options: { threshold?: number; maxResults?: number } = {}
): DisambiguationCandidate[] {
  const { threshold = 4, maxResults = 6 } = options;
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: ScoredCandidate[] = [];

  for (const item of items) {
    // Score the English name
    let bestScore = scoreName(q, item.name);

    // Also score each translation variant and keep the best
    if (item.translations) {
      for (const localisedName of Object.values(item.translations)) {
        if (localisedName) {
          const tScore = scoreName(q, localisedName);
          if (tScore < bestScore) bestScore = tScore;
        }
      }
    }

    if (bestScore <= threshold) {
      scored.push({ item, score: bestScore });
    }
  }

  // Sort by score (best first), then alphabetically
  scored.sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name));

  return scored.slice(0, maxResults).map(s => s.item);
}
