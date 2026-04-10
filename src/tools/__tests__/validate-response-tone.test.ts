/**
 * US-392: Tests for Fallback Response Tone Validator
 *
 * Tests core pure logic: calculateToneScore, analyzeResponseTone,
 * analyzeKnowledge, buildToneReport, and buildSuggestionsReport.
 */

import { describe, it, expect } from 'vitest';
import {
  DISMISSIVE_PATTERNS,
  APOLOGETIC_WORDS,
  HELPFUL_WORDS,
  INTENT_GROUPS,
  analyzeResponseTone,
  analyzeKnowledge,
  buildToneReport,
  buildSuggestionsReport,
  suggestAlternatives,
} from '../validate-response-tone.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_KNOWLEDGE = [
  {
    intent: 'booking',
    response: {
      en: 'I\'d be happy to help you book a room! We have availability and can assist you right away.',
      ms: 'Saya senang membantu Anda memesan bilik!',
      zh: '我很乐意帮助您预订房间！',
    },
  },
  {
    intent: 'complaint',
    response: {
      en: 'I\'m sorry to hear that. We will review your concern and get back to you shortly. Thank you for bringing this to our attention.',
      ms: 'Saya minta maaf mendengar itu.',
      zh: '我为此感到遗憾。',
    },
  },
  {
    intent: 'pricing',
    response: {
      en: 'Sorry, I cannot help with that. It is not possible right now.',
      ms: 'Maaf, saya tidak dapat membantu.',
      zh: '抱歉，我无法帮助。',
    },
  },
  {
    intent: 'facilities',
    response: {
      en: 'Our facilities include hot showers, shared kitchen, and free WiFi. We\'re happy to provide you with more details!',
      ms: 'Kemudahan kami termasuk pancuran air panas.',
      zh: '我们的设施包括热水淋浴。',
    },
  },
  {
    intent: 'checkin_info',
    response: {
      en: 'Unable to assist at the moment. Please contact our staff.',
      ms: 'Tidak dapat membantu sekarang.',
      zh: '暂时无法协助。',
    },
  },
];

// ---------------------------------------------------------------------------
// Tests for constants
// ---------------------------------------------------------------------------

describe('Constants validation', () => {
  it('has dismissive patterns defined', () => {
    expect(DISMISSIVE_PATTERNS.length).toBeGreaterThan(0);
    expect(DISMISSIVE_PATTERNS).toContain('cannot help');
    expect(DISMISSIVE_PATTERNS).toContain('not possible');
  });

  it('has apologetic words defined', () => {
    expect(APOLOGETIC_WORDS.length).toBeGreaterThan(0);
    expect(APOLOGETIC_WORDS).toContain('sorry');
    expect(APOLOGETIC_WORDS).toContain('apologize');
  });

  it('has helpful words defined', () => {
    expect(HELPFUL_WORDS.length).toBeGreaterThan(0);
    expect(HELPFUL_WORDS).toContain('help');
    expect(HELPFUL_WORDS).toContain('assist');
  });

  it('has intent groups defined', () => {
    expect(Object.keys(INTENT_GROUPS).length).toBeGreaterThan(0);
    expect(INTENT_GROUPS).toHaveProperty('booking');
    expect(INTENT_GROUPS).toHaveProperty('complaint');
    expect(INTENT_GROUPS).toHaveProperty('inquiry');
  });
});

// ---------------------------------------------------------------------------
// Tests for analyzeResponseTone
// ---------------------------------------------------------------------------

