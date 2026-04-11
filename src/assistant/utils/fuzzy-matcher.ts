/**
 * Fuzzy keyword matcher using Levenshtein distance for typo tolerance.
 * Handles common misspellings like 'bokking' → 'booking', 'enquiry' → 'inquiry'
 */

export interface FuzzyMatchCandidate {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface FuzzyMatchResult {
  original: string;
  matched: string;
  similarity: number; // 0-1, where 1 is exact match
  distance: number; // Levenshtein distance
}

/**
 * Calculate Levenshtein distance between two strings
 * Represents minimum number of single-character edits needed
 * @param a First string
 * @param b Second string
 * @returns Levenshtein distance (lower = more similar)
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Create matrix for dynamic programming
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  // Fill matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1]  // substitution
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity score based on Levenshtein distance
 * Higher score = more similar (1.0 = exact match, 0.0 = completely different)
 * @param a First string
 * @param b Second string
 * @returns Similarity score (0-1)
 */
function calculateSimilarity(a: string, b: string): number {
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);

  if (maxLen === 0) return 1.0; // Both empty = exact match

  return 1 - (distance / maxLen);
}

/**
 * Fuzzy keyword matcher for intent classification
 * Uses Levenshtein distance to identify keywords with ≥85% similarity
 */
export class FuzzyKeywordMatcher {
  private keywords: string[] = [];

  constructor(keywords: string[] = []) {
    this.keywords = keywords.map(kw => kw.toLowerCase().trim());
  }

  /**
   * Match a single keyword against candidates
   * @param keyword Keyword to match (possibly misspelled)
   * @param candidates List of correct keywords to match against
   * @param threshold Minimum similarity threshold (0-1, default 0.85)
   * @returns Best matching result if similarity >= threshold, null otherwise
   */
  match(
    keyword: string,
    candidates: string[],
    threshold: number = 0.85
  ): FuzzyMatchResult | null {
    const normalized = keyword.toLowerCase().trim();
    let bestMatch: FuzzyMatchResult | null = null;
    let highestSimilarity = -1; // Start below any possible value so threshold=0 edge case works

    for (const candidate of candidates) {
      const similarity = calculateSimilarity(normalized, candidate);
      const distance = levenshteinDistance(normalized, candidate);

      if (similarity >= threshold && similarity > highestSimilarity) {
        highestSimilarity = similarity;
        bestMatch = {
          original: keyword,
          matched: candidate,
          similarity: Math.round(similarity * 1000) / 1000, // Round to 3 decimals
          distance
        };
      }
    }

    return bestMatch;
  }

  /**
   * Find all matches above threshold
   * @param keyword Keyword to match
   * @param candidates List of correct keywords
   * @param threshold Minimum similarity threshold (default 0.85)
   * @returns All matches sorted by similarity descending
   */
  matchAll(
    keyword: string,
    candidates: string[],
    threshold: number = 0.85
  ): FuzzyMatchResult[] {
    const normalized = keyword.toLowerCase().trim();
    const matches: FuzzyMatchResult[] = [];

    for (const candidate of candidates) {
      const similarity = calculateSimilarity(normalized, candidate);
      const distance = levenshteinDistance(normalized, candidate);

      if (similarity >= threshold) {
        matches.push({
          original: keyword,
          matched: candidate,
          similarity: Math.round(similarity * 1000) / 1000,
          distance
        });
      }
    }

    // Sort by similarity descending
    return matches.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Batch match multiple keywords
   * @param keywords Keywords to match
   * @param candidates Correct keywords
   * @param threshold Minimum similarity threshold
   * @returns Array of best matches
   */
  matchBatch(
    keywords: string[],
    candidates: string[],
    threshold: number = 0.85
  ): FuzzyMatchResult[] {
    return keywords
      .map(kw => this.match(kw, candidates, threshold))
      .filter((result): result is FuzzyMatchResult => result !== null);
  }

  /**
   * Extract keywords from text and fuzzy match them
   * @param text User input text
   * @param candidates Correct keywords to match against
   * @param threshold Minimum similarity threshold
   * @returns Array of fuzzy matches found in text
   */
  extractAndMatch(
    text: string,
    candidates: string[],
    threshold: number = 0.85
  ): FuzzyMatchResult[] {
    // Split text into words and try to match each
    const words = text.toLowerCase().trim().split(/\s+/);
    const matches: FuzzyMatchResult[] = [];
    const seen = new Set<string>();

    for (const word of words) {
      // Skip if we've already matched this exact word
      if (seen.has(word)) continue;

      const match = this.match(word, candidates, threshold);
      if (match) {
        matches.push(match);
        seen.add(match.original);
      }
    }

    return matches;
  }

  /**
   * Check if a keyword matches any candidate with ≥85% similarity
   * @param keyword Keyword to check
   * @param candidates Correct keywords
   * @param threshold Minimum similarity threshold
   * @returns True if match found, false otherwise
   */
  hasMatch(
    keyword: string,
    candidates: string[],
    threshold: number = 0.85
  ): boolean {
    return this.match(keyword, candidates, threshold) !== null;
  }
}

export default FuzzyKeywordMatcher;
