/**
 * US-585: Tamil Sentiment Analyzer
 *
 * Analyzes Tamil text for sentiment (positive or negative) to disambiguate
 * intents when keywords alone are ambiguous. Uses curated word lists with
 * scoring to return normalized sentiment score from -1.0 (very negative) to
 * +1.0 (very positive).
 *
 * Example usage:
 *   const analyzer = new TamilSentimentAnalyzer();
 *   const score = analyzer.analyze('பிரச்சனை உண்டு'); // negative
 *   // score: { score: -0.5, positive: 0, negative: 1, confidence: 0.95 }
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface SentimentResult {
  score: number; // -1.0 to +1.0
  positive: number; // count of positive words found
  negative: number; // count of negative words found
  confidence: number; // 0.0 to 1.0, confidence in the sentiment classification
  language: 'ta'; // Tamil
}

interface SentimentData {
  positive: string[];
  negative: string[];
}

export class TamilSentimentAnalyzer {
  private sentiments: SentimentData;

  constructor() {
    this.sentiments = this.loadSentiments();
  }

  /**
   * Load Tamil sentiments from JSON file
   * Falls back to empty arrays if file not found
   */
  private loadSentiments(): SentimentData {
    const dataDir = join(process.cwd(), 'src', 'assistant', 'data');
    const sentimentsPath = join(dataDir, 'tamil-sentiments.json');

    if (existsSync(sentimentsPath)) {
      try {
        const content = readFileSync(sentimentsPath, 'utf-8');
        const data = JSON.parse(content) as SentimentData;
        console.log(`[TamilSentimentAnalyzer] Loaded ${data.positive.length} positive and ${data.negative.length} negative words`);
        return data;
      } catch (err: any) {
        console.error(`[TamilSentimentAnalyzer] Error loading sentiments: ${err.message}`);
      }
    }

    // Fallback to empty arrays
    console.warn('[TamilSentimentAnalyzer] Fallback: Using empty sentiment word lists');
    return { positive: [], negative: [] };
  }

  /**
   * Normalize text for sentiment matching
   * - Lowercase
   * - Remove diacritics/modifiers (keep Tamil letters)
   * - Trim whitespace
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .trim();
  }

  /**
   * Check if word matches any pattern (exact word boundary)
   * Splits text by whitespace and checks against sentiment words
   * Tamil text doesn't have case, so we compare directly
   */
  private findMatches(text: string, sentimentWords: string[]): number {
    const normalized = this.normalizeText(text);
    // Remove common punctuation marks (keep Tamil letters, numbers, spaces)
    const cleanText = normalized
      .replace(/[,.:;!?"'"\-()]/g, '')  // Remove common punctuation
      .trim();
    const words = cleanText.split(/\s+/).filter(w => w.length > 0);
    let matchCount = 0;

    for (const word of words) {
      for (const sentimentWord of sentimentWords) {
        // Exact match or word contains sentiment word as substring
        // Both already lowercase, so direct comparison
        if (word === sentimentWord || word.includes(sentimentWord)) {
          matchCount++;
          break; // Count this word only once
        }
      }
    }

    return matchCount;
  }

  /**
   * Analyze Tamil text for sentiment
   *
   * @param text - Tamil text to analyze
   * @returns SentimentResult with score (-1.0 to +1.0), positive/negative counts, and confidence
   *
   * Algorithm:
   * 1. Count positive and negative word matches
   * 2. Calculate raw score: (positive - negative) / (positive + negative)
   *    If no words found, return score: 0, confidence: 0
   * 3. Clamp score to [-1.0, 1.0]
   * 4. Confidence based on total matches found (higher matches = higher confidence)
   *    - 0 matches: 0.0 confidence
   *    - 1 match: 0.3 confidence
   *    - 2-3 matches: 0.6 confidence
   *    - 4+ matches: 0.95 confidence
   */
  analyze(text: string): SentimentResult {
    const positiveCount = this.findMatches(text, this.sentiments.positive);
    const negativeCount = this.findMatches(text, this.sentiments.negative);
    const totalMatches = positiveCount + negativeCount;

    // Calculate raw score
    let score: number;
    if (totalMatches === 0) {
      score = 0; // Neutral if no sentiment words found
    } else {
      score = (positiveCount - negativeCount) / totalMatches;
    }

    // Clamp score to [-1.0, 1.0]
    score = Math.max(-1.0, Math.min(1.0, score));

    // Calculate confidence based on match count
    let confidence: number;
    if (totalMatches === 0) {
      confidence = 0.0;
    } else if (totalMatches === 1) {
      confidence = 0.3;
    } else if (totalMatches <= 3) {
      confidence = 0.6;
    } else {
      confidence = 0.95;
    }

    return {
      score,
      positive: positiveCount,
      negative: negativeCount,
      confidence,
      language: 'ta',
    };
  }

  /**
   * Convenience method: Check if sentiment is strongly positive
   * Returns true if score >= 0.6
   */
  isStronglyPositive(text: string): boolean {
    const result = this.analyze(text);
    return result.score >= 0.6;
  }

  /**
   * Convenience method: Check if sentiment is strongly negative
   * Returns true if score <= -0.6
   */
  isStronglyNegative(text: string): boolean {
    const result = this.analyze(text);
    return result.score <= -0.6;
  }

  /**
   * Reload sentiments from file
   * Useful for reloading after config changes
   */
  reloadSentiments(): void {
    this.sentiments = this.loadSentiments();
    console.log('[TamilSentimentAnalyzer] Reloaded sentiments');
  }
}

// Singleton instance
let analyzerInstance: TamilSentimentAnalyzer | null = null;

/**
 * Get or create singleton TamilSentimentAnalyzer instance
 */
export function getTamilSentimentAnalyzer(): TamilSentimentAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new TamilSentimentAnalyzer();
  }
  return analyzerInstance;
}

/**
 * Convenience function to analyze text using singleton
 */
export function analyzeTamilSentiment(text: string): SentimentResult {
  return getTamilSentimentAnalyzer().analyze(text);
}
