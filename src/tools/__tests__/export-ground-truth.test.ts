/**
 * US-218: Tests for export-ground-truth.ts
 *
 * Tests pure logic: outcome inference, record transformation,
 * JSONL formatting, cross-profile contamination detection,
 * and diversity metrics.
 *
 * No database required — tests pure functions only.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  inferOutcome,
  transformRows,
  validateContamination,
  formatAsJSONL,
  countDistinct,
  getConfidenceRange,
  countOutcomes,
  buildKeywordIndex,
  loadKeywordsFile,
  PROFILE_CONFIG,
  type RawMessageRow,
  type GroundTruthRecord,
  type ExportOptions,
  type KeywordsFile,
} from '../export-ground-truth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<RawMessageRow> = {}): RawMessageRow {
  return {
    content: 'I want to check in',
    intent: 'checkin_info',
    confidence: 0.85,
    phone: '601234567890',
    timestamp: new Date('2026-03-20T10:00:00Z'),
    profileId: 'pelangi',
    action: 'llm_reply',
    routedAction: 'static_reply',
    ...overrides,
  };
}

const defaultOptions: ExportOptions = {
  profile: 'pelangi',
  days: 90,
  minConfidence: 0.5,
  format: 'jsonl',
};

const emptyLanguageMap = new Map<string, string>();

// ---------------------------------------------------------------------------
// inferOutcome
// ---------------------------------------------------------------------------

describe('inferOutcome', () => {
  it('should return "escalated" for escalation actions', () => {
    expect(inferOutcome(null, 'escalation')).toBe('escalated');
    expect(inferOutcome('escalated_to_human', null)).toBe('escalated');
    expect(inferOutcome(null, 'human_handoff')).toBe('escalated');
    expect(inferOutcome(null, 'emergency')).toBe('escalated');
  });

  it('should return "clarified" for clarification actions', () => {
    expect(inferOutcome(null, 'ask_clarification')).toBe('clarified');
    expect(inferOutcome(null, 'fallback')).toBe('clarified');
    expect(inferOutcome(null, 'unknown')).toBe('clarified');
    expect(inferOutcome('clarify_request', null)).toBe('clarified');
  });

  it('should return "resolved" for resolution actions', () => {
    expect(inferOutcome(null, 'static_reply')).toBe('resolved');
    expect(inferOutcome(null, 'llm_reply')).toBe('resolved');
    expect(inferOutcome(null, 'workflow')).toBe('resolved');
    expect(inferOutcome(null, 'tool_use')).toBe('resolved');
    expect(inferOutcome(null, 'knowledge_base')).toBe('resolved');
  });

  it('should return "resolved" for empty/null actions', () => {
    expect(inferOutcome(null, null)).toBe('resolved');
    expect(inferOutcome(null, '')).toBe('resolved');
  });

  it('should prefer routedAction over action', () => {
    // routedAction = escalation should win even if action = llm_reply
    expect(inferOutcome('llm_reply', 'escalation')).toBe('escalated');
  });
});

// ---------------------------------------------------------------------------
// transformRows
// ---------------------------------------------------------------------------

describe('transformRows', () => {
  it('should transform valid rows into GroundTruthRecord objects', () => {
    const rows = [makeRow()];
    const { records } = transformRows(rows, emptyLanguageMap, defaultOptions);

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      message_text: 'I want to check in',
      inferred_intent: 'checkin_info',
      confidence_score: 0.85,
      actual_outcome: 'resolved',
      conversation_id: '601234567890',
      timestamp: '2026-03-20T10:00:00.000Z',
      language: 'en',
      profile: 'pelangi',
    });
  });

  it('should have exactly 8 fields per record', () => {
    const rows = [makeRow()];
    const { records } = transformRows(rows, emptyLanguageMap, defaultOptions);

    expect(Object.keys(records[0])).toHaveLength(8);
    expect(records[0]).toHaveProperty('message_text');
    expect(records[0]).toHaveProperty('inferred_intent');
    expect(records[0]).toHaveProperty('confidence_score');
    expect(records[0]).toHaveProperty('actual_outcome');
    expect(records[0]).toHaveProperty('conversation_id');
    expect(records[0]).toHaveProperty('timestamp');
    expect(records[0]).toHaveProperty('language');
    expect(records[0]).toHaveProperty('profile');
  });

  it('should skip rows without intent', () => {
    const rows = [makeRow({ intent: null })];
    const { records } = transformRows(rows, emptyLanguageMap, defaultOptions);
    expect(records).toHaveLength(0);
  });

  it('should skip rows without confidence', () => {
    const rows = [makeRow({ confidence: null })];
    const { records } = transformRows(rows, emptyLanguageMap, defaultOptions);
    expect(records).toHaveLength(0);
  });

  it('should skip rows with empty content', () => {
    const rows = [makeRow({ content: '' }), makeRow({ content: '   ' })];
    const { records } = transformRows(rows, emptyLanguageMap, defaultOptions);
    expect(records).toHaveLength(0);
  });

  it('should filter by minimum confidence', () => {
    const rows = [
      makeRow({ confidence: 0.3 }),
      makeRow({ confidence: 0.5 }),
      makeRow({ confidence: 0.9 }),
    ];
    const { records, filteredByConfidence } = transformRows(rows, emptyLanguageMap, defaultOptions);

    expect(records).toHaveLength(2);
    expect(filteredByConfidence).toBe(1);
    expect(records.every((r) => r.confidence_score >= 0.5)).toBe(true);
  });

  it('should enforce strict profile isolation (WHERE profile_name = profile)', () => {
    const rows = [
      makeRow({ profileId: 'pelangi' }),
      makeRow({ profileId: 'makan' }),
      makeRow({ profileId: 'southern' }),
    ];
    const { records } = transformRows(rows, emptyLanguageMap, defaultOptions);

    expect(records).toHaveLength(1);
    expect(records[0].profile).toBe('pelangi');
  });

  it('should use language from conversation state map', () => {
    const langMap = new Map<string, string>([['601234567890', 'ms']]);
    const rows = [makeRow()];
    const { records } = transformRows(rows, langMap, defaultOptions);

    expect(records[0].language).toBe('ms');
  });

  it('should default to "en" when language not in map', () => {
    const rows = [makeRow({ phone: '601111111111' })];
    const { records } = transformRows(rows, emptyLanguageMap, defaultOptions);

    expect(records[0].language).toBe('en');
  });

  it('should handle string timestamps', () => {
    const rows = [makeRow({ timestamp: '2026-03-20T10:00:00.000Z' })];
    const { records } = transformRows(rows, emptyLanguageMap, defaultOptions);
    expect(records[0].timestamp).toBe('2026-03-20T10:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// formatAsJSONL
// ---------------------------------------------------------------------------

describe('formatAsJSONL', () => {
  it('should format records as one JSON object per line', () => {
    const records: GroundTruthRecord[] = [
      {
        message_text: 'Hello',
        inferred_intent: 'greeting',
        confidence_score: 0.95,
        actual_outcome: 'resolved',
        conversation_id: '601234567890',
        timestamp: '2026-03-20T10:00:00Z',
        language: 'en',
        profile: 'pelangi',
      },
      {
        message_text: 'I need help',
        inferred_intent: 'help_request',
        confidence_score: 0.72,
        actual_outcome: 'escalated',
        conversation_id: '601234567891',
        timestamp: '2026-03-20T11:00:00Z',
        language: 'ms',
        profile: 'pelangi',
      },
    ];

    const jsonl = formatAsJSONL(records);
    const lines = jsonl.split('\n');

    expect(lines).toHaveLength(2);

    // Each line should be valid JSON
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(Object.keys(parsed)).toHaveLength(8);
      expect(parsed).toHaveProperty('message_text');
      expect(parsed).toHaveProperty('inferred_intent');
      expect(parsed).toHaveProperty('confidence_score');
      expect(parsed).toHaveProperty('actual_outcome');
      expect(parsed).toHaveProperty('conversation_id');
      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('language');
      expect(parsed).toHaveProperty('profile');
    }
  });

  it('should return empty string for empty records', () => {
    expect(formatAsJSONL([])).toBe('');
  });

  it('should preserve special characters in message text', () => {
    const records: GroundTruthRecord[] = [{
      message_text: 'Check "room" & \ttab\nnewline',
      inferred_intent: 'greeting',
      confidence_score: 0.9,
      actual_outcome: 'resolved',
      conversation_id: '60123',
      timestamp: '2026-03-20T10:00:00Z',
      language: 'en',
      profile: 'pelangi',
    }];

    const jsonl = formatAsJSONL(records);
    const parsed = JSON.parse(jsonl);
    expect(parsed.message_text).toBe('Check "room" & \ttab\nnewline');
  });
});

// ---------------------------------------------------------------------------
// buildKeywordIndex
// ---------------------------------------------------------------------------

describe('buildKeywordIndex', () => {
  it('should build a lowercase keyword-to-intent map', () => {
    const kf: KeywordsFile = {
      intents: [
        { intent: 'greeting', keywords: { en: ['Hello', 'Hi'], ms: ['Hai'] } },
        { intent: 'booking', keywords: { en: ['book', 'reserve'] } },
      ],
    };

    const index = buildKeywordIndex(kf);

    expect(index.get('hello')).toBe('greeting');
    expect(index.get('hi')).toBe('greeting');
    expect(index.get('hai')).toBe('greeting');
    expect(index.get('book')).toBe('booking');
    expect(index.get('reserve')).toBe('booking');
  });

  it('should handle empty keywords file', () => {
    const kf: KeywordsFile = { intents: [] };
    const index = buildKeywordIndex(kf);
    expect(index.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// validateContamination
// ---------------------------------------------------------------------------

describe('validateContamination', () => {
  it('should load intent-keywords.json from all profiles', () => {
    // Verify that intent-keywords.json exists for all profiles
    for (const [name, config] of Object.entries(PROFILE_CONFIG)) {
      const filePath = path.join(rootDir, config.dataDir, 'intent-keywords.json');
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  it('should detect zero contamination for clean records', () => {
    // Use a greeting message that should be shared across profiles
    // (common keywords like "hi" exist in all profiles and should NOT be flagged)
    const records: GroundTruthRecord[] = [{
      message_text: 'hi',
      inferred_intent: 'greeting',
      confidence_score: 0.95,
      actual_outcome: 'resolved',
      conversation_id: '601234567890',
      timestamp: '2026-03-20T10:00:00Z',
      language: 'en',
      profile: 'pelangi',
    }];

    const violations = validateContamination(records, 'pelangi', rootDir);
    expect(violations).toHaveLength(0);
  });

  it('should not flag keywords that exist in the export profile', () => {
    // "hello" exists in pelangi's own keywords, so it should not be flagged
    // even if it also exists in other profiles
    const records: GroundTruthRecord[] = [{
      message_text: 'hello good morning',
      inferred_intent: 'greeting',
      confidence_score: 0.9,
      actual_outcome: 'resolved',
      conversation_id: '60123',
      timestamp: '2026-03-20T10:00:00Z',
      language: 'en',
      profile: 'pelangi',
    }];

    const violations = validateContamination(records, 'pelangi', rootDir);
    // Should not flag common greetings
    const greetingViolation = violations.find((v) => v.keyword === 'hello');
    expect(greetingViolation).toBeUndefined();
  });

  it('should return contamination violations with correct structure', () => {
    // Fabricate a record with a keyword unique to another profile
    // Load makan keywords to find one that's NOT in pelangi
    const makanKf = loadKeywordsFile(rootDir, PROFILE_CONFIG.makan.dataDir);
    const pelangiKf = loadKeywordsFile(rootDir, PROFILE_CONFIG.pelangi.dataDir);

    if (!makanKf || !pelangiKf) {
      // Skip test if files not available
      return;
    }

    const pelangiIndex = buildKeywordIndex(pelangiKf);
    const makanIndex = buildKeywordIndex(makanKf);

    // Find a makan-only keyword (either single-word or multi-word phrase)
    let makanOnlyKeyword: string | null = null;
    for (const [kw, intent] of makanIndex) {
      if (!pelangiIndex.has(kw) && kw.length > 3) {
        makanOnlyKeyword = kw;
        break;
      }
    }

    if (!makanOnlyKeyword) {
      // All makan keywords also exist in pelangi — skip
      return;
    }

    // Use the full keyword as the message text
    // This works for both single-word and multi-word phrase keywords
    const records: GroundTruthRecord[] = [{
      message_text: makanOnlyKeyword,
      inferred_intent: 'test_intent',
      confidence_score: 0.8,
      actual_outcome: 'resolved',
      conversation_id: '60123',
      timestamp: '2026-03-20T10:00:00Z',
      language: 'en',
      profile: 'pelangi',
    }];

    const violations = validateContamination(records, 'pelangi', rootDir);
    expect(violations.length).toBeGreaterThanOrEqual(1);

    const v = violations[0];
    expect(v).toHaveProperty('keyword');
    expect(v).toHaveProperty('foreign_profile');
    expect(v).toHaveProperty('foreign_intent');
    expect(v).toHaveProperty('record_intent');
    expect(v.foreign_profile).toBe('makan');
  });
});

// ---------------------------------------------------------------------------
// Diversity metrics
// ---------------------------------------------------------------------------

describe('countDistinct', () => {
  it('should count distinct values for a given field', () => {
    const records: GroundTruthRecord[] = [
      { message_text: 'a', inferred_intent: 'greeting', confidence_score: 0.9, actual_outcome: 'resolved', conversation_id: 'c1', timestamp: 't1', language: 'en', profile: 'pelangi' },
      { message_text: 'b', inferred_intent: 'greeting', confidence_score: 0.8, actual_outcome: 'escalated', conversation_id: 'c2', timestamp: 't2', language: 'ms', profile: 'pelangi' },
      { message_text: 'c', inferred_intent: 'booking', confidence_score: 0.7, actual_outcome: 'resolved', conversation_id: 'c1', timestamp: 't3', language: 'en', profile: 'pelangi' },
    ];

    expect(countDistinct(records, 'inferred_intent')).toBe(2);
    expect(countDistinct(records, 'conversation_id')).toBe(2);
    expect(countDistinct(records, 'language')).toBe(2);
    expect(countDistinct(records, 'actual_outcome')).toBe(2);
  });
});

describe('getConfidenceRange', () => {
  it('should return min and max confidence scores', () => {
    const records: GroundTruthRecord[] = [
      { message_text: 'a', inferred_intent: 'g', confidence_score: 0.45, actual_outcome: 'r', conversation_id: 'c', timestamp: 't', language: 'en', profile: 'p' },
      { message_text: 'b', inferred_intent: 'g', confidence_score: 0.99, actual_outcome: 'r', conversation_id: 'c', timestamp: 't', language: 'en', profile: 'p' },
      { message_text: 'c', inferred_intent: 'g', confidence_score: 0.72, actual_outcome: 'r', conversation_id: 'c', timestamp: 't', language: 'en', profile: 'p' },
    ];

    const range = getConfidenceRange(records);
    expect(range.min).toBe(0.45);
    expect(range.max).toBe(0.99);
  });

  it('should return 0, 0 for empty records', () => {
    const range = getConfidenceRange([]);
    expect(range.min).toBe(0);
    expect(range.max).toBe(0);
  });
});

describe('countOutcomes', () => {
  it('should count outcome distribution across records', () => {
    const records: GroundTruthRecord[] = [
      { message_text: 'a', inferred_intent: 'g', confidence_score: 0.9, actual_outcome: 'resolved', conversation_id: 'c', timestamp: 't', language: 'en', profile: 'p' },
      { message_text: 'b', inferred_intent: 'g', confidence_score: 0.8, actual_outcome: 'resolved', conversation_id: 'c', timestamp: 't', language: 'en', profile: 'p' },
      { message_text: 'c', inferred_intent: 'g', confidence_score: 0.7, actual_outcome: 'escalated', conversation_id: 'c', timestamp: 't', language: 'en', profile: 'p' },
      { message_text: 'd', inferred_intent: 'g', confidence_score: 0.6, actual_outcome: 'clarified', conversation_id: 'c', timestamp: 't', language: 'en', profile: 'p' },
    ];

    const outcomes = countOutcomes(records);
    expect(outcomes).toEqual({
      resolved: 2,
      escalated: 1,
      clarified: 1,
    });
  });

  it('should have all 3+ outcome types when data is diverse', () => {
    const records: GroundTruthRecord[] = [
      { message_text: 'a', inferred_intent: 'g', confidence_score: 0.9, actual_outcome: 'resolved', conversation_id: 'c', timestamp: 't', language: 'en', profile: 'p' },
      { message_text: 'b', inferred_intent: 'g', confidence_score: 0.8, actual_outcome: 'escalated', conversation_id: 'c', timestamp: 't', language: 'en', profile: 'p' },
      { message_text: 'c', inferred_intent: 'g', confidence_score: 0.7, actual_outcome: 'clarified', conversation_id: 'c', timestamp: 't', language: 'en', profile: 'p' },
    ];

    const outcomes = countOutcomes(records);
    expect(Object.keys(outcomes).length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Integration: Full pipeline with mock data
// ---------------------------------------------------------------------------

describe('Integration: Full export pipeline', () => {
  it('should produce a valid JSONL export with 8 fields, diverse intents, confidence range, and 3+ outcomes', () => {
    // Simulate a realistic dataset with diverse intents and outcomes
    const rows: RawMessageRow[] = [
      makeRow({ content: 'What time is check in?', intent: 'checkin_info', confidence: 0.92, routedAction: 'static_reply' }),
      makeRow({ content: 'How much is a capsule?', intent: 'pricing', confidence: 0.88, routedAction: 'llm_reply' }),
      makeRow({ content: 'I need help now', intent: 'emergency', confidence: 0.99, routedAction: 'emergency' }),
      makeRow({ content: 'Is breakfast included?', intent: 'facility_info', confidence: 0.75, routedAction: 'static_reply' }),
      makeRow({ content: 'Hmm I am not sure', intent: 'unknown_request', confidence: 0.42, routedAction: 'fallback' }),
      makeRow({ content: 'Book a room', intent: 'booking', confidence: 0.95, routedAction: 'workflow' }),
      makeRow({ content: 'Thanks a lot', intent: 'thanks', confidence: 0.97, routedAction: 'static_reply' }),
      makeRow({ content: 'Can you connect me to staff?', intent: 'human_request', confidence: 0.91, routedAction: 'human_handoff' }),
      makeRow({ content: 'Where is the shower?', intent: 'facility_orientation', confidence: 0.80, routedAction: 'llm_reply' }),
      makeRow({ content: 'What did you mean?', intent: 'clarification', confidence: 0.65, routedAction: 'ask_clarification' }),
    ];

    const langMap = new Map([['601234567890', 'en']]);
    const { records, filteredByConfidence } = transformRows(rows, langMap, defaultOptions);

    // All should pass except the one with confidence 0.42 (below 0.5)
    expect(records.length).toBe(9);
    expect(filteredByConfidence).toBe(1);

    // Each record has 8 fields
    for (const r of records) {
      expect(Object.keys(r)).toHaveLength(8);
    }

    // Diverse intents
    const distinctIntents = countDistinct(records, 'inferred_intent');
    expect(distinctIntents).toBeGreaterThanOrEqual(5);

    // Confidence range spans
    const range = getConfidenceRange(records);
    expect(range.min).toBeLessThanOrEqual(0.75);
    expect(range.max).toBeGreaterThanOrEqual(0.95);

    // 3+ outcome types
    const outcomes = countOutcomes(records);
    expect(Object.keys(outcomes).length).toBeGreaterThanOrEqual(3);
    expect(outcomes).toHaveProperty('resolved');
    expect(outcomes).toHaveProperty('escalated');
    expect(outcomes).toHaveProperty('clarified');

    // JSONL output
    const jsonl = formatAsJSONL(records);
    const lines = jsonl.split('\n');
    expect(lines).toHaveLength(9);

    // Verify each line is valid JSON with 8 fields
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(Object.keys(parsed)).toHaveLength(8);
    }
  });

  it('should enforce strict profile isolation across entire pipeline', () => {
    const rows: RawMessageRow[] = [
      makeRow({ profileId: 'pelangi', content: 'Hello from pelangi' }),
      makeRow({ profileId: 'makan', content: 'Hello from makan' }),
      makeRow({ profileId: 'southern', content: 'Hello from southern' }),
      makeRow({ profileId: 'pelangi', content: 'Another pelangi message' }),
    ];

    const { records } = transformRows(rows, emptyLanguageMap, defaultOptions);

    // Should only contain pelangi records
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.profile === 'pelangi')).toBe(true);

    // Zero cross-profile records
    expect(records.filter((r) => r.profile !== 'pelangi')).toHaveLength(0);
  });
});
