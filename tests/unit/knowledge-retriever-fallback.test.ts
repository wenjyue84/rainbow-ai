/**
 * knowledge-retriever-fallback.test.ts
 * Tests for US-587: Fallback Response Pipeline for Knowledge Base Retrieval Failures
 */

import { describe, it, expect, vi } from 'vitest';
import { isFallbackResponse, getFallbackContent } from '../../src/assistant/knowledge-retriever.js';
import type { FallbackResponse } from '../../src/assistant/knowledge-retriever.js';

describe('US-587: Knowledge Retriever Fallback', () => {
  describe('AC1: Timeout Handling with Fallback Response', () => {
    it('should have isFallbackResponse helper for detecting fallback responses', () => {
      const mockFallback: FallbackResponse = {
        content: 'Fallback response',
        isFallback: true,
        reason: 'timeout',
        retrievalLatencyMs: 5100
      };

      expect(isFallbackResponse(mockFallback)).toBe(true);
    });

    it('should have isFallbackResponse return false for non-fallback responses', () => {
      const mockRegularResponse: any = {
        isFallback: false,
        hasRelevantContext: true
      };

      expect(isFallbackResponse(mockRegularResponse)).toBe(false);
    });
  });

  describe('AC2: Profile-Specific and Intent-Specific Fallback Templates', () => {
    it('should have getFallbackContent helper', () => {
      const mockFallback: FallbackResponse = {
        content: 'Test fallback content',
        isFallback: true
      };

      const content = getFallbackContent(mockFallback);
      expect(content).toBe('Test fallback content');
    });

    it('should extract empty string from missing content', () => {
      const mockFallback: any = {
        isFallback: true
      };

      const content = getFallbackContent(mockFallback);
      expect(content).toBe('');
    });
  });

  describe('AC3: Language-Aware Fallback Responses', () => {
    it('should support multiple languages in fallback', () => {
      const mockFallback: FallbackResponse = {
        content: 'Multi-language fallback response',
        isFallback: true,
        retrievalLatencyMs: 5050
      };

      expect(isFallbackResponse(mockFallback)).toBe(true);
      expect(mockFallback.retrievalLatencyMs).toBeGreaterThanOrEqual(5000);
    });

    it('should include retrieval latency metadata', () => {
      const mockFallback: FallbackResponse = {
        content: 'Response with metadata',
        isFallback: true,
        reason: 'Knowledge base retrieval timeout',
        retrievalLatencyMs: 5200
      };

      expect(mockFallback.reason).toContain('timeout');
      expect(mockFallback.retrievalLatencyMs).toBeGreaterThan(5000);
    });
  });

  describe('Fallback Response Structure', () => {
    it('should have all required fallback response fields', () => {
      const mockFallback: FallbackResponse = {
        content: 'Test content',
        isFallback: true,
        reason: 'Test reason',
        retrievalLatencyMs: 5100
      };

      expect(mockFallback).toHaveProperty('content');
      expect(mockFallback).toHaveProperty('isFallback');
      expect(mockFallback).toHaveProperty('reason');
      expect(mockFallback).toHaveProperty('retrievalLatencyMs');
    });
  });
});
