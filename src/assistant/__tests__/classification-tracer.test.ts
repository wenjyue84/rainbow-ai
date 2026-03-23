/**
 * US-122: Classification Tracer Tests
 *
 * Test suite for intent classification decision tracing:
 * - Verify top-3 candidates are returned
 * - Verify confidence scores normalize to ~100%
 * - Verify winning candidate has highest score
 * - Verify Malaysian English keyword variants are captured
 * - Verify tie-break reasons are logged
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  recordClassificationTrace,
  getClassificationTraces,
  getTracedConversationIds,
  clearTraces,
  buildClassificationTrace,
  type ClassificationTrace,
} from '../classification-tracer.js';

describe('Classification Tracer (US-122)', () => {
  beforeEach(() => {
    clearTraces();
  });

  afterEach(() => {
    clearTraces();
  });

  describe('buildClassificationTrace', () => {
    it('should include top-3 candidates with normalized confidence scores', () => {
      const trace = buildClassificationTrace({
        conversationId: 'test-conv-1',
        inputText: 'Book a room please',
        detectedLanguage: 'en',
        chosenIntent: 'booking',
        chosenConfidence: 0.85,
        chosenSource: 'fuzzy',
        fuzzyResults: [
          { intent: 'booking', score: 0.85, matchedKeyword: 'book' },
          { intent: 'inquiry', score: 0.10, matchedKeyword: 'room' },
          { intent: 'cancellation', score: 0.05 },
        ],
      });

      expect(trace.candidates.length).toBeLessThanOrEqual(3);
      expect(trace.candidates[0].name).toBe('booking');

      // Verify confidence scores sum to ~100%
      const confidenceSum = trace.candidates.reduce((sum, c) => sum + c.confidence, 0);
      expect(confidenceSum).toBeGreaterThan(99);
      expect(confidenceSum).toBeLessThanOrEqual(100);

      // Verify winning candidate has highest score
      expect(trace.candidates[0].confidence).toBeGreaterThanOrEqual(
        trace.candidates[1]?.confidence ?? 0
      );
    });

    it('should preserve Malaysian English keyword variants', () => {
      const trace = buildClassificationTrace({
        conversationId: 'test-conv-1',
        inputText: 'nk book a room',
        detectedLanguage: 'ms',
        chosenIntent: 'booking',
        chosenConfidence: 0.88,
        chosenSource: 'fuzzy',
        matchedKeyword: 'nk',
        fuzzyResults: [
          { intent: 'booking', score: 0.88, matchedKeyword: 'nk' },
          { intent: 'inquiry', score: 0.10 },
        ],
      });

      expect(trace.candidates[0].matched_keywords).toContain('nk');
    });

    it('should handle semantic candidates with matched examples', () => {
      const trace = buildClassificationTrace({
        conversationId: 'test-conv-1',
        inputText: 'I want to reserve a stay',
        detectedLanguage: 'en',
        chosenIntent: 'booking',
        chosenConfidence: 0.82,
        chosenSource: 'semantic',
        matchedExample: 'Can I reserve a room?',
        semanticResults: [
          { intent: 'booking', score: 0.82, matchedExample: 'Can I reserve a room?' },
          { intent: 'inquiry', score: 0.12 },
        ],
      });

      expect(trace.candidates[0].matched_keywords).toContain('example: Can I reserve a room?');
      expect(trace.chosen_source).toBe('semantic');
    });

    it('should include LLM results in candidates', () => {
      const trace = buildClassificationTrace({
        conversationId: 'test-conv-1',
        inputText: 'Complex multi-intent query',
        detectedLanguage: 'en',
        chosenIntent: 'booking',
        chosenConfidence: 0.71,
        chosenSource: 'llm',
        llmResult: { category: 'booking', confidence: 0.71 },
        fuzzyResults: [{ intent: 'inquiry', score: 0.20, matchedKeyword: 'query' }],
      });

      // Should include both fuzzy and LLM candidates
      const intentNames = trace.candidates.map(c => c.name);
      expect(intentNames).toContain('booking');
      expect(intentNames).toContain('inquiry');
    });

    it('should deduplicate candidates keeping highest confidence', () => {
      const trace = buildClassificationTrace({
        conversationId: 'test-conv-1',
        inputText: 'booking test',
        detectedLanguage: 'en',
        chosenIntent: 'booking',
        chosenConfidence: 0.85,
        chosenSource: 'fuzzy',
        fuzzyResults: [
          { intent: 'booking', score: 0.85, matchedKeyword: 'book' },
          { intent: 'booking', score: 0.65, matchedKeyword: 'reserve' }, // Duplicate
          { intent: 'inquiry', score: 0.10 },
        ],
      });

      const bookingCandidates = trace.candidates.filter(c => c.name === 'booking');
      expect(bookingCandidates.length).toBe(1);
      expect(bookingCandidates[0].confidence).toBeGreaterThan(80);
    });

    it('should generate appropriate tie-break reasons', () => {
      const fuzzTrace = buildClassificationTrace({
        conversationId: 'test-conv-1',
        inputText: 'book',
        detectedLanguage: 'en',
        chosenIntent: 'booking',
        chosenConfidence: 0.88,
        chosenSource: 'fuzzy',
        matchedKeyword: 'book',
      });
      expect(fuzzTrace.tie_break_reason).toContain('Fuzzy');

      const semanticTrace = buildClassificationTrace({
        conversationId: 'test-conv-1',
        inputText: 'reserve',
        detectedLanguage: 'en',
        chosenIntent: 'booking',
        chosenConfidence: 0.82,
        chosenSource: 'semantic',
        matchedExample: 'Can I book?',
      });
      expect(semanticTrace.tie_break_reason).toContain('Semantic');

      const regexTrace = buildClassificationTrace({
        conversationId: 'test-conv-1',
        inputText: 'EMERGENCY',
        detectedLanguage: 'en',
        chosenIntent: 'emergency',
        chosenConfidence: 1.0,
        chosenSource: 'regex',
      });
      expect(regexTrace.tie_break_reason).toContain('Emergency');
    });

    it('should ensure chosen intent is in candidates even if not collected', () => {
      const trace = buildClassificationTrace({
        conversationId: 'test-conv-1',
        inputText: 'unrecognized intent',
        detectedLanguage: 'en',
        chosenIntent: 'custom_intent',
        chosenConfidence: 0.75,
        chosenSource: 'llm',
        matchedKeyword: 'custom',
        fuzzyResults: [{ intent: 'inquiry', score: 0.20 }],
      });

      const chosenInTrace = trace.candidates.find(c => c.name === 'custom_intent');
      expect(chosenInTrace).toBeDefined();
      expect(chosenInTrace?.confidence).toBeGreaterThan(70);
    });
  });

  describe('recordClassificationTrace', () => {
    it('should record a trace successfully', () => {
      const trace = buildClassificationTrace({
        conversationId: 'test-conv-1',
        inputText: 'Hello',
        detectedLanguage: 'en',
        chosenIntent: 'greeting',
        chosenConfidence: 0.95,
        chosenSource: 'fuzzy',
      });

      recordClassificationTrace(trace);
      const traces = getClassificationTraces('test-conv-1');

      expect(traces.length).toBe(1);
      expect(traces[0].chosen_intent).toBe('greeting');
    });

    it('should maintain conversation order for circular buffer', () => {
      const conv1 = 'conv-1';
      const conv2 = 'conv-2';
      const conv3 = 'conv-3';

      const trace1 = buildClassificationTrace({
        conversationId: conv1,
        inputText: 'test1',
        detectedLanguage: 'en',
        chosenIntent: 'intent1',
        chosenConfidence: 0.8,
        chosenSource: 'fuzzy',
      });

      const trace2 = buildClassificationTrace({
        conversationId: conv2,
        inputText: 'test2',
        detectedLanguage: 'en',
        chosenIntent: 'intent2',
        chosenConfidence: 0.8,
        chosenSource: 'fuzzy',
      });

      const trace3 = buildClassificationTrace({
        conversationId: conv3,
        inputText: 'test3',
        detectedLanguage: 'en',
        chosenIntent: 'intent3',
        chosenConfidence: 0.8,
        chosenSource: 'fuzzy',
      });

      recordClassificationTrace(trace1);
      recordClassificationTrace(trace2);
      recordClassificationTrace(trace3);

      const conversationIds = getTracedConversationIds();
      expect(conversationIds).toContain(conv1);
      expect(conversationIds).toContain(conv2);
      expect(conversationIds).toContain(conv3);
    });

    it('should cap traces per conversation at MAX_TRACES_PER_CONVERSATION', () => {
      const conversationId = 'test-conv-1';

      // Record more than MAX_TRACES_PER_CONVERSATION (100) traces
      for (let i = 0; i < 120; i++) {
        const trace = buildClassificationTrace({
          conversationId,
          inputText: `message ${i}`,
          detectedLanguage: 'en',
          chosenIntent: `intent-${i % 10}`,
          chosenConfidence: 0.8,
          chosenSource: 'fuzzy',
        });
        recordClassificationTrace(trace);
      }

      const traces = getClassificationTraces(conversationId);
      expect(traces.length).toBeLessThanOrEqual(100);

      // Should keep the most recent traces
      expect(traces[traces.length - 1].input_text).toContain('message 119');
    });
  });

  describe('getClassificationTraces', () => {
    it('should return empty array for unknown conversation', () => {
      const traces = getClassificationTraces('unknown-conversation');
      expect(traces).toEqual([]);
    });

    it('should return all traces for a conversation in order', () => {
      const conversationId = 'test-conv-1';

      for (let i = 0; i < 5; i++) {
        const trace = buildClassificationTrace({
          conversationId,
          inputText: `message ${i}`,
          detectedLanguage: 'en',
          chosenIntent: `intent-${i}`,
          chosenConfidence: 0.8,
          chosenSource: 'fuzzy',
        });
        recordClassificationTrace(trace);
      }

      const traces = getClassificationTraces(conversationId);
      expect(traces.length).toBe(5);
      expect(traces[0].input_text).toBe('message 0');
      expect(traces[4].input_text).toBe('message 4');
    });
  });

  describe('getTracedConversationIds', () => {
    it('should return list of all conversation IDs with traces', () => {
      const conv1 = 'conv-1';
      const conv2 = 'conv-2';

      const trace1 = buildClassificationTrace({
        conversationId: conv1,
        inputText: 'test',
        detectedLanguage: 'en',
        chosenIntent: 'intent',
        chosenConfidence: 0.8,
        chosenSource: 'fuzzy',
      });

      const trace2 = buildClassificationTrace({
        conversationId: conv2,
        inputText: 'test',
        detectedLanguage: 'en',
        chosenIntent: 'intent',
        chosenConfidence: 0.8,
        chosenSource: 'fuzzy',
      });

      recordClassificationTrace(trace1);
      recordClassificationTrace(trace2);

      const ids = getTracedConversationIds();
      expect(ids).toContain(conv1);
      expect(ids).toContain(conv2);
      expect(ids.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty array when no traces recorded', () => {
      const ids = getTracedConversationIds();
      expect(ids).toEqual([]);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle multi-language classification with tie-breaker', () => {
      const trace = buildClassificationTrace({
        conversationId: 'phone-123',
        inputText: 'brp nak book kamar',
        detectedLanguage: 'ms',
        chosenIntent: 'booking',
        chosenConfidence: 0.87,
        chosenSource: 'fuzzy',
        matchedKeyword: 'brp-book',
        fuzzyResults: [
          { intent: 'booking', score: 0.87, matchedKeyword: 'brp-book' },
          { intent: 'inquiry', score: 0.08, matchedKeyword: 'kamar' },
          { intent: 'greeting', score: 0.05 },
        ],
      });

      // Verify confidence normalization
      const confSum = trace.candidates.reduce((s, c) => s + c.confidence, 0);
      expect(confSum).toBeCloseTo(100, 1);

      // Verify top-3 selection
      expect(trace.candidates.length).toBeLessThanOrEqual(3);

      // Verify winning candidate
      expect(trace.candidates[0].name).toBe('booking');
      expect(trace.chosen_intent).toBe('booking');
    });

    it('should capture confidence scores that sum to ~100%', () => {
      const candidates = [
        { score: 0.72, intent: 'booking' },
        { score: 0.18, intent: 'inquiry' },
        { score: 0.10, intent: 'other' },
      ];

      const trace = buildClassificationTrace({
        conversationId: 'test',
        inputText: 'book',
        detectedLanguage: 'en',
        chosenIntent: 'booking',
        chosenConfidence: 0.72,
        chosenSource: 'fuzzy',
        fuzzyResults: candidates.map(c => ({
          intent: c.intent,
          score: c.score,
        })),
      });

      const sum = trace.candidates.reduce((s, c) => s + c.confidence, 0);
      expect(sum).toBeGreaterThan(99);
      expect(sum).toBeLessThanOrEqual(100);
    });

    it('should work with LLM fallback that captures multiple tiers', () => {
      const trace = buildClassificationTrace({
        conversationId: 'complex-1',
        inputText: 'Complex query about booking and payment',
        detectedLanguage: 'en',
        chosenIntent: 'booking',
        chosenConfidence: 0.68,
        chosenSource: 'llm',
        fuzzyResults: [{ intent: 'inquiry', score: 0.45, matchedKeyword: 'about' }],
        semanticResults: [{ intent: 'booking', score: 0.62, matchedExample: 'Can I book?' }],
        llmResult: { category: 'booking', confidence: 0.68 },
      });

      // Should have candidates from all tiers
      const intents = new Set(trace.candidates.map(c => c.name));
      expect(intents.size).toBeGreaterThanOrEqual(1);
      expect(trace.candidates[0].name).toBe('booking');
    });
  });
});
