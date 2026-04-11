/**
 * Logger for fuzzy keyword matches
 * Logs to fuzzy-matches.jsonl for keyword improvement analysis
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { FuzzyMatchResult } from './fuzzy-matcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to fuzzy-matches.jsonl in assistant/data directory
const FUZZY_MATCHES_LOG = path.join(__dirname, '../data/fuzzy-matches.jsonl');

export interface FuzzyMatchLogEntry {
  timestamp: string;
  original: string;
  matched: string;
  similarity: number;
  distance: number;
  intent?: string;
  userId?: string;
  context?: string;
}

/**
 * Log a fuzzy match to the jsonl file
 * @param match Fuzzy match result
 * @param intent Optional intent that was matched
 * @param userId Optional user ID
 * @param context Optional context (e.g., conversation state)
 */
export function logFuzzyMatch(
  match: FuzzyMatchResult,
  intent?: string,
  userId?: string,
  context?: string
): void {
  try {
    const entry: FuzzyMatchLogEntry = {
      timestamp: new Date().toISOString(),
      original: match.original,
      matched: match.matched,
      similarity: match.similarity,
      distance: match.distance,
      ...(intent && { intent }),
      ...(userId && { userId }),
      ...(context && { context })
    };

    // Append to jsonl file (each line is a separate JSON object)
    const jsonLine = JSON.stringify(entry) + '\n';
    fs.appendFileSync(FUZZY_MATCHES_LOG, jsonLine, { encoding: 'utf-8' });
  } catch (error) {
    // Non-fatal: log to console but don't crash the pipeline
    console.error('[FuzzyMatchLogger] Failed to log match:', error instanceof Error ? error.message : error);
  }
}

/**
 * Log multiple fuzzy matches
 * @param matches Array of fuzzy match results
 * @param intent Optional intent
 * @param userId Optional user ID
 * @param context Optional context
 */
export function logFuzzyMatches(
  matches: FuzzyMatchResult[],
  intent?: string,
  userId?: string,
  context?: string
): void {
  for (const match of matches) {
    logFuzzyMatch(match, intent, userId, context);
  }
}

/**
 * Read and parse fuzzy matches log for analysis
 * @returns Array of log entries
 */
export function readFuzzyMatches(): FuzzyMatchLogEntry[] {
  try {
    if (!fs.existsSync(FUZZY_MATCHES_LOG)) {
      return [];
    }

    const content = fs.readFileSync(FUZZY_MATCHES_LOG, 'utf-8');
    const lines = content.trim().split('\n');

    return lines
      .filter(line => line.trim().length > 0)
      .map(line => {
        try {
          return JSON.parse(line) as FuzzyMatchLogEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is FuzzyMatchLogEntry => entry !== null);
  } catch (error) {
    console.error('[FuzzyMatchLogger] Failed to read fuzzy matches log:', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Get statistics from fuzzy matches log
 * Useful for keyword improvement analysis
 */
export interface FuzzyMatchStats {
  totalMatches: number;
  uniqueOriginals: Set<string>;
  uniqueMatched: Set<string>;
  averageSimilarity: number;
  averageDistance: number;
  matchesByIntent: Record<string, number>;
  matchesByOriginal: Record<string, number>;
}

export function getFuzzyMatchStats(): FuzzyMatchStats {
  const matches = readFuzzyMatches();

  const stats: FuzzyMatchStats = {
    totalMatches: matches.length,
    uniqueOriginals: new Set(),
    uniqueMatched: new Set(),
    averageSimilarity: 0,
    averageDistance: 0,
    matchesByIntent: {},
    matchesByOriginal: {}
  };

  if (matches.length === 0) {
    return stats;
  }

  let totalSimilarity = 0;
  let totalDistance = 0;

  for (const match of matches) {
    stats.uniqueOriginals.add(match.original);
    stats.uniqueMatched.add(match.matched);

    totalSimilarity += match.similarity;
    totalDistance += match.distance;

    if (match.intent) {
      stats.matchesByIntent[match.intent] = (stats.matchesByIntent[match.intent] ?? 0) + 1;
    }

    stats.matchesByOriginal[match.original] = (stats.matchesByOriginal[match.original] ?? 0) + 1;
  }

  stats.averageSimilarity = totalSimilarity / matches.length;
  stats.averageDistance = totalDistance / matches.length;

  return stats;
}

/**
 * Clear the fuzzy matches log
 */
export function clearFuzzyMatches(): void {
  try {
    if (fs.existsSync(FUZZY_MATCHES_LOG)) {
      fs.unlinkSync(FUZZY_MATCHES_LOG);
    }
  } catch (error) {
    console.error('[FuzzyMatchLogger] Failed to clear fuzzy matches log:', error instanceof Error ? error.message : error);
  }
}

export default {
  logFuzzyMatch,
  logFuzzyMatches,
  readFuzzyMatches,
  getFuzzyMatchStats,
  clearFuzzyMatches
};
