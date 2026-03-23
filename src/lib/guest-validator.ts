/**
 * guest-validator.ts — Guest blacklist lookup (US-346)
 *
 * checkBlacklist(phone, name?) queries the guest_blacklist table.
 * Name matching uses Levenshtein similarity with a >85% threshold so that
 * minor typos / alternate spellings still catch flagged guests.
 */

import { db } from './db.js';
import { guestBlacklist } from '../../shared/schema-tables.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('GuestValidator');

/** Returned when a guest is found on the blacklist. */
export interface BlacklistMatch {
  id: number;
  reason: string;
  matchedOn: 'phone' | 'name';
  similarity?: number;  // 0–1, only set for name matches
}

// ─── Levenshtein similarity ──────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/** Returns similarity in [0, 1]. 1.0 = identical strings. */
function stringSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  return 1 - levenshtein(a, b) / maxLen;
}

const NAME_SIMILARITY_THRESHOLD = 0.85;

// ─── checkBlacklist ─────────────────────────────────────────────────────────

/**
 * Check whether a guest (identified by phone and/or name) is on the blacklist.
 *
 * Matching rules:
 *  1. Exact phone match (if phone provided and entry has a phone)
 *  2. Fuzzy name match ≥ 85% similarity (if name provided and entry has a name)
 *
 * Returns the first match found, or null if the guest is not blacklisted.
 * Errors are swallowed and logged so a DB outage never blocks bookings.
 */
export async function checkBlacklist(
  phone: string,
  name?: string
): Promise<BlacklistMatch | null> {
  try {
    const entries = await db.select().from(guestBlacklist);

    for (const entry of entries) {
      // 1. Phone exact match
      if (entry.phone && phone) {
        const normalised = (p: string) => p.replace(/\D/g, '');
        if (normalised(entry.phone) === normalised(phone)) {
          logger.warn(`Blacklist hit (phone): ${phone} — reason: ${entry.reason}`);
          return { id: entry.id, reason: entry.reason, matchedOn: 'phone' };
        }
      }

      // 2. Name fuzzy match
      if (entry.name && name) {
        const sim = stringSimilarity(
          entry.name.trim().toLowerCase(),
          name.trim().toLowerCase()
        );
        if (sim >= NAME_SIMILARITY_THRESHOLD) {
          logger.warn(
            `Blacklist hit (name): "${name}" ~ "${entry.name}" (similarity=${sim.toFixed(2)}) — reason: ${entry.reason}`
          );
          return { id: entry.id, reason: entry.reason, matchedOn: 'name', similarity: sim };
        }
      }
    }

    return null;
  } catch (err: any) {
    // Non-blocking: log but never prevent a booking due to validator failure
    logger.error(`checkBlacklist failed (allowing booking): ${err.message}`);
    return null;
  }
}
