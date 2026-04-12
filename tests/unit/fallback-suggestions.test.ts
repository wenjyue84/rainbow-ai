/**
 * Unit tests for fallback suggestions (US-524)
 *
 * Tests for context-aware fallback suggestions based on conversation history
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateFallbackSuggestions } from '../../src/assistant/response-processor.js';
import * as db from '../../src/lib/db.js';

// Mock the db module
vi.mock('../../src/lib/db.js');

describe('generateFallbackSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return generic fallback when no conversation history', async () => {
    vi.mocked(db.getConversationIntentHistory).mockResolvedValue([]);

    const result = await generateFallbackSuggestions('60123456789', 'unclear message');

    expect(result.message).toBe("Could you rephrase that?");
    expect(result.suggestions).toEqual([]);
  });

  it('should return suggestions when conversation has relevant intent history', async () => {
    // Mock conversation with check-in related messages
    vi.mocked(db.getConversationIntentHistory).mockResolvedValue([
      {
        intent: 'checkin_info',
        content: 'When can I check in?',
        timestamp: new Date(Date.now() - 3600000)
      },
      {
        intent: null,
        content: 'What time is check in?',
        timestamp: new Date(Date.now() - 1800000)
      }
    ]);

    const result = await generateFallbackSuggestions('60123456789', 'when can i');

    // Should have message with suggestions
    expect(result.message).toContain("I'm not sure. Did you mean:");
    // Should have at least 1 suggestion (check_in related)
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('should rank suggestions by relevance score', async () => {
    vi.mocked(db.getConversationIntentHistory).mockResolvedValue([
      {
        intent: 'checkin_info',
        content: 'check in time',
        timestamp: new Date()
      }
    ]);

    const result = await generateFallbackSuggestions('60123456789', 'checkout what time');

    // Should have suggestions sorted by relevance
    if (result.suggestions.length > 1) {
      const scores = result.suggestions.map(s => s.relevanceScore);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
      }
    }
  });

  it('should filter suggestions with relevance score >= 0.5', async () => {
    vi.mocked(db.getConversationIntentHistory).mockResolvedValue([
      {
        intent: 'pricing',
        content: 'how much does it cost',
        timestamp: new Date()
      }
    ]);

    const result = await generateFallbackSuggestions('60123456789', 'rate');

    // All suggestions should have relevance score >= 0.5
    result.suggestions.forEach(suggestion => {
      expect(suggestion.relevanceScore).toBeGreaterThanOrEqual(0.5);
    });
  });

  it('should include keywords in suggestions', async () => {
    vi.mocked(db.getConversationIntentHistory).mockResolvedValue([
      {
        intent: 'checkin_info',
        content: 'check in',
        timestamp: new Date()
      }
    ]);

    const result = await generateFallbackSuggestions('60123456789', 'when');

    // All suggestions should have keywords array
    result.suggestions.forEach(suggestion => {
      expect(suggestion.keywords).toBeDefined();
      expect(Array.isArray(suggestion.keywords)).toBe(true);
    });
  });

  it('should return max 3 suggestions', async () => {
    vi.mocked(db.getConversationIntentHistory).mockResolvedValue([
      {
        intent: 'checkin_info',
        content: 'check in facilities pricing',
        timestamp: new Date()
      }
    ]);

    const result = await generateFallbackSuggestions('60123456789', 'information');

    // Should never return more than 3 suggestions
    expect(result.suggestions.length).toBeLessThanOrEqual(3);
  });

  it('should handle profile-specific knowledge base', async () => {
    vi.mocked(db.getConversationIntentHistory).mockResolvedValue([
      {
        intent: 'checkin_info',
        content: 'check in',
        timestamp: new Date()
      }
    ]);

    // Test with different profile
    const result = await generateFallbackSuggestions('60123456789', 'when', 'southern');

    // Should succeed without error
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
  });

  it('should format message with percentages', async () => {
    vi.mocked(db.getConversationIntentHistory).mockResolvedValue([
      {
        intent: 'checkin_info',
        content: 'check in when',
        timestamp: new Date()
      }
    ]);

    const result = await generateFallbackSuggestions('60123456789', 'checkin');

    if (result.suggestions.length > 0) {
      // Should contain percentage signs in message
      expect(result.message).toMatch(/%/);
    }
  });

  it('should gracefully handle missing data files', async () => {
    vi.mocked(db.getConversationIntentHistory).mockResolvedValue([
      {
        intent: 'unknown_intent',
        content: 'some message',
        timestamp: new Date()
      }
    ]);

    // Should not throw even if files are missing
    const result = await generateFallbackSuggestions('60123456789', 'test');

    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
  });

  it('should build conversation summary from history and current message', async () => {
    const mockHistory = [
      {
        intent: 'checkin_info',
        content: 'check in',
        timestamp: new Date(Date.now() - 3600000)
      },
      {
        intent: 'pricing',
        content: 'how much',
        timestamp: new Date(Date.now() - 1800000)
      }
    ];

    vi.mocked(db.getConversationIntentHistory).mockResolvedValue(mockHistory);

    const result = await generateFallbackSuggestions('60123456789', 'facilities');

    // Should incorporate all parts of conversation
    expect(result).toBeDefined();
    expect(result.suggestions).toBeDefined();
  });
});
