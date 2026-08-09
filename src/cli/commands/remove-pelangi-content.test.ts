/**
 * US-337: Makan Moments Knowledge Base Pelangi Content Removal Tool — Unit Tests
 *
 * Tests pure logic in remove-pelangi-content-logic.ts — no file system access
 * required for core tests. Integration tests verify real file loading.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  isPelangiIntent,
  findHostelPatterns,
  hasCafeContent,
  getAllResponseText,
  shouldRemoveEntry,
  shouldRemoveDynamicEntry,
  countHostelReferences,
  runPelangiContentRemoval,
  loadKnowledgeFile,
  PELANGI_INTENT_PATTERNS,
  HOSTEL_CONTENT_PATTERNS,
  CAFE_CONTENT_PATTERNS,
  type KnowledgeFile,
  type KnowledgeEntry,
} from './remove-pelangi-content-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..', '..');

// ── Test fixture helpers ─────────────────────────────────────────────

function makeKnowledgeFile(
  staticEntries: KnowledgeEntry[],
  dynamic?: Record<string, string>,
): KnowledgeFile {
  return { static: staticEntries, dynamic };
}

function makeCafeEntry(intent: string, id?: string): KnowledgeEntry {
  return {
    intent,
    response: {
      en: 'Welcome to Makan Moments Cafe! Check our menu for today\'s specials.',
      ms: 'Selamat datang ke Makan Moments Cafe! Semak menu untuk spesial hari ini.',
    },
    id: id ?? `makan_${intent}_0`,
    profile_id: 'makan',
  };
}

function makeHostelEntry(intent: string, id?: string): KnowledgeEntry {
  return {
    intent,
    response: {
      en: 'Welcome to Pelangi Capsule Hostel! Check-in time is 2:00 PM.',
      ms: 'Selamat datang ke Pelangi Capsule Hostel! Masa daftar masuk ialah 2:00 PM.',
    },
    id: id ?? `pelangi_${intent}_0`,
    profile_id: 'pelangi',
  };
}

// ── isPelangiIntent ──────────────────────────────────────────────────

describe('isPelangiIntent', () => {
  it('identifies hostel-specific intents', () => {
    expect(isPelangiIntent('checkin_info')).toBe(true);
    expect(isPelangiIntent('checkout_info')).toBe(true);
    expect(isPelangiIntent('room_type_inquiry')).toBe(true);
    expect(isPelangiIntent('luggage_storage')).toBe(true);
    expect(isPelangiIntent('capsule_conflict')).toBe(true);
    expect(isPelangiIntent('facilities')).toBe(true);
    expect(isPelangiIntent('rules')).toBe(true);
  });

  it('returns false for cafe intents', () => {
    expect(isPelangiIntent('greeting')).toBe(false);
    expect(isPelangiIntent('pricing')).toBe(false);
    expect(isPelangiIntent('operating_hours')).toBe(false);
    expect(isPelangiIntent('menu_query')).toBe(false);
    expect(isPelangiIntent('vegetarian_query')).toBe(false);
    expect(isPelangiIntent('specials_query')).toBe(false);
  });
});

// ── findHostelPatterns ───────────────────────────────────────────────

describe('findHostelPatterns', () => {
  it('detects Pelangi Capsule references', () => {
    const patterns = findHostelPatterns('Welcome to Pelangi Capsule Hostel!');
    expect(patterns).toContain('pelangi capsule');
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('detects check-in/checkout references', () => {
    const checkInPatterns = findHostelPatterns('Check-in time is 2:00 PM');
    expect(checkInPatterns.length).toBeGreaterThan(0);

    const checkOutPatterns = findHostelPatterns('Checkout by 12:00 PM');
    expect(checkOutPatterns.length).toBeGreaterThan(0);
  });

  it('detects hostel-specific terms', () => {
    expect(findHostelPatterns('capsule pod with AC').length).toBeGreaterThan(0);
    expect(findHostelPatterns('dormitory layout').length).toBeGreaterThan(0);
    expect(findHostelPatterns('luggage storage available').length).toBeGreaterThan(0);
    expect(findHostelPatterns('door password is 1270#').length).toBeGreaterThan(0);
  });

  it('detects Chinese hostel terms', () => {
    expect(findHostelPatterns('办理入住手续').length).toBeGreaterThan(0);
    expect(findHostelPatterns('退房时间').length).toBeGreaterThan(0);
    expect(findHostelPatterns('胶囊旅舍').length).toBeGreaterThan(0);
  });

  it('detects Malay hostel terms', () => {
    expect(findHostelPatterns('daftar masuk sekarang').length).toBeGreaterThan(0);
    expect(findHostelPatterns('daftar keluar sebelum 12').length).toBeGreaterThan(0);
  });

  it('returns empty array for cafe-only content', () => {
    expect(findHostelPatterns('Nasi Lemak RM8 special today')).toHaveLength(0);
    expect(findHostelPatterns('Mee Goreng available for lunch')).toHaveLength(0);
    expect(findHostelPatterns('Teh Tarik RM3 only')).toHaveLength(0);
  });
});

// ── hasCafeContent ───────────────────────────────────────────────────

describe('hasCafeContent', () => {
  it('detects cafe-specific content', () => {
    expect(hasCafeContent('Welcome to Makan Moments Cafe!')).toBe(true);
    expect(hasCafeContent('Our menu includes nasi lemak')).toBe(true);
    expect(hasCafeContent('Breakfast served from 7 AM')).toBe(true);
    expect(hasCafeContent('Vegetarian options available')).toBe(true);
  });

  it('returns false for hostel-only content', () => {
    expect(hasCafeContent('Door password: 1270#')).toBe(false);
    expect(hasCafeContent('Upper deck or lower deck?')).toBe(false);
    expect(hasCafeContent('Key card deposit RM10')).toBe(false);
  });
});

// ── getAllResponseText ───────────────────────────────────────────────

describe('getAllResponseText', () => {
  it('concatenates all language responses', () => {
    const entry: KnowledgeEntry = {
      intent: 'greeting',
      response: { en: 'Hello', ms: 'Hai', zh: '你好' },
    };
    const text = getAllResponseText(entry);
    expect(text).toContain('Hello');
    expect(text).toContain('Hai');
    expect(text).toContain('你好');
  });

  it('handles single-language entries', () => {
    const entry: KnowledgeEntry = {
      intent: 'test',
      response: { en: 'Test content only' },
    };
    expect(getAllResponseText(entry)).toContain('Test content only');
  });
});

// ── shouldRemoveEntry ────────────────────────────────────────────────

describe('shouldRemoveEntry', () => {
  it('flags entries with hostel-specific intents', () => {
    const entry = makeHostelEntry('checkin_info');
    const result = shouldRemoveEntry(entry);
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('checkin_info');
  });

  it('flags entries with Pelangi profile_id', () => {
    const entry: KnowledgeEntry = {
      intent: 'greeting',
      response: { en: 'Welcome to Pelangi Capsule Hostel!' },
      id: 'pelangi_greeting_0',
      profile_id: 'pelangi',
    };
    const result = shouldRemoveEntry(entry);
    expect(result).not.toBeNull();
  });

  it('flags entries with hostel content in response', () => {
    const entry: KnowledgeEntry = {
      intent: 'generic',
      response: { en: 'The capsule hostel has WiFi and air conditioning' },
      id: 'generic_0',
      profile_id: 'makan',
    };
    const result = shouldRemoveEntry(entry);
    expect(result).not.toBeNull();
  });

  it('preserves cafe entries even with borderline wording', () => {
    const entry = makeCafeEntry('greeting');
    const result = shouldRemoveEntry(entry);
    expect(result).toBeNull();
  });

  it('preserves entries with no hostel indicators', () => {
    const entry: KnowledgeEntry = {
      intent: 'pricing',
      response: {
        en: 'Nasi Lemak RM8, Mee Goreng RM10, Teh Tarik RM3',
      },
      id: 'makan_pricing_0',
      profile_id: 'makan',
    };
    const result = shouldRemoveEntry(entry);
    expect(result).toBeNull();
  });

  it('removes entries with hostel intent even if response looks cafe-like', () => {
    const entry: KnowledgeEntry = {
      intent: 'checkin_info',
      response: {
        en: 'Menu check in: Nasi Lemak for breakfast at our cafe',
      },
      id: 'wrong_intent_0',
      profile_id: 'makan',
    };
    const result = shouldRemoveEntry(entry);
    expect(result).not.toBeNull();
  });
});

// ── shouldRemoveDynamicEntry ─────────────────────────────────────────

describe('shouldRemoveDynamicEntry', () => {
  it('flags dynamic entries with hostel content', () => {
    const result = shouldRemoveDynamicEntry('hostel_info', 'Pelangi Capsule Hostel details');
    expect(result).not.toBeNull();
  });

  it('preserves dynamic entries without hostel content', () => {
    const result = shouldRemoveDynamicEntry('allergen_warning_template', 'Allergen info for {item_name}');
    expect(result).toBeNull();
  });

  it('preserves dynamic entries with cafe content even if borderline', () => {
    const result = shouldRemoveDynamicEntry('cafe_menu', 'Makan Moments Cafe menu items');
    expect(result).toBeNull();
  });
});

// ── countHostelReferences ────────────────────────────────────────────

describe('countHostelReferences', () => {
  it('counts zero for clean data', () => {
    const data = makeKnowledgeFile([makeCafeEntry('greeting'), makeCafeEntry('pricing')]);
    expect(countHostelReferences(data)).toBe(0);
  });

  it('counts hostel references in static entries', () => {
    const data = makeKnowledgeFile([
      makeCafeEntry('greeting'),
      makeHostelEntry('checkin_info'),
      makeHostelEntry('checkout_info'),
    ]);
    expect(countHostelReferences(data)).toBe(2);
  });

  it('counts hostel references in dynamic entries', () => {
    const data = makeKnowledgeFile([], {
      hostel_info: 'Pelangi Capsule Hostel check-in at 2PM',
      cafe_menu: 'Nasi Lemak RM8',
    });
    expect(countHostelReferences(data)).toBe(1);
  });
});

// ── runPelangiContentRemoval ─────────────────────────────────────────

describe('runPelangiContentRemoval', () => {
  it('removes hostel entries and preserves cafe entries', () => {
    const data = makeKnowledgeFile([
      makeCafeEntry('greeting'),
      makeHostelEntry('checkin_info'),
      makeCafeEntry('pricing'),
      makeHostelEntry('checkout_info'),
    ]);

    const { report, cleaned } = runPelangiContentRemoval('makan', data);

    expect(report.static_entries_before).toBe(4);
    expect(report.static_entries_removed).toBe(2);
    expect(report.static_entries_after).toBe(2);
    expect(cleaned.static).toHaveLength(2);
    expect(cleaned.static[0].intent).toBe('greeting');
    expect(cleaned.static[1].intent).toBe('pricing');
  });

  it('handles data with no hostel entries', () => {
    const data = makeKnowledgeFile([
      makeCafeEntry('greeting'),
      makeCafeEntry('pricing'),
      makeCafeEntry('operating_hours'),
    ]);

    const { report, cleaned } = runPelangiContentRemoval('makan', data);

    expect(report.static_entries_removed).toBe(0);
    expect(report.static_entries_after).toBe(3);
    expect(cleaned.static).toHaveLength(3);
    expect(report.hostel_references_remaining).toBe(0);
  });

  it('removes hostel dynamic entries', () => {
    const data = makeKnowledgeFile([makeCafeEntry('greeting')], {
      cafe_template: 'Menu items for today',
      hostel_welcome: 'Welcome to Pelangi Capsule Hostel',
    });

    const { report, cleaned } = runPelangiContentRemoval('makan', data);

    expect(report.dynamic_keys_removed).toBe(1);
    expect(cleaned.dynamic).toBeDefined();
    expect(cleaned.dynamic!['cafe_template']).toBe('Menu items for today');
    expect(cleaned.dynamic!['hostel_welcome']).toBeUndefined();
  });

  it('reports zero hostel references after cleanup', () => {
    const data = makeKnowledgeFile([
      makeCafeEntry('greeting'),
      makeHostelEntry('checkin_info'),
    ]);

    const { report } = runPelangiContentRemoval('makan', data);
    expect(report.hostel_references_remaining).toBe(0);
  });

  it('returns report with correct structure', () => {
    const data = makeKnowledgeFile([makeCafeEntry('greeting')]);
    const { report } = runPelangiContentRemoval('makan', data);

    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('profile');
    expect(report).toHaveProperty('static_entries_before');
    expect(report).toHaveProperty('static_entries_after');
    expect(report).toHaveProperty('static_entries_removed');
    expect(report).toHaveProperty('removed_entries');
    expect(report).toHaveProperty('hostel_references_remaining');
    expect(report).toHaveProperty('success');
    expect(report.profile).toBe('makan');
    expect(report.success).toBe(true);
  });

  it('preserves entry order after removal', () => {
    const data = makeKnowledgeFile([
      makeCafeEntry('greeting'),
      makeHostelEntry('checkin_info'),
      makeCafeEntry('pricing'),
      makeHostelEntry('facilities'),
      makeCafeEntry('operating_hours'),
    ]);

    const { cleaned } = runPelangiContentRemoval('makan', data);

    expect(cleaned.static).toHaveLength(3);
    expect(cleaned.static[0].intent).toBe('greeting');
    expect(cleaned.static[1].intent).toBe('pricing');
    expect(cleaned.static[2].intent).toBe('operating_hours');
  });
});

// ── AC1: dry-run shows list of removable entries ─────────────────────

describe('AC1: dry-run shows list of removable entries without modifying files', () => {
  it('runPelangiContentRemoval returns removable entries without modifying input', () => {
    const data = makeKnowledgeFile([
      makeCafeEntry('greeting'),
      makeHostelEntry('checkin_info'),
      makeCafeEntry('pricing'),
    ]);
    const originalLength = data.static.length;

    const { report } = runPelangiContentRemoval('makan', data);

    // Input data is NOT modified (pure function)
    expect(data.static.length).toBe(originalLength);
    // Report shows removable entries
    expect(report.removed_entries.length).toBeGreaterThan(0);
    expect(report.removed_entries[0].intent).toBe('checkin_info');
  });

  it('reports all hostel entries as removable', () => {
    const data = makeKnowledgeFile([
      makeHostelEntry('checkin_info'),
      makeHostelEntry('checkout_info'),
      makeHostelEntry('room_type_inquiry'),
      makeCafeEntry('greeting'),
    ]);

    const { report } = runPelangiContentRemoval('makan', data);

    expect(report.removed_entries).toHaveLength(3);
    const removedIntents = report.removed_entries.map(e => e.intent);
    expect(removedIntents).toContain('checkin_info');
    expect(removedIntents).toContain('checkout_info');
    expect(removedIntents).toContain('room_type_inquiry');
  });
});

// ── AC2: removes content, creates backup, validates output ───────────

describe('AC2: removes content and validates output contains only cafe-specific keywords', () => {
  it('cleaned output contains no hostel entries', () => {
    const data = makeKnowledgeFile([
      makeCafeEntry('greeting'),
      makeHostelEntry('checkin_info'),
      makeHostelEntry('facilities'),
      makeCafeEntry('pricing'),
      makeCafeEntry('vegetarian_query'),
    ]);

    const { cleaned } = runPelangiContentRemoval('makan', data);

    // Verify all remaining entries are cafe content
    for (const entry of cleaned.static) {
      expect(isPelangiIntent(entry.intent)).toBe(false);
      expect(entry.profile_id).not.toBe('pelangi');
    }
  });

  it('validates output has zero hostel references', () => {
    const data = makeKnowledgeFile([
      makeCafeEntry('greeting'),
      makeHostelEntry('checkin_info'),
      makeHostelEntry('checkout_info'),
      makeCafeEntry('pricing'),
    ]);

    const { report, cleaned } = runPelangiContentRemoval('makan', data);

    expect(report.hostel_references_remaining).toBe(0);
    expect(countHostelReferences(cleaned)).toBe(0);
  });
});

// ── AC3: reports removal stats and zero hostel references ────────────

describe('AC3: reports removal stats and zero hostel references in final knowledge.json', () => {
  it('reports accurate removal statistics', () => {
    const data = makeKnowledgeFile([
      makeCafeEntry('greeting'),
      makeHostelEntry('checkin_info'),
      makeHostelEntry('checkout_info'),
      makeCafeEntry('pricing'),
      makeCafeEntry('operating_hours'),
    ]);

    const { report } = runPelangiContentRemoval('makan', data);

    expect(report.static_entries_before).toBe(5);
    expect(report.static_entries_removed).toBe(2);
    expect(report.static_entries_after).toBe(3);
    expect(report.hostel_references_remaining).toBe(0);
    expect(report.success).toBe(true);
  });

  it('reports zero removals when no hostel content exists', () => {
    const data = makeKnowledgeFile([
      makeCafeEntry('greeting'),
      makeCafeEntry('pricing'),
    ]);

    const { report } = runPelangiContentRemoval('makan', data);

    expect(report.static_entries_removed).toBe(0);
    expect(report.hostel_references_remaining).toBe(0);
    expect(report.success).toBe(true);
  });

  it('removal details include reason and matched patterns', () => {
    const data = makeKnowledgeFile([makeHostelEntry('checkin_info')]);

    const { report } = runPelangiContentRemoval('makan', data);

    expect(report.removed_entries).toHaveLength(1);
    expect(report.removed_entries[0].reason).toBeTruthy();
    expect(report.removed_entries[0].matchedPatterns.length).toBeGreaterThan(0);
  });
});

// ── Integration: real knowledge file ─────────────────────────────────

describe('Integration: real makan knowledge.json', () => {
  const makanKnowledgePath = path.join(rootDir, 'src/assistant/data-makan/knowledge.json');

  it('loads real makan knowledge.json', () => {
    const data = loadKnowledgeFile(makanKnowledgePath);
    expect(data.static).toBeDefined();
    expect(data.static.length).toBeGreaterThan(0);
  });

  it('analyzes real makan knowledge.json for Pelangi content', () => {
    const data = loadKnowledgeFile(makanKnowledgePath);
    const { report, cleaned } = runPelangiContentRemoval('makan', data);

    expect(report.profile).toBe('makan');
    expect(typeof report.static_entries_removed).toBe('number');
    expect(typeof report.hostel_references_remaining).toBe('number');
    expect(report.success).toBe(true);

    // After cleanup, verify no hostel references remain
    expect(countHostelReferences(cleaned)).toBe(0);
  });

  it('preserves cafe-specific entries in real data', () => {
    const data = loadKnowledgeFile(makanKnowledgePath);
    const { cleaned } = runPelangiContentRemoval('makan', data);

    // Should still have entries after cleanup
    expect(cleaned.static.length).toBeGreaterThan(0);

    // All remaining entries should have makan profile_id or no hostel content
    for (const entry of cleaned.static) {
      const hostelPatterns = findHostelPatterns(getAllResponseText(entry));
      // If it has hostel patterns, it should also have strong cafe content
      if (hostelPatterns.length > 0) {
        expect(hasCafeContent(getAllResponseText(entry))).toBe(true);
      }
    }
  });
});
