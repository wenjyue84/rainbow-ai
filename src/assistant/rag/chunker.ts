/**
 * RAG Chunker — Splits KB markdown files into retrieval-ready chunks.
 *
 * US-912: Chunk size 300 tokens (±50) with 15% overlap.
 * Uses whitespace tokenization (1 token ≈ 1 word) for speed.
 * Markdown-aware: prefers splitting at heading/paragraph boundaries.
 */

export interface KBChunk {
  /** Unique chunk ID: `filename#chunkIndex` */
  id: string;
  /** Source KB filename (e.g., "pricing.md") */
  source: string;
  /** Chunk text content */
  text: string;
  /** Token count (whitespace-based approximation) */
  tokenCount: number;
}

const TARGET_TOKENS = 300;
const MIN_TOKENS = 250; // 300 - 50
const MAX_TOKENS = 350; // 300 + 50
const OVERLAP_RATIO = 0.15;
const OVERLAP_TOKENS = Math.round(TARGET_TOKENS * OVERLAP_RATIO); // ~45 tokens

/**
 * Approximate token count using whitespace splitting.
 * For English/Malay text, 1 word ≈ 1.3 tokens; this is a conservative estimate.
 */
function countTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Split text into words preserving whitespace structure.
 */
function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * Find the best split point near targetIdx in the words array.
 * Prefers paragraph/heading boundaries (lines starting with #, empty lines).
 */
function findSplitPoint(words: string[], targetIdx: number, text: string): number {
  // Look within ±30 words for a paragraph or heading boundary
  const searchRadius = 30;
  const start = Math.max(0, targetIdx - searchRadius);
  const end = Math.min(words.length, targetIdx + searchRadius);

  // Reconstruct positions to find newline boundaries
  let bestSplit = targetIdx;
  let bestDistance = Infinity;

  let pos = 0;
  for (let i = 0; i < end && i < words.length; i++) {
    const wordStart = text.indexOf(words[i], pos);
    pos = wordStart + words[i].length;

    if (i < start) continue;

    // Check if this word starts a new paragraph or heading
    const beforeWord = text.substring(Math.max(0, wordStart - 2), wordStart);
    const isNewParagraph = beforeWord.includes('\n\n') || words[i].startsWith('#');

    if (isNewParagraph) {
      const distance = Math.abs(i - targetIdx);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSplit = i;
      }
    }
  }

  return bestSplit;
}

/**
 * Chunk a single KB file into overlapping segments.
 *
 * @param filename - KB filename (e.g., "pricing.md")
 * @param content - Raw markdown content
 * @returns Array of chunks
 */
export function chunkFile(filename: string, content: string): KBChunk[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const totalTokens = countTokens(trimmed);

  // If file is small enough, return as single chunk
  if (totalTokens <= MAX_TOKENS) {
    return [{
      id: `${filename}#0`,
      source: filename,
      text: trimmed,
      tokenCount: totalTokens,
    }];
  }

  const words = tokenize(trimmed);
  const chunks: KBChunk[] = [];
  let startIdx = 0;

  while (startIdx < words.length) {
    let endIdx = Math.min(startIdx + TARGET_TOKENS, words.length);

    // Try to find a natural split point
    if (endIdx < words.length) {
      endIdx = findSplitPoint(words, endIdx, trimmed);
      // Ensure we don't go below minimum
      if (endIdx - startIdx < MIN_TOKENS && endIdx < words.length) {
        endIdx = Math.min(startIdx + TARGET_TOKENS, words.length);
      }
    }

    const chunkWords = words.slice(startIdx, endIdx);
    const chunkText = chunkWords.join(' ');

    chunks.push({
      id: `${filename}#${chunks.length}`,
      source: filename,
      text: chunkText,
      tokenCount: chunkWords.length,
    });

    // Move forward with overlap
    const advance = Math.max(1, endIdx - startIdx - OVERLAP_TOKENS);
    startIdx += advance;

    // Prevent infinite loop on very small advances
    if (startIdx >= words.length - OVERLAP_TOKENS && endIdx >= words.length) break;
  }

  return chunks;
}

/**
 * Chunk all KB files from a cache map.
 *
 * @param kbCache - Map of filename → content
 * @param excludeFiles - Files to exclude from chunking (e.g., core files like AGENTS.md)
 * @returns All chunks across all files
 */
export function chunkAllFiles(
  kbCache: Map<string, string>,
  excludeFiles: Set<string> = new Set()
): KBChunk[] {
  const allChunks: KBChunk[] = [];

  for (const [filename, content] of kbCache) {
    if (excludeFiles.has(filename)) continue;
    // Skip non-markdown and memory files
    if (!filename.endsWith('.md')) continue;
    if (filename.startsWith('memory/')) continue;

    const chunks = chunkFile(filename, content);
    allChunks.push(...chunks);
  }

  console.log(`[RAG:Chunker] Chunked ${kbCache.size} files into ${allChunks.length} chunks`);
  return allChunks;
}
