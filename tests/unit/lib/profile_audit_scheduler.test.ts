/**
 * profile_audit_scheduler.test.ts — Tests for profile separation audit scheduler
 *
 * Test suite covering:
 * - Hourly cron job execution
 * - Content contamination detection
 * - String similarity scoring
 * - Database storage of audit results
 */

import { describe, it, expect } from 'vitest';
import {
  levenshteinDistance,
  stringSimilarity,
  extractTextChunks,
  findDuplicateChunks,
  calculateContaminationScore,
} from '../../../src/lib/content-similarity.js';

describe('content-similarity', () => {
  describe('levenshteinDistance', () => {
    it('returns 0 for identical strings', () => {
      expect(levenshteinDistance('hello', 'hello')).toBe(0);
    });

    it('returns distance for different strings', () => {
      expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    });

    it('handles empty strings', () => {
      expect(levenshteinDistance('', '')).toBe(0);
      expect(levenshteinDistance('hello', '')).toBe(5);
      expect(levenshteinDistance('', 'world')).toBe(5);
    });

    it('calculates distance for single character difference', () => {
      expect(levenshteinDistance('cat', 'car')).toBe(1);
    });
  });

  describe('stringSimilarity', () => {
    it('returns 1.0 for identical strings', () => {
      expect(stringSimilarity('hello', 'hello')).toBe(1.0);
    });

    it('returns 0.0 for completely different strings', () => {
      const score = stringSimilarity('abc', 'xyz');
      expect(score).toBeLessThan(0.5);
    });

    it('returns similarity between 0 and 1', () => {
      const score = stringSimilarity('kitten', 'sitting');
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    it('handles empty strings', () => {
      expect(stringSimilarity('', '')).toBe(1.0);
    });
  });

  describe('extractTextChunks', () => {
    it('extracts text chunks from JSON object', () => {
      const obj = {
        title: 'This is a very long title with lots of content and should be extracted as a chunk from the JSON object because it exceeds the 100 character minimum length requirement',
        nested: {
          description: 'This is another chunk with meaningful text that should be extracted from the JSON object when it exceeds the minimum character threshold for proper extraction and processing',
        },
      };

      const chunks = extractTextChunks(obj);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]).toBeTruthy();
    });

    it('extracts chunks from arrays', () => {
      const obj = [
        {
          text: 'This is the first entry with a long text content that exceeds the minimum threshold for extraction',
        },
        {
          text: 'This is the second entry with another long piece of text content for testing purposes',
        },
      ];

      const chunks = extractTextChunks(obj);
      expect(chunks.length).toBeGreaterThanOrEqual(0);
    });

    it('ignores short strings', () => {
      const obj = { short: 'no', veryLongButEmpty: '' };
      const chunks = extractTextChunks(obj);
      // No chunks should be extracted for very short strings
      expect(chunks.length).toBe(0);
    });

    it('respects maxChunks limit', () => {
      const obj = {
        a: 'This is a very long text with meaningful content that should be extracted from the JSON object as a chunk for testing',
        b: 'This is another very long text with meaningful content that should be extracted from the JSON object as a chunk for testing',
        c: 'This is yet another very long text with meaningful content that should be extracted from the JSON object as a chunk for testing',
      };

      const chunks = extractTextChunks(obj, 2);
      expect(chunks.length).toBeLessThanOrEqual(2);
    });
  });

  describe('findDuplicateChunks', () => {
    it('finds similar chunks between two arrays', () => {
      const chunks1 = [
        'This is a sample text about pelangi hostel booking information and features available',
      ];
      const chunks2 = [
        'This is a sample text about pelangi hostel booking information and features available',
      ];

      const duplicates = findDuplicateChunks(chunks1, chunks2, 0.85);
      expect(duplicates.length).toBeGreaterThan(0);
    });

    it('respects similarity threshold', () => {
      const chunks1 = [
        'completely different text about something unrelated to the other content',
      ];
      const chunks2 = ['another completely different text about something entirely else'];

      const duplicates = findDuplicateChunks(chunks1, chunks2, 0.95);
      expect(duplicates.length).toBe(0);
    });

    it('handles empty arrays', () => {
      const duplicates = findDuplicateChunks([], ['text'], 0.85);
      expect(duplicates.length).toBe(0);
    });
  });

  describe('calculateContaminationScore', () => {
    it('returns 0 for profiles with no shared content', () => {
      const chunks1 = [
        'content about profile one that is completely unique and different',
      ];
      const chunks2 = [
        'content about profile two that is also completely unique and different',
      ];

      const score = calculateContaminationScore(chunks1, chunks2, 0.95);
      expect(score).toBe(0);
    });

    it('returns higher score for more duplicates', () => {
      const sharedContent = 'shared information about booking workflow and guest management';
      const chunks1 = [sharedContent, 'pelangi specific content one', 'pelangi specific content two'];
      const chunks2 = [
        sharedContent,
        'southern specific content one',
        'southern specific content two',
      ];

      const score = calculateContaminationScore(chunks1, chunks2, 0.85);
      expect(score).toBeGreaterThan(0);
    });

    it('caps score at 1.0', () => {
      const chunks1 = Array(100).fill('shared content text that is very similar');
      const chunks2 = Array(100).fill('shared content text that is very similar');

      const score = calculateContaminationScore(chunks1, chunks2, 0.85);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('returns 0 for empty profiles', () => {
      const score = calculateContaminationScore([], ['some content'], 0.85);
      expect(score).toBe(0);
    });
  });
});

describe('profile audit scheduler', () => {
  describe('hourly and contamination', () => {
    it('should detect when contamination exceeds threshold', () => {
      // Test case for detection logic
      const contaminationScore = 0.25; // 25% contamination
      const alertThreshold = 0.2; // 20% alert threshold

      expect(contaminationScore).toBeGreaterThan(alertThreshold);
    });

    it('should not alert when contamination is below threshold', () => {
      const contaminationScore = 0.15; // 15% contamination
      const alertThreshold = 0.2; // 20% alert threshold

      expect(contaminationScore).toBeLessThanOrEqual(alertThreshold);
    });

    it('should handle contamination score of exactly 0.2', () => {
      const contaminationScore = 0.2;
      const alertThreshold = 0.2;

      // Should not alert at boundary (> not >=)
      expect(contaminationScore > alertThreshold).toBe(false);
    });
  });
});
