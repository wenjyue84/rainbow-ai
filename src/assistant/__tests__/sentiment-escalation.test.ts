/**
 * US-822 / US-914: Sentiment-based early escalation trigger tests
 * + US-914: Consecutive low-confidence escalation trigger tests
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeSentiment,
  trackSentiment,
  shouldEscalateOnSentimentForProfile,
  isSentimentEnabledForProfile,
} from '../sentiment-tracker.js';
import { detectHighStakeKeyword } from '../pipeline/stages/action-dispatch.js';
import { resetSentimentTracking, getSentimentStats } from '../sentiment-tracker.js';
import {
  trackConfidence,
  shouldEscalateOnConfidence,
  markConfidenceEscalation,
  resetConfidenceTracking,
  isConfidenceEscalationEnabled,
  getConfidenceStats,
} from '../confidence-tracker.js';

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

// ─── US-914: Structured chatbot-to-human escalation ────────────────────────

describe('US-914: Structured chatbot-to-human escalation', () => {

  describe('AC1(c): Sentiment escalation at threshold=2 (production default)', () => {
    const prodSettings = {
      sentiment_analysis: {
        enabled: true,
        consecutive_threshold: 2,
        cooldown_minutes: 0,
      },
    };

    it('does not escalate on first negative message', () => {
      const phone = uniquePhone();
      trackSentiment(phone, 'bad service', 'negative');
      const result = shouldEscalateOnSentimentForProfile(phone, prodSettings);
      expect(result.shouldEscalate).toBe(false);
      expect(result.consecutiveCount).toBe(1);
    });

    it('escalates on 2nd consecutive negative (AC1c: threshold=2)', () => {
      const phone = uniquePhone();
      trackSentiment(phone, 'terrible service', 'negative');
      trackSentiment(phone, 'still bad', 'negative');
      const result = shouldEscalateOnSentimentForProfile(phone, prodSettings);
      expect(result.shouldEscalate).toBe(true);
      expect(result.reason).toBe('sentiment');
      expect(result.consecutiveCount).toBe(2);
    });

    it('does not escalate if negative streak is broken', () => {
      const phone = uniquePhone();
      trackSentiment(phone, 'terrible', 'negative');
      trackSentiment(phone, 'thank you', 'positive'); // breaks streak
      trackSentiment(phone, 'this is bad', 'negative');
      const result = shouldEscalateOnSentimentForProfile(phone, prodSettings);
      expect(result.shouldEscalate).toBe(false);
      expect(result.consecutiveCount).toBe(1);
    });
  });

  describe('AC1(d): High-stakes keyword detection', () => {
    it('detects "refund" keyword', () => {
      expect(detectHighStakeKeyword('I want a refund')).toBe('refund');
    });

    it('detects "legal" keyword', () => {
      expect(detectHighStakeKeyword('I will take legal action')).toBe('legal');
    });

    it('detects "urgent" keyword', () => {
      expect(detectHighStakeKeyword('this is urgent please help')).toBe('urgent');
    });

    it('detects "sue" keyword', () => {
      expect(detectHighStakeKeyword('I will sue you')).toBe('sue');
    });

    it('returns null for non-high-stakes messages', () => {
      expect(detectHighStakeKeyword('what time is check-in')).toBeNull();
      expect(detectHighStakeKeyword('I want to book a room')).toBeNull();
      expect(detectHighStakeKeyword('thank you')).toBeNull();
    });

    it('is case-insensitive', () => {
      expect(detectHighStakeKeyword('URGENT HELP NEEDED')).toBe('urgent');
      expect(detectHighStakeKeyword('REFUND please')).toBe('refund');
    });
  });

  describe('AC1(a): Human request detection via sentiment keywords', () => {
    it('detects "complaint" keyword as negative sentiment', () => {
      expect(analyzeSentiment('I have a complaint')).toBe('negative');
    });

    it('detects "cancel" keyword as negative sentiment', () => {
      expect(analyzeSentiment('I want to cancel')).toBe('negative');
    });

    it('detects "manager" keyword as negative sentiment', () => {
      expect(analyzeSentiment('speak to manager please')).toBe('negative');
    });
  });

  describe('AC6: Sentiment state reset after escalation', () => {
    it('resetSentimentTracking clears consecutive counter', () => {
      const phone = uniquePhone();
      trackSentiment(phone, 'bad', 'negative');
      trackSentiment(phone, 'terrible', 'negative');
      resetSentimentTracking(phone);
      const stats = getSentimentStats(phone);
      expect(stats?.consecutiveNegative).toBe(0);
    });
  });

  // ─── AC1(b): Consecutive low-confidence escalation ────────────────────────

  describe('AC1(b): Consecutive low-confidence escalation', () => {
    const settings = {
      confidence_escalation: {
        enabled: true,
        threshold: 0.4,
        consecutive_count: 2,
        cooldown_minutes: 0, // no cooldown for tests
      },
    };

    it('does not escalate on first low-confidence response', () => {
      const phone = uniquePhone();
      trackConfidence(phone, 0.35, settings);
      const result = shouldEscalateOnConfidence(phone, settings);
      expect(result.shouldEscalate).toBe(false);
      expect(result.consecutiveCount).toBe(1);
    });

    it('escalates on 2 consecutive low-confidence responses', () => {
      const phone = uniquePhone();
      trackConfidence(phone, 0.3, settings);
      trackConfidence(phone, 0.38, settings);
      const result = shouldEscalateOnConfidence(phone, settings);
      expect(result.shouldEscalate).toBe(true);
      expect(result.consecutiveCount).toBe(2);
    });

    it('resets on above-threshold confidence', () => {
      const phone = uniquePhone();
      trackConfidence(phone, 0.3, settings);
      trackConfidence(phone, 0.85, settings); // resets
      trackConfidence(phone, 0.35, settings);
      const result = shouldEscalateOnConfidence(phone, settings);
      expect(result.shouldEscalate).toBe(false);
      expect(result.consecutiveCount).toBe(1);
    });

    it('respects custom threshold', () => {
      const phone = uniquePhone();
      const lenientSettings = {
        confidence_escalation: {
          enabled: true,
          threshold: 0.3,
          consecutive_count: 2,
          cooldown_minutes: 0,
        },
      };
      trackConfidence(phone, 0.35, lenientSettings); // above 0.3 — resets
      trackConfidence(phone, 0.25, lenientSettings);
      const result = shouldEscalateOnConfidence(phone, lenientSettings);
      expect(result.shouldEscalate).toBe(false);
      expect(result.consecutiveCount).toBe(1);
    });

    it('respects custom consecutive count', () => {
      const phone = uniquePhone();
      const strictSettings = {
        confidence_escalation: {
          enabled: true,
          threshold: 0.4,
          consecutive_count: 3,
          cooldown_minutes: 0,
        },
      };
      trackConfidence(phone, 0.3, strictSettings);
      trackConfidence(phone, 0.35, strictSettings);
      const r1 = shouldEscalateOnConfidence(phone, strictSettings);
      expect(r1.shouldEscalate).toBe(false); // only 2, need 3

      trackConfidence(phone, 0.2, strictSettings);
      const r2 = shouldEscalateOnConfidence(phone, strictSettings);
      expect(r2.shouldEscalate).toBe(true);
      expect(r2.consecutiveCount).toBe(3);
    });

    it('markConfidenceEscalation resets counter', () => {
      const phone = uniquePhone();
      trackConfidence(phone, 0.3, settings);
      trackConfidence(phone, 0.35, settings);
      markConfidenceEscalation(phone);
      const stats = getConfidenceStats(phone);
      expect(stats?.consecutiveLow).toBe(0);
      expect(stats?.lastEscalationAt).toBeGreaterThan(0);
    });

    it('resetConfidenceTracking resets counter without setting escalation time', () => {
      const phone = uniquePhone();
      trackConfidence(phone, 0.2, settings);
      trackConfidence(phone, 0.3, settings);
      resetConfidenceTracking(phone);
      const stats = getConfidenceStats(phone);
      expect(stats?.consecutiveLow).toBe(0);
      expect(stats?.lastEscalationAt).toBeNull();
    });

    it('returns false for unknown phone', () => {
      const result = shouldEscalateOnConfidence('never_seen_phone', settings);
      expect(result.shouldEscalate).toBe(false);
      expect(result.consecutiveCount).toBe(0);
    });

    it('isConfidenceEscalationEnabled checks settings', () => {
      expect(isConfidenceEscalationEnabled({ confidence_escalation: { enabled: true } })).toBe(true);
      expect(isConfidenceEscalationEnabled({ confidence_escalation: { enabled: false } })).toBe(false);
      expect(isConfidenceEscalationEnabled({})).toBe(true); // defaults to enabled
      expect(isConfidenceEscalationEnabled(null)).toBe(true); // defaults to enabled
    });
  });
});
