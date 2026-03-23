/**
 * US-316: Fallback Response Coverage Gap Analysis — Unit Tests
 *
 * Tests pure logic in fallback-coverage-logic.ts — no file system access
 * required for core tests. Integration tests verify real file loading.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractIntentCategories,
  buildKnowledgeMap,
  findMissingLanguages,
  generateTemplateSuggestion,
  runFallbackCoverageAnalysis,
  loadIntentsFile,
  loadKnowledgeFile,
  EXPECTED_LANGUAGES,
  type IntentsFile,
  type KnowledgeFile,
  type KnowledgeEntry,
  type FallbackCoverageReport,
  type CoverageGap,
} from './fallback-coverage-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..', '..');

// ── Test fixture helpers ─────────────────────────────────────────────

function makeIntentsFile(
  categories: Array<{
    phase: string;
    intents: Array<{
      category: string;
      min_confidence?: number;
      enabled?: boolean;
    }>;
  }>,
): IntentsFile {
  return {
    schema_version: '1.0',
    categories: categories.map(c => ({
      phase: c.phase,
      description: `${c.phase} phase`,
      intents: c.intents.map(i => ({
        category: i.category,
        professional_term: i.category.replace(/_/g, ' '),
        patterns: [],
        flags: 'i',
        enabled: i.enabled ?? true,
        min_confidence: i.min_confidence ?? 0.8,
      })),
    })),
  };
}

function makeKnowledgeFile(
  entries: Array<{
    intent: string;
    profile_id: string;
    response?: Record<string, string>;
  }>,
): KnowledgeFile {
  return {
    schema_version: '1.0',
    static: entries.map((e, idx) => ({
      intent: e.intent,
      response: e.response ?? { en: 'English response', ms: 'Malay response', zh: 'Chinese response' },
      id: `${e.profile_id}_${e.intent}_${idx}`,
      profile_id: e.profile_id,
    })),
  };
}

// ── extractIntentCategories ──────────────────────────────────────────

describe('extractIntentCategories', () => {
  it('extracts all intent categories with phase and metadata', () => {
    const intents = makeIntentsFile([
      {
        phase: 'PRE_ARRIVAL',
        intents: [
          { category: 'pricing', min_confidence: 0.85 },
          { category: 'booking', min_confidence: 0.67 },
        ],
      },
      {
        phase: 'DURING_STAY',
        intents: [{ category: 'noise_complaint', min_confidence: 0.67 }],
      },
    ]);

    const cats = extractIntentCategories(intents);

    expect(cats).toHaveLength(3);
    expect(cats[0]).toEqual({
      category: 'pricing',
      phase: 'PRE_ARRIVAL',
      minConfidence: 0.85,
      enabled: true,
    });
    expect(cats[2].phase).toBe('DURING_STAY');
  });

  it('returns empty array for empty intents file', () => {
    const intents = makeIntentsFile([]);
    expect(extractIntentCategories(intents)).toHaveLength(0);
  });
});

// ── buildKnowledgeMap ────────────────────────────────────────────────

describe('buildKnowledgeMap', () => {
  it('builds map of intent to knowledge entries', () => {
    const knowledge = makeKnowledgeFile([
      { intent: 'pricing', profile_id: 'pelangi' },
      { intent: 'greeting', profile_id: 'pelangi' },
    ]);

    const map = buildKnowledgeMap(knowledge);

    expect(map.has('pricing')).toBe(true);
    expect(map.has('greeting')).toBe(true);
    expect(map.get('pricing')!).toHaveLength(1);
  });

  it('filters by profile_id when specified', () => {
    const knowledge = makeKnowledgeFile([
      { intent: 'pricing', profile_id: 'pelangi' },
      { intent: 'pricing', profile_id: 'makan' },
    ]);

    const map = buildKnowledgeMap(knowledge, 'pelangi');

    expect(map.get('pricing')!).toHaveLength(1);
    expect(map.get('pricing')![0].profile_id).toBe('pelangi');
  });

  it('groups multiple entries for same intent', () => {
    const knowledge = makeKnowledgeFile([
      { intent: 'pricing', profile_id: 'pelangi' },
      { intent: 'pricing', profile_id: 'pelangi' },
    ]);

    const map = buildKnowledgeMap(knowledge, 'pelangi');

    expect(map.get('pricing')!).toHaveLength(2);
  });
});

// ── findMissingLanguages ─────────────────────────────────────────────

describe('findMissingLanguages', () => {
  it('returns empty array when all languages present', () => {
    const entry: KnowledgeEntry = {
      intent: 'pricing',
      response: { en: 'Price info', ms: 'Info harga', zh: '价格信息' },
      id: 'test_0',
      profile_id: 'pelangi',
    };

    expect(findMissingLanguages(entry)).toHaveLength(0);
  });

  it('detects missing languages', () => {
    const entry: KnowledgeEntry = {
      intent: 'pricing',
      response: { en: 'Price info' },
      id: 'test_0',
      profile_id: 'pelangi',
    };

    const missing = findMissingLanguages(entry);

    expect(missing).toContain('ms');
    expect(missing).toContain('zh');
    expect(missing).not.toContain('en');
  });

  it('treats empty string as missing', () => {
    const entry: KnowledgeEntry = {
      intent: 'pricing',
      response: { en: 'Price info', ms: '', zh: '   ' },
      id: 'test_0',
      profile_id: 'pelangi',
    };

    const missing = findMissingLanguages(entry);

    expect(missing).toContain('ms');
    expect(missing).toContain('zh');
  });
});

// ── generateTemplateSuggestion ───────────────────────────────────────

describe('generateTemplateSuggestion', () => {
  it('generates no_template suggestion with phase-specific hint', () => {
    const suggestion = generateTemplateSuggestion('booking', 'PRE_ARRIVAL', 'no_template');

    expect(suggestion).toContain('booking');
    expect(suggestion).toContain('booking-relevant');
  });

  it('generates incomplete_coverage suggestion', () => {
    const suggestion = generateTemplateSuggestion('pricing', 'PRE_ARRIVAL', 'incomplete_coverage');

    expect(suggestion).toContain('missing language translations');
    expect(suggestion).toContain('pricing');
  });

  it('generates low_confidence_gap suggestion', () => {
    const suggestion = generateTemplateSuggestion('emergency', 'GENERAL_SUPPORT', 'low_confidence_gap');

    expect(suggestion).toContain('low min_confidence');
    expect(suggestion).toContain('emergency');
  });

  it('handles unknown phase gracefully', () => {
    const suggestion = generateTemplateSuggestion('custom', 'UNKNOWN_PHASE', 'no_template');

    expect(suggestion).toContain('custom');
    expect(suggestion).toContain('helpful response');
  });
});

// ── runFallbackCoverageAnalysis ──────────────────────────────────────

describe('runFallbackCoverageAnalysis', () => {
  it('reports missing intents as no_template gaps', () => {
    const intents = makeIntentsFile([
      {
        phase: 'PRE_ARRIVAL',
        intents: [
          { category: 'pricing' },
          { category: 'booking' },
        ],
      },
    ]);
    const knowledge = makeKnowledgeFile([
      { intent: 'pricing', profile_id: 'pelangi' },
    ]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    expect(report.totalGaps).toBe(1);
    expect(report.gaps[0].intent).toBe('booking');
    expect(report.gaps[0].gapType).toBe('no_template');
    expect(report.gaps[0].affectedProfiles).toContain('pelangi');
  });

  it('reports incomplete language coverage', () => {
    const intents = makeIntentsFile([
      {
        phase: 'PRE_ARRIVAL',
        intents: [{ category: 'pricing' }],
      },
    ]);
    const knowledge = makeKnowledgeFile([
      {
        intent: 'pricing',
        profile_id: 'pelangi',
        response: { en: 'Price info' }, // missing ms, zh
      },
    ]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    expect(report.totalGaps).toBe(1);
    expect(report.gaps[0].gapType).toBe('incomplete_coverage');
    expect(report.gaps[0].suggestion).toContain('ms');
    expect(report.gaps[0].suggestion).toContain('zh');
  });

  it('classifies low-confidence intents without templates as low_confidence_gap', () => {
    const intents = makeIntentsFile([
      {
        phase: 'GENERAL_SUPPORT',
        intents: [
          { category: 'emergency', min_confidence: 0.0 },
          { category: 'unknown', min_confidence: 0 },
        ],
      },
    ]);
    const knowledge = makeKnowledgeFile([]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    expect(report.totalGaps).toBe(2);
    for (const gap of report.gaps) {
      expect(gap.gapType).toBe('low_confidence_gap');
    }
  });

  it('skips disabled intents', () => {
    const intents = makeIntentsFile([
      {
        phase: 'PRE_ARRIVAL',
        intents: [
          { category: 'pricing', enabled: true },
          { category: 'deprecated', enabled: false },
        ],
      },
    ]);
    const knowledge = makeKnowledgeFile([
      { intent: 'pricing', profile_id: 'pelangi' },
    ]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    expect(report.totalIntents).toBe(1); // only enabled
    expect(report.gaps.find(g => g.intent === 'deprecated')).toBeUndefined();
  });

  it('returns zero gaps when all intents have complete coverage', () => {
    const intents = makeIntentsFile([
      {
        phase: 'PRE_ARRIVAL',
        intents: [{ category: 'pricing' }],
      },
    ]);
    const knowledge = makeKnowledgeFile([
      { intent: 'pricing', profile_id: 'pelangi' },
    ]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    expect(report.totalGaps).toBe(0);
    expect(report.gaps).toHaveLength(0);
  });

  it('returns report with correct structure', () => {
    const intents = makeIntentsFile([
      {
        phase: 'PRE_ARRIVAL',
        intents: [{ category: 'pricing' }],
      },
    ]);
    const knowledge = makeKnowledgeFile([]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('profile', 'pelangi');
    expect(report).toHaveProperty('totalIntents');
    expect(report).toHaveProperty('totalKnowledgeEntries');
    expect(report).toHaveProperty('totalGaps');
    expect(report).toHaveProperty('gaps');
    expect(Array.isArray(report.gaps)).toBe(true);
  });

  it('each gap has {intent, gapType, suggestion, affectedProfiles}', () => {
    const intents = makeIntentsFile([
      {
        phase: 'PRE_ARRIVAL',
        intents: [{ category: 'booking' }],
      },
    ]);
    const knowledge = makeKnowledgeFile([]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    expect(report.gaps).toHaveLength(1);
    const gap = report.gaps[0];
    expect(gap).toHaveProperty('intent', 'booking');
    expect(gap).toHaveProperty('gapType');
    expect(['no_template', 'incomplete_coverage', 'low_confidence_gap']).toContain(gap.gapType);
    expect(gap).toHaveProperty('suggestion');
    expect(typeof gap.suggestion).toBe('string');
    expect(gap).toHaveProperty('affectedProfiles');
    expect(Array.isArray(gap.affectedProfiles)).toBe(true);
  });

  it('filters knowledge by profile_id correctly', () => {
    const intents = makeIntentsFile([
      {
        phase: 'PRE_ARRIVAL',
        intents: [{ category: 'pricing' }],
      },
    ]);
    const knowledge = makeKnowledgeFile([
      { intent: 'pricing', profile_id: 'makan' }, // wrong profile
    ]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    // pricing exists but for makan, not pelangi — should be a gap
    expect(report.totalGaps).toBe(1);
    expect(report.gaps[0].intent).toBe('pricing');
    expect(report.gaps[0].gapType).toBe('no_template');
  });
});

// ── AC1: CLI scans intents.json against knowledge.json ───────────────

describe('AC1: CLI scans intents.json against knowledge.json', () => {
  it('scans intents against knowledge and reports missing entries', () => {
    const intents = makeIntentsFile([
      {
        phase: 'PRE_ARRIVAL',
        intents: [
          { category: 'pricing' },
          { category: 'booking' },
          { category: 'availability' },
        ],
      },
    ]);
    const knowledge = makeKnowledgeFile([
      { intent: 'pricing', profile_id: 'pelangi' },
    ]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    expect(report.totalIntents).toBe(3);
    expect(report.totalGaps).toBe(2); // booking + availability missing
    const gapIntents = report.gaps.map(g => g.intent);
    expect(gapIntents).toContain('booking');
    expect(gapIntents).toContain('availability');
    expect(gapIntents).not.toContain('pricing');
  });
});

// ── AC2: Reports gaps with type and suggestions ──────────────────────

describe('AC2: Reports missing intents with gap type and suggestions', () => {
  it('classifies gaps as no_template', () => {
    const intents = makeIntentsFile([
      {
        phase: 'DURING_STAY',
        intents: [{ category: 'noise_complaint', min_confidence: 0.67 }],
      },
    ]);
    const knowledge = makeKnowledgeFile([]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    expect(report.gaps[0].gapType).toBe('no_template');
    expect(report.gaps[0].suggestion).toBeTruthy();
  });

  it('classifies gaps as incomplete_coverage', () => {
    const intents = makeIntentsFile([
      {
        phase: 'PRE_ARRIVAL',
        intents: [{ category: 'pricing' }],
      },
    ]);
    const knowledge = makeKnowledgeFile([
      {
        intent: 'pricing',
        profile_id: 'pelangi',
        response: { en: 'Price info', ms: 'Info harga' }, // missing zh
      },
    ]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    expect(report.gaps[0].gapType).toBe('incomplete_coverage');
  });

  it('classifies gaps as low_confidence_gap', () => {
    const intents = makeIntentsFile([
      {
        phase: 'DURING_STAY',
        intents: [{ category: 'card_locked', min_confidence: 0.3 }],
      },
    ]);
    const knowledge = makeKnowledgeFile([]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    expect(report.gaps[0].gapType).toBe('low_confidence_gap');
  });

  it('provides template structure in suggestions', () => {
    const intents = makeIntentsFile([
      {
        phase: 'PRE_ARRIVAL',
        intents: [{ category: 'booking' }],
      },
    ]);
    const knowledge = makeKnowledgeFile([]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    const suggestion = report.gaps[0].suggestion;
    expect(suggestion).toContain('booking');
    expect(suggestion).toContain('en');
    expect(suggestion).toContain('ms');
    expect(suggestion).toContain('zh');
  });
});

// ── AC3: Generates report file with correct format ───────────────────

describe('AC3: Generates report with arrays of {intent, gapType, suggestion, affectedProfiles}', () => {
  it('report gaps array contains objects with required fields', () => {
    const intents = makeIntentsFile([
      {
        phase: 'PRE_ARRIVAL',
        intents: [
          { category: 'booking', min_confidence: 0.67 },
          { category: 'availability', min_confidence: 0.7 },
        ],
      },
      {
        phase: 'DURING_STAY',
        intents: [
          { category: 'theft_report', min_confidence: 0.3 },
        ],
      },
    ]);
    const knowledge = makeKnowledgeFile([]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    expect(report.gaps.length).toBeGreaterThanOrEqual(3);
    for (const gap of report.gaps) {
      expect(gap).toHaveProperty('intent');
      expect(typeof gap.intent).toBe('string');
      expect(gap).toHaveProperty('gapType');
      expect(['no_template', 'incomplete_coverage', 'low_confidence_gap']).toContain(gap.gapType);
      expect(gap).toHaveProperty('suggestion');
      expect(typeof gap.suggestion).toBe('string');
      expect(gap).toHaveProperty('affectedProfiles');
      expect(Array.isArray(gap.affectedProfiles)).toBe(true);
      expect(gap.affectedProfiles.length).toBeGreaterThan(0);
    }
  });

  it('report contains profile identifier', () => {
    const intents = makeIntentsFile([
      {
        phase: 'PRE_ARRIVAL',
        intents: [{ category: 'pricing' }],
      },
    ]);
    const knowledge = makeKnowledgeFile([]);

    const report = runFallbackCoverageAnalysis('southern', intents, knowledge);

    expect(report.profile).toBe('southern');
    expect(report.gaps[0].affectedProfiles).toContain('southern');
  });

  it('report contains timestamp', () => {
    const intents = makeIntentsFile([
      {
        phase: 'PRE_ARRIVAL',
        intents: [{ category: 'pricing' }],
      },
    ]);
    const knowledge = makeKnowledgeFile([]);

    const report = runFallbackCoverageAnalysis('pelangi', intents, knowledge);

    expect(report.timestamp).toBeDefined();
    // Should be ISO format
    expect(() => new Date(report.timestamp)).not.toThrow();
  });
});

// ── Integration: loads real profile files ─────────────────────────────

describe('Integration: real profile files', () => {
  const profiles = [
    { name: 'pelangi', dir: 'src/assistant/data' },
    { name: 'southern', dir: 'src/assistant/data-southern' },
    { name: 'makan', dir: 'src/assistant/data-makan' },
  ];

  for (const { name, dir } of profiles) {
    const intentsPath = path.join(rootDir, dir, 'intents.json');
    const knowledgePath = path.join(rootDir, dir, 'knowledge.json');

    it(`loads real ${name} intents and knowledge files`, () => {
      const intentsData = loadIntentsFile(intentsPath);
      const knowledgeData = loadKnowledgeFile(knowledgePath);

      expect(intentsData.categories.length).toBeGreaterThan(0);
      expect(knowledgeData.static).toBeDefined();
    });

    it(`generates coverage report for ${name} profile`, () => {
      const intentsData = loadIntentsFile(intentsPath);
      const knowledgeData = loadKnowledgeFile(knowledgePath);

      const report = runFallbackCoverageAnalysis(name, intentsData, knowledgeData);

      expect(report.profile).toBe(name);
      expect(report.totalIntents).toBeGreaterThan(0);
      expect(typeof report.totalGaps).toBe('number');
      expect(Array.isArray(report.gaps)).toBe(true);

      // Validate each gap entry structure
      for (const gap of report.gaps) {
        expect(gap).toHaveProperty('intent');
        expect(gap).toHaveProperty('gapType');
        expect(gap).toHaveProperty('suggestion');
        expect(gap).toHaveProperty('affectedProfiles');
        expect(['no_template', 'incomplete_coverage', 'low_confidence_gap']).toContain(gap.gapType);
      }
    });
  }

  it('pelangi profile has expected coverage gaps for intents without knowledge entries', () => {
    const intentsData = loadIntentsFile(path.join(rootDir, 'src/assistant/data/intents.json'));
    const knowledgeData = loadKnowledgeFile(path.join(rootDir, 'src/assistant/data/knowledge.json'));

    const report = runFallbackCoverageAnalysis('pelangi', intentsData, knowledgeData);

    // We know from exploration that some intents like booking, availability,
    // noise_complaint etc. are missing from knowledge.json
    expect(report.totalGaps).toBeGreaterThan(0);
    const gapIntents = report.gaps.map(g => g.intent);
    // These intents exist in intents.json but not in knowledge.json
    expect(gapIntents).toContain('booking');
    expect(gapIntents).toContain('availability');
  });
});
