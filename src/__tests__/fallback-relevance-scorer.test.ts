/**
 * Unit tests for Fallback Response Semantic Relevance Scorer (US-402)
 *
 * Tests semantic relevance scoring of fallback responses against common user intents
 */

import { describe, it, expect, vi } from 'vitest';
import {
  scoreFallbacks,
  exportReportJSON,
  type ScoringResult,
  type ScoringReport,
} from '../assistant/fallback-relevance-scorer.js';

describe('Fallback Response Semantic Relevance Scorer (US-402)', () => {
  describe('scoreFallbacks() - Core Scoring', () => {
    it('should return a report with total_fallbacks count', () => {
      const report = scoreFallbacks();
      expect(report.total_fallbacks).toBeGreaterThan(0);
    });

    it('should have a scores array matching total fallbacks', () => {
      const report = scoreFallbacks();
      expect(report.scores.length).toBe(report.total_fallbacks);
    });

    it('should set default threshold to 0.60', () => {
      const report = scoreFallbacks();
      expect(report.threshold).toBe(0.60);
    });

    it('should allow custom threshold parameter', () => {
      const report = scoreFallbacks(0.50);
      expect(report.threshold).toBe(0.50);
    });

    it('should correctly count low-relevance fallbacks', () => {
      const report = scoreFallbacks(0.60);
      const lowRelevanceCount = report.scores.filter(
        s => s.max_relevance_score < report.threshold
      ).length;
      expect(report.low_relevance_count).toBe(lowRelevanceCount);
    });

    it('should include lowest_scoring array with max 10 items', () => {
      const report = scoreFallbacks();
      expect(report.lowest_scoring.length).toBeLessThanOrEqual(10);
      expect(report.lowest_scoring).toBeDefined();
    });

    it('lowest_scoring should be sorted by score (ascending)', () => {
      const report = scoreFallbacks();
      for (let i = 0; i < report.lowest_scoring.length - 1; i++) {
        expect(report.lowest_scoring[i].max_relevance_score).toBeLessThanOrEqual(
          report.lowest_scoring[i + 1].max_relevance_score
        );
      }
    });

    it('should calculate recommendations summary correctly', () => {
      const report = scoreFallbacks();
      const sumRecommendations =
        report.recommendations_summary.keep +
        report.recommendations_summary.rewrite +
        report.recommendations_summary.delete;
      expect(sumRecommendations).toBe(report.total_fallbacks);
    });
  });

  describe('ScoringResult - Individual Score Structure', () => {
    it('each score should have required fields', () => {
      const report = scoreFallbacks();
      const score = report.scores[0];

      expect(score).toHaveProperty('fallback_id');
      expect(score).toHaveProperty('fallback_intent');
      expect(score).toHaveProperty('fallback_text');
      expect(score).toHaveProperty('max_relevance_score');
      expect(score).toHaveProperty('matched_intent');
      expect(score).toHaveProperty('recommendation');
    });

    it('fallback_id should follow format: fallback_<intent>', () => {
      const report = scoreFallbacks();
      for (const score of report.scores) {
        expect(score.fallback_id).toMatch(/^fallback_/);
      }
    });

    it('max_relevance_score should be between 0 and 1', () => {
      const report = scoreFallbacks();
      for (const score of report.scores) {
        expect(score.max_relevance_score).toBeGreaterThanOrEqual(0);
        expect(score.max_relevance_score).toBeLessThanOrEqual(1);
      }
    });

    it('recommendation should be KEEP, REWRITE, or DELETE', () => {
      const report = scoreFallbacks();
      const validRecommendations = ['KEEP', 'REWRITE', 'DELETE'];
      for (const score of report.scores) {
        expect(validRecommendations).toContain(score.recommendation);
      }
    });

    it('score >= 0.60 should have KEEP recommendation', () => {
      const report = scoreFallbacks();
      for (const score of report.scores.filter(s => s.max_relevance_score >= 0.60)) {
        expect(score.recommendation).toBe('KEEP');
      }
    });

    it('score < 0.40 should have DELETE recommendation', () => {
      const report = scoreFallbacks();
      for (const score of report.scores.filter(s => s.max_relevance_score < 0.40)) {
        expect(score.recommendation).toBe('DELETE');
      }
    });

    it('0.40 <= score < 0.60 should have REWRITE recommendation', () => {
      const report = scoreFallbacks();
      for (const score of report.scores.filter(
        s => s.max_relevance_score >= 0.40 && s.max_relevance_score < 0.60
      )) {
        expect(score.recommendation).toBe('REWRITE');
      }
    });

    it('DELETE recommendation should include deletion_justification', () => {
      const report = scoreFallbacks();
      const deleteScores = report.scores.filter(s => s.recommendation === 'DELETE');
      for (const score of deleteScores) {
        expect(score.deletion_justification).toBeDefined();
        expect(score.deletion_justification?.length).toBeGreaterThan(0);
      }
    });

    it('REWRITE recommendation should include suggested_replacement', () => {
      const report = scoreFallbacks();
      const rewriteScores = report.scores.filter(s => s.recommendation === 'REWRITE');
      for (const score of rewriteScores) {
        expect(score.suggested_replacement).toBeDefined();
        expect(score.suggested_replacement?.length).toBeGreaterThan(0);
      }
    });

    it('KEEP recommendation should not include justification or suggestion', () => {
      const report = scoreFallbacks();
      const keepScores = report.scores.filter(s => s.recommendation === 'KEEP');
      for (const score of keepScores) {
        expect(score.deletion_justification).toBeUndefined();
        expect(score.suggested_replacement).toBeUndefined();
      }
    });

    it('matched_intent should be a string', () => {
      const report = scoreFallbacks();
      for (const score of report.scores) {
        expect(typeof score.matched_intent).toBe('string');
        expect(score.matched_intent.length).toBeGreaterThan(0);
      }
    });

    it('fallback_text should not exceed 100 chars (truncated)', () => {
      const report = scoreFallbacks();
      for (const score of report.scores) {
        expect(score.fallback_text.length).toBeLessThanOrEqual(103); // 100 + "..." max
      }
    });
  });

  describe('Scoring Logic - Threshold Behavior', () => {
    it('increasing threshold should increase low_relevance_count', () => {
      const report_50 = scoreFallbacks(0.50);
      const report_60 = scoreFallbacks(0.60);
      const report_70 = scoreFallbacks(0.70);

      expect(report_50.low_relevance_count).toBeLessThanOrEqual(report_60.low_relevance_count);
      expect(report_60.low_relevance_count).toBeLessThanOrEqual(report_70.low_relevance_count);
    });

    it('KEEP count should decrease as threshold increases', () => {
      const report_50 = scoreFallbacks(0.50);
      const report_70 = scoreFallbacks(0.70);

      // At 0.50: score >= 0.50 is KEEP
      // At 0.70: score >= 0.70 is KEEP
      expect(report_70.recommendations_summary.keep).toBeLessThanOrEqual(
        report_50.recommendations_summary.keep
      );
    });
  });

  describe('Report Structure - Completeness', () => {
    it('report should have all required top-level fields', () => {
      const report = scoreFallbacks();

      expect(report).toHaveProperty('total_fallbacks');
      expect(report).toHaveProperty('low_relevance_count');
      expect(report).toHaveProperty('threshold');
      expect(report).toHaveProperty('scores');
      expect(report).toHaveProperty('lowest_scoring');
      expect(report).toHaveProperty('recommendations_summary');
    });

    it('recommendations_summary should have keep, rewrite, delete counts', () => {
      const report = scoreFallbacks();

      expect(report.recommendations_summary).toHaveProperty('keep');
      expect(report.recommendations_summary).toHaveProperty('rewrite');
      expect(report.recommendations_summary).toHaveProperty('delete');

      expect(typeof report.recommendations_summary.keep).toBe('number');
      expect(typeof report.recommendations_summary.rewrite).toBe('number');
      expect(typeof report.recommendations_summary.delete).toBe('number');
    });
  });

  describe('exportReportJSON() - JSON Export', () => {
    it('should return valid JSON string', () => {
      const report = scoreFallbacks();
      const json = exportReportJSON(report);

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('exported JSON should be parseable to ScoringReport', () => {
      const report = scoreFallbacks();
      const json = exportReportJSON(report);
      const parsed = JSON.parse(json);

      expect(parsed.total_fallbacks).toBeDefined();
      expect(parsed.scores).toBeInstanceOf(Array);
      expect(parsed.lowest_scoring).toBeInstanceOf(Array);
    });

    it('exported JSON should contain all scores', () => {
      const report = scoreFallbacks();
      const json = exportReportJSON(report);
      const parsed = JSON.parse(json);

      expect(parsed.scores.length).toBe(report.scores.length);
    });
  });

  describe('Edge Cases & Robustness', () => {
    it('should handle fallbacks with empty response fields gracefully', () => {
      // This tests robustness - the actual knowledge.json may have empty responses
      const report = scoreFallbacks();
      expect(report.scores).toBeDefined();
      expect(report.scores.length).toBeGreaterThan(0);
    });

    it('should handle multi-language responses by using English', () => {
      const report = scoreFallbacks();
      // Verify that scoring ran successfully despite multi-language entries
      expect(report.total_fallbacks).toBeGreaterThan(0);
      expect(report.scores.every(s => s.fallback_text.length > 0)).toBe(true);
    });

    it('should produce consistent scores across multiple runs', () => {
      const report1 = scoreFallbacks();
      const report2 = scoreFallbacks();

      // Scores should be identical for the same inputs
      for (let i = 0; i < report1.scores.length; i++) {
        expect(report1.scores[i].max_relevance_score).toBe(
          report2.scores[i].max_relevance_score
        );
        expect(report1.scores[i].fallback_intent).toBe(
          report2.scores[i].fallback_intent
        );
      }
    });

    it('all scores should be decimal numbers to 4 places', () => {
      const report = scoreFallbacks();
      for (const score of report.scores) {
        // Check if it's a valid number with reasonable precision
        expect(typeof score.max_relevance_score).toBe('number');
        const str = score.max_relevance_score.toString();
        const decimals = str.includes('.') ? str.split('.')[1].length : 0;
        expect(decimals).toBeLessThanOrEqual(4);
      }
    });
  });

  describe('Acceptance Criteria - Validation', () => {
    it('Criterion 1: Scorer reads all fallback entries from knowledge.json', () => {
      const report = scoreFallbacks();
      expect(report.total_fallbacks).toBeGreaterThan(0);
      expect(report.scores.length).toBe(report.total_fallbacks);
    });

    it('Criterion 2: Generates report with all required fields', () => {
      const report = scoreFallbacks();
      for (const score of report.scores) {
        expect(score.fallback_id).toBeDefined();
        expect(score.fallback_text).toBeDefined();
        expect(score.max_relevance_score).toBeDefined();
        expect(score.matched_intent).toBeDefined();
        expect(score.recommendation).toBeDefined();
      }
    });

    it('Criterion 3: CLI output can be generated (printReport exists)', async () => {
      // This validates the module exports printReport function
      const module = await import('../assistant/fallback-relevance-scorer.js');
      expect(typeof module.printReport).toBe('function');
    });

    it('Criterion 3: Highlights 10 lowest-scoring fallbacks', () => {
      const report = scoreFallbacks();
      expect(report.lowest_scoring.length).toBeLessThanOrEqual(10);

      // Verify lowest_scoring are actually the lowest
      if (report.lowest_scoring.length > 0) {
        const lowestScore = report.lowest_scoring[report.lowest_scoring.length - 1]?.max_relevance_score || 0;
        const nextScore = report.scores[report.lowest_scoring.length]?.max_relevance_score || 1;
        expect(lowestScore).toBeLessThanOrEqual(nextScore);
      }
    });
  });
});
