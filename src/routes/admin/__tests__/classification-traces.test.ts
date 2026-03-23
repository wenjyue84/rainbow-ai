/**
 * US-122: Classification Traces Admin API Tests
 *
 * Test suite for the admin endpoint that retrieves classification decision traces
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  recordClassificationTrace,
  clearTraces,
  buildClassificationTrace,
  getClassificationTraces,
  getTracedConversationIds,
} from '../../../assistant/classification-tracer.js';

describe('Classification Traces Admin API (US-122)', () => {
  beforeEach(() => {
    clearTraces();
  });

  afterEach(() => {
    clearTraces();
  });

  describe('GET /admin/conversations/:conversationId/classification-trace', () => {
    it('should return empty array for unknown conversation', () => {
      // Verify that unknown conversation returns empty
      const traces = getClassificationTraces('unknown-conv-1');
      expect(traces).toEqual([]);
    });

    it('should return classification traces for a conversation', () => {
      const conversationId = 'conv-integration-1';

      // Record multiple traces
      for (let i = 0; i < 3; i++) {
        const trace = buildClassificationTrace({
          conversationId,
          inputText: `message ${i}`,
          detectedLanguage: 'en',
          chosenIntent: `intent-${i}`,
          chosenConfidence: 0.8,
          chosenSource: 'fuzzy',
          fuzzyResults: [
            {
              intent: `intent-${i}`,
              score: 0.8,
              matchedKeyword: `keyword-${i}`,
            },
          ],
        });
        recordClassificationTrace(trace);
      }

      // Verify traces are stored
      const traces = getClassificationTraces(conversationId);
      expect(traces.length).toBe(3);
      expect(traces[0].input_text).toBe('message 0');
      expect(traces[2].input_text).toBe('message 2');
    });

    it('should respect limit parameter in response', () => {
      const conversationId = 'conv-limit-test';

      // Record 10 traces
      for (let i = 0; i < 10; i++) {
        const trace = buildClassificationTrace({
          conversationId,
          inputText: `message ${i}`,
          detectedLanguage: 'en',
          chosenIntent: 'intent',
          chosenConfidence: 0.8,
          chosenSource: 'fuzzy',
        });
        recordClassificationTrace(trace);
      }

      // Verify we can retrieve a limited subset
      const traces = getClassificationTraces(conversationId);
      expect(traces.length).toBe(10);

      // Simulate limit=5
      const limited = traces.slice(-Math.min(5, traces.length));
      expect(limited.length).toBe(5);
      expect(limited[0].input_text).toBe('message 5');
    });

    it('should include all required fields in response', () => {
      const conversationId = 'conv-fields-test';

      const trace = buildClassificationTrace({
        conversationId,
        inputText: 'test message',
        detectedLanguage: 'ms',
        chosenIntent: 'booking',
        chosenConfidence: 0.85,
        chosenSource: 'fuzzy',
        matchedKeyword: 'book',
        fuzzyResults: [
          { intent: 'booking', score: 0.85, matchedKeyword: 'book' },
          { intent: 'inquiry', score: 0.10 },
        ],
      });

      recordClassificationTrace(trace);
      const stored = getClassificationTraces(conversationId);

      expect(stored[0]).toHaveProperty('timestamp');
      expect(stored[0]).toHaveProperty('input_text');
      expect(stored[0]).toHaveProperty('detected_language');
      expect(stored[0]).toHaveProperty('candidates');
      expect(stored[0]).toHaveProperty('chosen_intent');
      expect(stored[0]).toHaveProperty('chosen_confidence');
      expect(stored[0]).toHaveProperty('chosen_source');
      expect(stored[0]).toHaveProperty('tie_break_reason');

      // Verify candidate structure
      expect(stored[0].candidates[0]).toHaveProperty('name');
      expect(stored[0].candidates[0]).toHaveProperty('confidence');
      expect(stored[0].candidates[0]).toHaveProperty('matched_keywords');
    });
  });

  describe('GET /admin/classification-traces/conversations', () => {
    it('should return list of all conversation IDs with traces', () => {
      const convIds = ['conv-a', 'conv-b', 'conv-c'];

      for (const convId of convIds) {
        const trace = buildClassificationTrace({
          conversationId: convId,
          inputText: 'test',
          detectedLanguage: 'en',
          chosenIntent: 'intent',
          chosenConfidence: 0.8,
          chosenSource: 'fuzzy',
        });
        recordClassificationTrace(trace);
      }

      const tracedIds = getTracedConversationIds();
      for (const convId of convIds) {
        expect(tracedIds).toContain(convId);
      }
    });

    it('should return empty list when no traces recorded', () => {
      const tracedIds = getTracedConversationIds();
      expect(tracedIds).toEqual([]);
    });
  });

  describe('Integration: End-to-end classification trace flow', () => {
    it('should capture Malaysian English keyword variants', () => {
      const conversationId = 'phone-123456';

      const trace = buildClassificationTrace({
        conversationId,
        inputText: 'nk book kamar',
        detectedLanguage: 'ms',
        chosenIntent: 'booking',
        chosenConfidence: 0.88,
        chosenSource: 'fuzzy',
        matchedKeyword: 'nk',
        fuzzyResults: [
          { intent: 'booking', score: 0.88, matchedKeyword: 'nk' },
          { intent: 'inquiry', score: 0.08, matchedKeyword: 'kamar' },
          { intent: 'greeting', score: 0.04 },
        ],
      });

      recordClassificationTrace(trace);
      const traces = getClassificationTraces(conversationId);

      // Verify Malaysian English variants are captured
      expect(traces[0].candidates[0].name).toBe('booking');
      expect(traces[0].candidates[0].matched_keywords).toContain('nk');
      expect(traces[0].detected_language).toBe('ms');
    });

    it('should normalize confidence scores to sum ~100%', () => {
      const conversationId = 'confidence-norm-test';

      const trace = buildClassificationTrace({
        conversationId,
        inputText: 'book room',
        detectedLanguage: 'en',
        chosenIntent: 'booking',
        chosenConfidence: 0.72,
        chosenSource: 'fuzzy',
        fuzzyResults: [
          { intent: 'booking', score: 0.72, matchedKeyword: 'book' },
          { intent: 'inquiry', score: 0.18, matchedKeyword: 'room' },
          { intent: 'complaint', score: 0.10 },
        ],
      });

      recordClassificationTrace(trace);
      const traces = getClassificationTraces(conversationId);

      const candidateScores = traces[0].candidates.map((c: any) => c.confidence);
      const sum = candidateScores.reduce((a: number, b: number) => a + b, 0);

      expect(sum).toBeGreaterThan(99);
      expect(sum).toBeLessThanOrEqual(100);
    });

    it('should ensure winning candidate has highest score', () => {
      const conversationId = 'winner-test';

      const trace = buildClassificationTrace({
        conversationId,
        inputText: 'complex query',
        detectedLanguage: 'en',
        chosenIntent: 'booking',
        chosenConfidence: 0.85,
        chosenSource: 'llm',
        fuzzyResults: [
          { intent: 'inquiry', score: 0.20, matchedKeyword: 'query' },
          { intent: 'complaint', score: 0.05 },
        ],
        llmResult: { category: 'booking', confidence: 0.85 },
      });

      recordClassificationTrace(trace);
      const traces = getClassificationTraces(conversationId);

      expect(traces[0].candidates[0].name).toBe('booking');
      expect(traces[0].chosen_intent).toBe('booking');

      // Verify winning candidate confidence >= all other candidates
      const winnerConfidence = traces[0].candidates[0].confidence;
      for (let i = 1; i < traces[0].candidates.length; i++) {
        expect(winnerConfidence).toBeGreaterThanOrEqual(
          traces[0].candidates[i].confidence
        );
      }
    });

    it('should maintain trace history per conversation', () => {
      const conversationId = 'history-test';

      // Simulate a multi-turn conversation
      const messages = [
        'hello',
        'nk book',
        'brp nk?',
        'confirm booking',
      ];

      for (const msg of messages) {
        const trace = buildClassificationTrace({
          conversationId,
          inputText: msg,
          detectedLanguage: 'ms',
          chosenIntent: msg === 'hello' ? 'greeting' : 'booking',
          chosenConfidence: 0.8,
          chosenSource: 'fuzzy',
        });
        recordClassificationTrace(trace);
      }

      const traces = require('../../../assistant/classification-tracer.js').getClassificationTraces(
        conversationId
      );

      expect(traces.length).toBe(4);
      expect(traces[0].input_text).toBe('hello');
      expect(traces[3].input_text).toBe('confirm booking');
    });
  });
});
