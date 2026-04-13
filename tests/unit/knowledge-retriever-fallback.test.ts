/**
 * knowledge-retriever-fallback.test.ts
 * Tests for US-587: Fallback Response Pipeline for Knowledge Base Retrieval Failures
 *
 * Verifies:
 * - Timeout handling (>5s) with fallback response
 * - Profile-specific fallback template selection
 * - Language-aware fallback responses
 * - Fallback response metadata tracking
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  retrieveWithFallback,
  isFallbackResponse,
  getFallbackContent,
  type FallbackResponse
} from '../../src/assistant/knowledge-retriever.js';
import type { KnowledgeBaseInstance } from '../../src/assistant/knowledge-base-instance.js';
import type { RetrievalResult } from '../../src/assistant/rag/hybrid-retriever.js';

// Mock KnowledgeBaseInstance
const mockKBInstance = (behavior: 'success' | 'timeout' | 'error'): KnowledgeBaseInstance => {
  const instance = {
    retrieveContext: vi.fn(async () => {
      if (behavior === 'success') {
        return {
          chunks: [{ text: 'Check-in is at 2 PM' }],
          hasRelevantContext: true,
          latencyMs: 200
        } as RetrievalResult;
      } else if (behavior === 'timeout') {
        // Simulate timeout by delaying longer than 5s
        await new Promise(resolve => setTimeout(resolve, 6000));
        return {} as RetrievalResult;
      } else {
        throw new Error('Retrieval service error');
      }
    })
  } as unknown as KnowledgeBaseInstance;

  return instance;
};

describe('US-587: Knowledge Retriever Fallback', () => {
  describe('AC1: Timeout Handling with Fallback Response', () => {
    it('should catch retrieval timeout (>5s) and return fallback response', async () => {
      const kb = mockKBInstance('timeout');

      const result = await retrieveWithFallback(
        kb,
        'When can I check in?',
        'checkin_info',
        'en',
        'pelangi'
      );

      expect(result.isFallback).toBe(true);
      expect(result.reason).toMatch(/timeout/i);
      expect(result.content).toBeTruthy();
      expect(result.content.length).toBeGreaterThan(0);
    });

    it('should set retrievalLatencyMs to actual elapsed time', async () => {
      const kb = mockKBInstance('timeout');
      const startTime = Date.now();

      const result = await retrieveWithFallback(
        kb,
        'When can I check in?',
        'checkin_info',
        'en',
        'pelangi'
      );

      const elapsedMs = Date.now() - startTime;
      expect(result.retrievalLatencyMs).toBeGreaterThanOrEqual(5000);
      expect(result.retrievalLatencyMs).toBeLessThanOrEqual(elapsedMs + 100);
    });

    it('should handle other retrieval errors with fallback', async () => {
      const kb = mockKBInstance('error');

      const result = await retrieveWithFallback(
        kb,
        'What is the WiFi password?',
        'wifi',
        'en',
        'pelangi'
      );

      expect(result.isFallback).toBe(true);
      expect(result.reason).toBeTruthy();
      expect(result.content).toBeTruthy();
    });
  });

  describe('AC2: Profile-Specific and Intent-Specific Fallback Templates', () => {
    it('should return intent-specific fallback for pelangi profile', async () => {
      const kb = mockKBInstance('timeout');

      const result = await retrieveWithFallback(
        kb,
        'Tell me about check-in',
        'checkin_info',
        'en',
        'pelangi'
      );

      expect(result.isFallback).toBe(true);
      // Pelangi profile has hostel-specific templates mentioning "front desk"
      expect(result.content).toMatch(/front desk|check-in/i);
    });

    it('should return intent-specific fallback for makan profile', async () => {
      const kb = mockKBInstance('timeout');

      const result = await retrieveWithFallback(
        kb,
        'What is on the menu?',
        'menu_inquiry',
        'en',
        'makan'
      );

      expect(result.isFallback).toBe(true);
      // Makan profile has cafe-specific templates mentioning "menu" and "staff"
      expect(result.content).toMatch(/menu|staff/i);
    });

    it('should use generic kb_retrieval_failed template when intent template not found', async () => {
      const kb = mockKBInstance('timeout');

      const result = await retrieveWithFallback(
        kb,
        'Unknown intent query',
        'unknown_intent',
        'en',
        'pelangi'
      );

      expect(result.isFallback).toBe(true);
      // Should fall back to generic kb_retrieval_failed template
      expect(result.content).toBeTruthy();
      expect(result.content.length).toBeGreaterThan(0);
    });
  });

  describe('AC3: Language-Aware Fallback Responses', () => {
    it('should return English fallback response', async () => {
      const kb = mockKBInstance('timeout');

      const result = await retrieveWithFallback(
        kb,
        'Check-in time?',
        'checkin_info',
        'en',
        'pelangi'
      );

      expect(result.isFallback).toBe(true);
      // Should be English, not Malay/Chinese/Tamil
      expect(result.content).toMatch(/check-in details|front desk/i);
      expect(result.content).not.toMatch(/maklumat|信息|விவரங்கள/);
    });

    it('should return Malay fallback response', async () => {
      const kb = mockKBInstance('timeout');

      const result = await retrieveWithFallback(
        kb,
        'Waktu check-in?',
        'checkin_info',
        'ms',
        'pelangi'
      );

      expect(result.isFallback).toBe(true);
      // Should be Malay
      expect(result.content).toMatch(/maklumat|meja hadapan/i);
    });

    it('should return Chinese fallback response', async () => {
      const kb = mockKBInstance('timeout');

      const result = await retrieveWithFallback(
        kb,
        '入住时间？',
        'checkin_info',
        'zh',
        'pelangi'
      );

      expect(result.isFallback).toBe(true);
      // Should contain Chinese characters
      expect(result.content).toMatch(/信息|前台/);
    });

    it('should return Tamil fallback response', async () => {
      const kb = mockKBInstance('timeout');

      const result = await retrieveWithFallback(
        kb,
        'செக்-இன் நேரம்?',
        'checkin_info',
        'ta',
        'pelangi'
      );

      expect(result.isFallback).toBe(true);
      // Should contain Tamil characters
      expect(result.content).toMatch(/விவரங்கள|பணியாளர்/);
    });
  });

  describe('Fallback Response Helpers', () => {
    it('isFallbackResponse should detect fallback responses', async () => {
      const kb = mockKBInstance('timeout');

      const result = await retrieveWithFallback(
        kb,
        'Query',
        'checkin_info',
        'en',
        'pelangi'
      );

      expect(isFallbackResponse(result)).toBe(true);
    });

    it('isFallbackResponse should return false for successful responses', async () => {
      const kb = mockKBInstance('success');

      const result = await retrieveWithFallback(
        kb,
        'Query',
        'checkin_info',
        'en',
        'pelangi'
      );

      expect(isFallbackResponse(result)).toBe(false);
    });

    it('getFallbackContent should extract content from fallback response', async () => {
      const kb = mockKBInstance('timeout');

      const result = await retrieveWithFallback(
        kb,
        'Query',
        'checkin_info',
        'en',
        'pelangi'
      ) as FallbackResponse;

      const content = getFallbackContent(result);
      expect(content).toBe(result.content);
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('Successful Retrieval (Non-Fallback)', () => {
    it('should return successful retrieval without fallback', async () => {
      const kb = mockKBInstance('success');

      const result = await retrieveWithFallback(
        kb,
        'Query',
        'checkin_info',
        'en',
        'pelangi'
      );

      expect(result.isFallback).toBe(false);
      expect(result.hasRelevantContext).toBe(true);
      expect(result.chunks).toHaveLength(1);
    });
  });
});
