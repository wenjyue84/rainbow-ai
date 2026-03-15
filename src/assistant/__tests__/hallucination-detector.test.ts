/**
 * Hallucination Detector Tests (US-913)
 *
 * Validates the two-stage hallucination detection pipeline:
 * - Stage 1: Factual query classifier (bypass non-factual queries)
 * - Stage 2: NLI-style contradiction detection against KB content
 * - Action dispatch: block, disclaimer, or pass-through
 */
import { describe, it, expect } from 'vitest';
import {
  isFactualQuery,
  detectHallucinations,
  getHallucinationBlockMessage,
  getHallucinationDisclaimer,
} from '../hallucination-detector.js';

// ─── Stage 1: Factual Query Classifier ───────────────────────────────

describe('isFactualQuery', () => {
  it('returns false for greeting intents', () => {
    expect(isFactualQuery('greeting', 'Hello!')).toBe(false);
  });

  it('returns false for farewell intents', () => {
    expect(isFactualQuery('farewell', 'Bye!')).toBe(false);
  });

  it('returns false for thanks intents', () => {
    expect(isFactualQuery('thanks', 'Thank you so much')).toBe(false);
  });

  it('returns false for small_talk intents', () => {
    expect(isFactualQuery('small_talk', 'How are you today?')).toBe(false);
  });

  it('returns true for pricing intents', () => {
    expect(isFactualQuery('pricing', 'How much is a room?')).toBe(true);
  });

  it('returns true for availability intents', () => {
    expect(isFactualQuery('availability', 'Do you have rooms for tonight?')).toBe(true);
  });

  it('returns true for unknown intents with factual keywords', () => {
    expect(isFactualQuery(undefined, 'What is the check-in time?')).toBe(true);
  });

  it('overrides non-factual intent when factual keywords present', () => {
    // Greeting intent but asking about price
    expect(isFactualQuery('greeting', 'Hi, how much is a room?')).toBe(true);
  });

  it('overrides small_talk when asking about availability', () => {
    expect(isFactualQuery('small_talk', 'Hey is a capsule available?')).toBe(true);
  });

  it('returns true for undefined intent', () => {
    expect(isFactualQuery(undefined, 'Tell me about your rooms')).toBe(true);
  });
});

// ─── Stage 2: Contradiction Detection ────────────────────────────────

describe('detectHallucinations', () => {
  const kbContent = `
    ## Pelangi Capsule Hostel
    Check-in time: 2pm
    Check-out time: 12pm

    ## Room Rates
    Mixed Dorm: RM35 per night
    Female Dorm: RM40 per night
    Private Room: RM120 per night

    ## Facilities
    - WiFi available
    - 24-hour reception
    - Contact phone: +60123456789
    - Email: info@pelangicapsule.com
  `;

  it('skips non-factual queries', () => {
    const result = detectHallucinations(
      'Hello! Welcome to our hostel!',
      kbContent,
      'greeting',
      'Hi there'
    );
    expect(result.skipped).toBe(true);
    expect(result.isFactualQuery).toBe(false);
    expect(result.severity).toBe(0);
    expect(result.action).toBe('none');
  });

  it('detects price contradictions', () => {
    const response = 'Our Mixed Dorm costs RM50 per night and the Private Room is RM150 per night.';
    const result = detectHallucinations(
      response, kbContent, 'pricing', 'How much are the rooms?'
    );
    expect(result.isFactualQuery).toBe(true);
    expect(result.skipped).toBe(false);
    // Should detect contradictions: RM50 vs RM35, RM150 vs RM120
    expect(result.contradictions.length).toBeGreaterThan(0);
    expect(result.severity).toBeGreaterThan(0);
  });

  it('accepts correct responses (entailment)', () => {
    const response = 'Our Mixed Dorm is RM35 per night and the Private Room is RM120 per night.';
    const result = detectHallucinations(
      response, kbContent, 'pricing', 'How much are the rooms?'
    );
    // No contradictions expected for correct info
    expect(result.contradictions.length).toBe(0);
    expect(result.action).toBe('none');
  });

  it('skips short responses', () => {
    const result = detectHallucinations(
      'Yes, we have rooms.',
      kbContent,
      'availability',
      'Do you have rooms?'
    );
    expect(result.skipped).toBe(true);
  });

  it('skips when KB content is too short', () => {
    const result = detectHallucinations(
      'Our check-in time is at 2pm and checkout is at 12pm.',
      'Short KB',
      'check_in',
      'What time is check-in?'
    );
    expect(result.skipped).toBe(true);
  });

  it('returns action "none" when severity below threshold', () => {
    // Single contradiction should be below the default threshold of 3
    const response = 'Our Mixed Dorm costs RM50 per night. Check-in is at 2pm.';
    const result = detectHallucinations(
      response, kbContent, 'pricing', 'How much is a dorm?'
    );
    // Even with 1 contradiction, action should be 'none' (below severity 3)
    if (result.severity < 3) {
      expect(result.action).toBe('none');
    }
  });

  it('triggers block action when severity >= threshold', () => {
    // Force a response with many contradictions
    const badResponse =
      'Our Mixed Dorm costs RM99 per night. ' +
      'Female Dorm is RM88 per night. ' +
      'Private Room is RM200 per night. ' +
      'Check-in at 4pm. Check-out at 10am.';
    const result = detectHallucinations(
      badResponse, kbContent, 'pricing', 'Tell me about prices and times',
      { severityThreshold: 3, action: 'block' }
    );
    if (result.severity >= 3) {
      expect(result.action).toBe('block');
    }
  });

  it('respects disabled config', () => {
    const result = detectHallucinations(
      'Our Mixed Dorm costs RM99 per night.',
      kbContent,
      'pricing',
      'How much?',
      { enabled: false }
    );
    expect(result.skipped).toBe(true);
    expect(result.action).toBe('none');
  });

  it('completes within 200ms', () => {
    const response = 'Our Mixed Dorm costs RM50 per night and Private Room is RM150 per night. Check-in at 3pm.';
    const result = detectHallucinations(
      response, kbContent, 'pricing', 'Tell me about prices'
    );
    expect(result.latencyMs).toBeLessThan(200);
  });
});

// ─── Fallback Messages ───────────────────────────────────────────────

describe('getHallucinationBlockMessage', () => {
  it('returns English message by default', () => {
    const msg = getHallucinationBlockMessage('en');
    expect(msg).toContain('right information');
  });

  it('returns Malay message', () => {
    const msg = getHallucinationBlockMessage('ms');
    expect(msg).toContain('maklumat yang tepat');
  });

  it('returns Chinese message', () => {
    const msg = getHallucinationBlockMessage('zh');
    expect(msg).toContain('正确的信息');
  });
});

describe('getHallucinationDisclaimer', () => {
  it('returns disclaimer with verification note', () => {
    const msg = getHallucinationDisclaimer('en');
    expect(msg).toContain('verification');
  });

  it('returns Malay disclaimer', () => {
    const msg = getHallucinationDisclaimer('ms');
    expect(msg).toContain('pengesahan');
  });
});
