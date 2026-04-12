/**
 * content-similarity.ts — String similarity scoring using Levenshtein distance
 *
 * Used for detecting content contamination across profiles by measuring
 * how similar text content is between different profiles' config files.
 */

/**
 * Calculate Levenshtein distance between two strings.
 * Lower distance = more similar strings.
 *
 * @param a First string
 * @param b Second string
 * @returns Edit distance (number of single-character edits required)
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score between two strings (0-1).
 * 1.0 = identical, 0.0 = completely different
 *
 * @param a First string
 * @param b Second string
 * @returns Similarity score from 0 to 1
 */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1; // Both empty

  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

/**
 * Extract meaningful text chunks from JSON content.
 * Recursively walks the object and collects string values.
 *
 * @param obj JSON object to extract text from
 * @param maxChunks Maximum number of chunks to extract (performance limiter)
 * @returns Array of text chunks (1000+ char minimum to be meaningful)
 */
export function extractTextChunks(
  obj: any,
  maxChunks: number = 1000
): string[] {
  const chunks: string[] = [];
  const visited = new Set<any>();

  function traverse(value: any): void {
    if (chunks.length >= maxChunks) return;
    if (value === null || value === undefined) return;
    if (visited.has(value)) return;

    const type = typeof value;

    if (type === 'string' && value.length > 100) {
      // Only collect substantial text chunks (100+ chars)
      chunks.push(value.toLowerCase());
    } else if (type === 'object') {
      visited.add(value);
      if (Array.isArray(value)) {
        for (const item of value) {
          traverse(item);
        }
      } else {
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            traverse(value[key]);
          }
        }
      }
    }
  }

  traverse(obj);
  return chunks;
}

/**
 * Find duplicate text chunks between two profiles' content.
 * A chunk is considered "duplicate" if similarity > threshold (default 0.85).
 *
 * @param chunks1 Text chunks from profile A
 * @param chunks2 Text chunks from profile B
 * @param threshold Similarity threshold (0-1, default 0.85)
 * @returns Array of {text, similarity} objects for suspected duplicates
 */
export function findDuplicateChunks(
  chunks1: string[],
  chunks2: string[],
  threshold: number = 0.85
): Array<{ text: string; similarity: number }> {
  const duplicates: Array<{ text: string; similarity: number }> = [];

  // Sample both arrays if they're very large (performance)
  const sample1 = chunks1.length > 500 ? chunks1.slice(0, 500) : chunks1;
  const sample2 = chunks2.length > 500 ? chunks2.slice(0, 500) : chunks2;

  for (const chunk1 of sample1) {
    for (const chunk2 of sample2) {
      const similarity = stringSimilarity(chunk1, chunk2);
      if (similarity > threshold) {
        // Avoid duplicates: only add if not already recorded
        const alreadyAdded = duplicates.some(
          d => d.text === chunk1 || d.text === chunk2
        );
        if (!alreadyAdded) {
          duplicates.push({
            text: chunk1.substring(0, 150) + '...',
            similarity: Math.round(similarity * 100) / 100,
          });
        }
      }
    }
  }

  return duplicates;
}

/**
 * Calculate contamination score between two profile datasets.
 * Score = (number of duplicates found) / (average dataset size)
 * Capped at 1.0
 *
 * @param chunks1 Text chunks from profile A
 * @param chunks2 Text chunks from profile B
 * @param threshold Similarity threshold for duplicates
 * @returns Contamination score (0-1)
 */
export function calculateContaminationScore(
  chunks1: string[],
  chunks2: string[],
  threshold: number = 0.85
): number {
  if (chunks1.length === 0 || chunks2.length === 0) {
    return 0; // No data = no contamination
  }

  const duplicates = findDuplicateChunks(chunks1, chunks2, threshold);
  const avgSize = (chunks1.length + chunks2.length) / 2;

  const score = duplicates.length / avgSize;
  return Math.min(score, 1.0); // Cap at 1.0
}
