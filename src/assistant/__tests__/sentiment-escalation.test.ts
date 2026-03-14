/**
 * US-822: Sentiment-based early escalation trigger tests
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeSentiment,
  trackSentiment,
  shouldEscalateOnSentimentForProfile,
  isSentimentEnabledForProfile,
} from '../sentiment-tracker.js';

// Use unique phone per test to avoid cross-test state pollution
let phoneCounter = 0;
function uniquePhone(): string {
  return `601000${++phoneCounter}`;
}

describe('US-822: Sentiment-based escalation', () => {
  describe('analyzeSentiment', () => {
    it('detects negative sentiment from keywords', () => {
      expect(analyzeSentiment('this is terrible service')).toBe('negative');
      expect(analyzeSentiment('useless bot')).toBe('negative');
      expect(analyzeSentiment('I am angry')).toBe('negative');
      expect(analyzeSentiment('ridiculous wait time')).toBe('negative');
    });

    it('detects positive sentiment', () => {
      expect(analyzeSentiment('thank you so much')).toBe('positive');
      expect(analyzeSentiment('great service')).toBe('positive');
    });

    it('returns neutral for questions and plain text', () => {
      expect(analyzeSentiment('what time is checkout')).toBe('neutral');
      expect(analyzeSentiment('hi there')).toBe('neutral');
      expect(analyzeSentiment('room 201')).toBe('neutral');
    });

    it('detects negative emojis', () => {
      expect(analyzeSentiment('😡')).toBe('negative');
      expect(analyzeSentiment('🤬')).toBe('negative');
    });

    it('detects repeated exclamation marks via "ridiculous" keyword', () => {
      expect(analyzeSentiment('ridiculous!!')).toBe('negative');
    });
  });

  describe('shouldEscalateOnSentimentForProfile', () => {
    // Use 0 cooldown to avoid cooldown interference in tests
    const profileSettings = {
      sentiment_analysis: {
        enabled: true,
        consecutive_threshold: 3,
        cooldown_minutes: 0,
      },
    };

    it('does not escalate below threshold', () => {
      const phone = uniquePhone();
      trackSentiment(phone, 'bad service', 'negative');
      trackSentiment(phone, 'terrible', 'negative');
      const result = shouldEscalateOnSentimentForProfile(phone, profileSettings);
      expect(result.shouldEscalate).toBe(false);
      expect(result.consecutiveCount).toBe(2);
    });

    it('escalates at threshold (3 consecutive negative)', () => {
      const phone = uniquePhone();
      trackSentiment(phone, 'bad service', 'negative');
      trackSentiment(phone, 'terrible', 'negative');
      trackSentiment(phone, 'this is awful', 'negative');
      const result = shouldEscalateOnSentimentForProfile(phone, profileSettings);
      expect(result.shouldEscalate).toBe(true);
      expect(result.reason).toBe('sentiment');
      expect(result.consecutiveCount).toBe(3);
    });

    it('resets on non-negative message', () => {
      const phone = uniquePhone();
      trackSentiment(phone, 'bad', 'negative');
      trackSentiment(phone, 'terrible', 'negative');
      trackSentiment(phone, 'ok thanks', 'positive'); // reset
      trackSentiment(phone, 'awful', 'negative');
      const result = shouldEscalateOnSentimentForProfile(phone, profileSettings);
      expect(result.shouldEscalate).toBe(false);
      expect(result.consecutiveCount).toBe(1);
    });

    it('respects per-profile threshold override', () => {
      const phone = uniquePhone();
      const customSettings = {
        sentiment_analysis: {
          enabled: true,
          consecutive_threshold: 2,
          cooldown_minutes: 0,
        },
      };
      trackSentiment(phone, 'bad', 'negative');
      trackSentiment(phone, 'terrible', 'negative');
      const result = shouldEscalateOnSentimentForProfile(phone, customSettings);
      expect(result.shouldEscalate).toBe(true);
      expect(result.reason).toBe('sentiment');
    });

    it('returns false for unknown phone', () => {
      const result = shouldEscalateOnSentimentForProfile('unknown_never_seen', profileSettings);
      expect(result.shouldEscalate).toBe(false);
      expect(result.consecutiveCount).toBe(0);
    });
  });

  describe('isSentimentEnabledForProfile', () => {
    it('returns true when enabled', () => {
      expect(isSentimentEnabledForProfile({ sentiment_analysis: { enabled: true } })).toBe(true);
    });

    it('returns false when disabled', () => {
      expect(isSentimentEnabledForProfile({ sentiment_analysis: { enabled: false } })).toBe(false);
    });

    it('returns false when settings missing', () => {
      expect(isSentimentEnabledForProfile(null)).toBe(false);
      expect(isSentimentEnabledForProfile({})).toBe(false);
    });

    it('defaults to enabled when field omitted', () => {
      expect(isSentimentEnabledForProfile({ sentiment_analysis: {} })).toBe(true);
    });
  });
});