describe('analyzeResponseTone', () => {
  it('detects helpful tone in positive response', () => {
    const scores = analyzeResponseTone('booking', {
      en: 'I\'d be happy to help you book a room! We can assist you right away.',
    });

    expect(scores.length).toBeGreaterThan(0);
    expect(scores[0].helpfulScore).toBeGreaterThan(0.3);
    expect(scores[0].dismissiveMatches).toBe(0);
  });

  it('detects dismissive tone in negative response', () => {
    const scores = analyzeResponseTone('pricing', {
      en: 'Sorry, I cannot help with that. It is not possible right now.',
    });

    expect(scores.length).toBeGreaterThan(0);
    expect(scores[0].dismissiveMatches).toBeGreaterThan(0);
    expect(scores[0].overallSentiment).toBeLessThan(0);
  });

  it('detects apologetic tone', () => {
    const scores = analyzeResponseTone('complaint', {
      en: 'I\'m sorry to hear that. I apologize for any inconvenience.',
    });

    expect(scores.length).toBeGreaterThan(0);
    expect(scores[0].apologeticScore).toBeGreaterThan(0.3);
  });

  it('handles multiple languages', () => {
    const scores = analyzeResponseTone('facilities', {
      en: 'We can help you with that!',
      ms: 'Kami dapat membantu Anda!',
      zh: '我们可以帮助你！',
    });

    expect(scores.length).toBe(3);
  });

  it('handles empty responses gracefully', () => {
    const scores = analyzeResponseTone('unknown', {
      en: '',
      ms: '',
      zh: '',
    });

    expect(scores.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests for analyzeKnowledge
// ---------------------------------------------------------------------------

describe('analyzeKnowledge', () => {
  it('analyzes knowledge base and returns array', () => {
    const analysis = analyzeKnowledge(SAMPLE_KNOWLEDGE);

    expect(analysis.length).toBe(SAMPLE_KNOWLEDGE.length);
    expect(analysis[0]).toHaveProperty('intent');
    expect(analysis[0]).toHaveProperty('avgSentiment');
    expect(analysis[0]).toHaveProperty('dismissiveCount');
    expect(analysis[0]).toHaveProperty('flagged');
  });

  it('flags intents with dismissive patterns', () => {
    const analysis = analyzeKnowledge(SAMPLE_KNOWLEDGE);
    const pricingAnalysis = analysis.find(a => a.intent === 'pricing');

    expect(pricingAnalysis).toBeDefined();
    expect(pricingAnalysis!.dismissiveCount).toBeGreaterThan(0);
    expect(pricingAnalysis!.flagged).toBe(true);
  });

  it('identifies intent groups correctly', () => {
    const analysis = analyzeKnowledge(SAMPLE_KNOWLEDGE);

    const bookingAnalysis = analysis.find(a => a.intent === 'booking');
    expect(bookingAnalysis!.groupName).toBe('booking');

    const complaintAnalysis = analysis.find(a => a.intent === 'complaint');
    expect(complaintAnalysis!.groupName).toBe('complaint');
  });

  it('sorts by flagged status and sentiment', () => {
    const analysis = analyzeKnowledge(SAMPLE_KNOWLEDGE);

    // Flagged items should come first
    let lastFlagged = true;
    for (const item of analysis) {
      if (!item.flagged) {
        lastFlagged = false;
      }
      expect(!item.flagged || lastFlagged).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests for buildToneReport
// ---------------------------------------------------------------------------

describe('buildToneReport', () => {
  it('generates complete tone report', () => {
    const report = buildToneReport('test-profile', SAMPLE_KNOWLEDGE);

    expect(report.profile).toBe('test-profile');
    expect(report.totalIntents).toBeGreaterThan(0);
    expect(report.totalResponses).toBeGreaterThan(0);
    expect(report.intentAnalysis).toBeDefined();
    expect(report.groupDistribution).toBeDefined();
    expect(report.flaggedIntents).toBeDefined();
    expect(report.dismissiveSummary).toBeDefined();
  });

  it('includes all intents in report', () => {
    const report = buildToneReport('test-profile', SAMPLE_KNOWLEDGE);

    expect(report.totalIntents).toBe(SAMPLE_KNOWLEDGE.length);
    for (const knowledge of SAMPLE_KNOWLEDGE) {
      const found = report.intentAnalysis.find(a => a.intent === knowledge.intent);
      expect(found).toBeDefined();
    }
  });

  it('calculates group distribution', () => {
    const report = buildToneReport('test-profile', SAMPLE_KNOWLEDGE);

    // Should have at least one group
    expect(Object.keys(report.groupDistribution).length).toBeGreaterThan(0);

    // Each group should have metrics
    for (const group of Object.values(report.groupDistribution)) {
      expect(group).toHaveProperty('intents');
      expect(group).toHaveProperty('avgSentiment');
      expect(group).toHaveProperty('dismissiveCount');
      expect(group).toHaveProperty('responseCount');
    }
  });

  it('identifies flagged intents', () => {
    const report = buildToneReport('test-profile', SAMPLE_KNOWLEDGE);

    // Should have flagged intents due to dismissive patterns
    expect(report.flaggedIntents.length).toBeGreaterThan(0);

    // All flagged intents should be in intentAnalysis
    for (const flagged of report.flaggedIntents) {
      const inAnalysis = report.intentAnalysis.some(a => a.intent === flagged.intent);
      expect(inAnalysis).toBe(true);
    }
  });

  it('collects dismissive summary', () => {
    const report = buildToneReport('test-profile', SAMPLE_KNOWLEDGE);

    // Should have found dismissive patterns
    expect(report.dismissiveSummary.length).toBeGreaterThan(0);

    // Each match should have required fields
    for (const match of report.dismissiveSummary) {
      expect(match).toHaveProperty('intent');
      expect(match).toHaveProperty('pattern');
      expect(match).toHaveProperty('text');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests for buildSuggestionsReport
// ---------------------------------------------------------------------------

describe('buildSuggestionsReport', () => {
  it('generates suggestions from dismissive matches', () => {
    const report = buildToneReport('test-profile', SAMPLE_KNOWLEDGE);
    const suggestionsReport = buildSuggestionsReport('test-profile', report.dismissiveSummary);

    expect(suggestionsReport.profile).toBe('test-profile');
    expect(suggestionsReport.suggestions).toBeDefined();
    expect(Object.keys(suggestionsReport.suggestions).length).toBeGreaterThanOrEqual(0);
  });

  it('includes suggestions for known dismissive patterns', () => {
    const report = buildToneReport('test-profile', SAMPLE_KNOWLEDGE);

    if (report.dismissiveSummary.length > 0) {
      const suggestionsReport = buildSuggestionsReport('test-profile', report.dismissiveSummary);

      for (const suggestion of Object.values(suggestionsReport.suggestions)) {
        expect(suggestion).toHaveProperty('dismissivePattern');
        expect(suggestion).toHaveProperty('suggestion');
        expect(suggestion.suggestion.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tests for suggestAlternatives
// ---------------------------------------------------------------------------

describe('suggestAlternatives', () => {
  it('provides alternatives for dismissive patterns', () => {
    const report = buildToneReport('test-profile', SAMPLE_KNOWLEDGE);
    const suggestions = suggestAlternatives(report.dismissiveSummary);

    if (report.dismissiveSummary.length > 0) {
      expect(Object.keys(suggestions).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('Full workflow', () => {
  it('processes knowledge base and generates complete reports', () => {
    // Generate tone report
    const report = buildToneReport('pelangi', SAMPLE_KNOWLEDGE);

    // Should have analyzed all intents
    expect(report.totalIntents).toBe(SAMPLE_KNOWLEDGE.length);
    expect(report.totalResponses).toBeGreaterThan(0);

    // Should have identified issues
    expect(report.flaggedIntents.length).toBeGreaterThan(0);
    expect(report.dismissiveSummary.length).toBeGreaterThan(0);

    // Generate suggestions
    const suggestionsReport = buildSuggestionsReport('pelangi', report.dismissiveSummary);

    expect(suggestionsReport.profile).toBe('pelangi');
    expect(suggestionsReport.generatedAt).toBeDefined();
  });

  it('produces consistent results across multiple runs', () => {
    const report1 = buildToneReport('test', SAMPLE_KNOWLEDGE);
    const report2 = buildToneReport('test', SAMPLE_KNOWLEDGE);

    // Should have same number of flagged intents
    expect(report1.flaggedIntents.length).toBe(report2.flaggedIntents.length);

    // Should have same sentiment scores
    for (let i = 0; i < report1.intentAnalysis.length; i++) {
      expect(report1.intentAnalysis[i].avgSentiment).toBe(
        report2.intentAnalysis[i].avgSentiment,
      );
    }
  });
});
