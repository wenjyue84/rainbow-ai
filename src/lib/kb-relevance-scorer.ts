/**
 * KB Relevance Scorer — Document Filtering for Context Assembly
 *
 * Scores KB documents against detected intents using TF-IDF cosine similarity.
 * Filters out low-relevance documents (score < 0.7) to reduce noise in AI context.
 * US-634: Improve response quality by excluding irrelevant KB entries.
 */

import type { Logger } from './logger.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ─── Tokenization & Vector Building ────────────────────────────────────

/**
 * Normalize text: lowercase, remove punctuation, split into tokens
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff\u0600-\u06ff]/g, '') // Keep CJK and Arabic ranges
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/**
 * Calculate relevance score based on keyword coverage
 * Measures what proportion of intent keywords appear in the document
 *
 * Formula: score = (keyword_matches / unique_keywords) * document_density_bonus
 * Where document_density_bonus = min(1.0, unique_doc_tokens / avg_doc_size)
 *
 * This gives high scores (>=0.7) when document contains most keywords,
 * and lower scores when few keywords are present.
 */
function calculateCosineSimilarity(keywordTokens: string[], docTokens: string[]): number {
  if (keywordTokens.length === 0 || docTokens.length === 0) {
    return 0;
  }

  // Get unique keywords and document tokens
  const uniqueKeywords = new Set(keywordTokens);
  const uniqueDocTokens = new Set(docTokens);

  // Count how many keywords appear in the document
  let keywordMatches = 0;
  for (const keyword of uniqueKeywords) {
    if (uniqueDocTokens.has(keyword)) {
      keywordMatches++;
    }
  }

  // Base score: percentage of keywords found in document
  const keywordCoverageScore = keywordMatches / uniqueKeywords.size;

  // Bonus for document density: prefer documents with more relevant content
  // Avoid penalizing short documents by using a minimum threshold
  const documentDensityBonus = Math.min(
    1.0,
    uniqueDocTokens.size / Math.max(10, uniqueKeywords.size * 3)
  );

  // Final score combines coverage (weight 0.8) and density (weight 0.2)
  const score = keywordCoverageScore * 0.8 + documentDensityBonus * 0.2;

  return Math.min(Math.max(score, 0), 1.0); // Clamp to [0, 1]
}

// ─── Document Scoring Interface ────────────────────────────────────────

export interface ScoredDocument {
  docId: string;
  score: number;
  included: boolean;
  reason?: string;
}

export interface ScoringResult {
  intent: string;
  documents: ScoredDocument[];
  skipped: ScoredDocument[];
}

// ─── Intent Keywords Loader ──────────────────────────────────────────

/**
 * Load intent keywords for a specific intent and profile
 * Returns all keywords across all languages, merged into a single array
 */
function loadIntentKeywords(
  intentName: string,
  profileId: string = 'pelangi'
): string[] {
  const dataDir = join(process.cwd(), 'src', 'assistant', 'data');
  const profilePath = join(dataDir, `intent-keywords-${profileId}.json`);
  const defaultPath = join(dataDir, 'intent-keywords.json');

  let keywordData;
  try {
    const filePath = existsSync(profilePath) ? profilePath : defaultPath;
    const content = readFileSync(filePath, 'utf-8');
    keywordData = JSON.parse(content);
  } catch (err: any) {
    console.warn(`[KBRelevanceScorer] Failed to load intent keywords: ${err.message}`);
    return [];
  }

  // Find intent entry
  const intentEntry = keywordData.intents?.find((i: any) => i.intent === intentName);
  if (!intentEntry) {
    return [];
  }

  // Collect all keywords across all languages
  const allKeywords: string[] = [];
  if (intentEntry.keywords && typeof intentEntry.keywords === 'object') {
    for (const langKeywords of Object.values(intentEntry.keywords)) {
      if (Array.isArray(langKeywords)) {
        allKeywords.push(...langKeywords);
      }
    }
  }

  return allKeywords;
}

// ─── KB Relevance Scorer ──────────────────────────────────────────────

export class KBRelevanceScorer {
  private threshold: number = 0.7;
  private logger?: Logger;

  constructor(threshold: number = 0.7, logger?: Logger) {
    this.threshold = threshold;
    this.logger = logger;
  }

  /**
   * Score KB documents against intent keywords
   *
   * @param intent - Intent name (e.g., "booking_inquiry", "checkout_question")
   * @param intentKeywords - Array of keywords associated with the intent
   * @param documents - Map of document ID -> document content
   * @returns ScoringResult with scored and filtered documents
   */
  scoreDocuments(
    intent: string,
    intentKeywords: string[],
    documents: Map<string, string>
  ): ScoringResult {
    if (intentKeywords.length === 0) {
      this.log(`[${intent}] No keywords provided, including all documents`);
      return {
        intent,
        documents: Array.from(documents.entries()).map(([docId]) => ({
          docId,
          score: 1.0,
          included: true,
        })),
        skipped: [],
      };
    }

    // Tokenize intent keywords
    const keywordTokens = tokenize(intentKeywords.join(' '));
    const results: ScoredDocument[] = [];
    const skipped: ScoredDocument[] = [];

    for (const [docId, content] of documents) {
      const docTokens = tokenize(content);
      const score = calculateCosineSimilarity(keywordTokens, docTokens);
      const included = score >= this.threshold;

      const result: ScoredDocument = {
        docId,
        score: Math.round(score * 1000) / 1000, // Round to 3 decimal places
        included,
        reason: !included ? 'below_threshold' : undefined,
      };

      if (included) {
        results.push(result);
      } else {
        skipped.push(result);
      }

      // Log skipped documents
      if (!included) {
        this.log(
          `[${intent}] Skipped doc="${docId}" score=${score.toFixed(3)} reason=below_threshold`
        );
      }
    }

    this.log(
      `[${intent}] Relevance filtering: ${results.length}/${documents.size} docs included ` +
      `(threshold=${this.threshold}), skipped ${skipped.length}`
    );

    return {
      intent,
      documents: results,
      skipped,
    };
  }

  /**
   * Filter a set of documents based on intent relevance
   * Returns only documents with score >= threshold
   *
   * @param intent - Intent name
   * @param intentKeywords - Keywords for this intent
   * @param documents - Map of document ID -> content
   * @returns Filtered document IDs (above threshold)
   */
  filterDocuments(
    intent: string,
    intentKeywords: string[],
    documents: Map<string, string>
  ): string[] {
    const result = this.scoreDocuments(intent, intentKeywords, documents);
    return result.documents.map(d => d.docId);
  }

  /**
   * Filter KB documents by intent name (loads keywords automatically)
   *
   * @param intent - Intent name (e.g., "booking_inquiry")
   * @param documents - Map of document ID -> content
   * @param profileId - Profile ID for loading profile-specific keywords
   * @returns Filtered document IDs (above threshold)
   */
  filterDocumentsByIntent(
    intent: string,
    documents: Map<string, string>,
    profileId: string = 'pelangi'
  ): string[] {
    const keywords = loadIntentKeywords(intent, profileId);
    return this.filterDocuments(intent, keywords, documents);
  }

  /**
   * Score KB documents by intent name (loads keywords automatically)
   *
   * @param intent - Intent name
   * @param documents - Map of document ID -> content
   * @param profileId - Profile ID for loading profile-specific keywords
   * @returns ScoringResult with scored and filtered documents
   */
  scoreDocumentsByIntent(
    intent: string,
    documents: Map<string, string>,
    profileId: string = 'pelangi'
  ): ScoringResult {
    const keywords = loadIntentKeywords(intent, profileId);
    return this.scoreDocuments(intent, keywords, documents);
  }

  /**
   * Set the relevance threshold (0.0-1.0)
   */
  setThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      throw new Error('Threshold must be between 0 and 1');
    }
    this.threshold = threshold;
  }

  private log(message: string): void {
    if (this.logger) {
      this.logger.debug(message);
    } else {
      console.debug(message);
    }
  }
}

/**
 * Default scorer instance for single-threaded use
 */
export const defaultKBScorer = new KBRelevanceScorer(0.7);
