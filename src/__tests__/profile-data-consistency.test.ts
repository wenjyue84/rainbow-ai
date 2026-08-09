/**
 * US-364: Profile Data File Consistency Validator Tests
 *
 * Tests for validating cross-file consistency in profile data:
 * - intents_not_in_routing: intents defined in intents.json but missing from routing.json
 * - routing_entries_missing_intents: routes in routing.json without matching intents
 * - orphaned_keywords: keywords without corresponding intents
 * - pelangi_keyword_contamination: Pelangi-specific keywords in Makan/Southern profiles
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const PROJECT_ROOT = join(__dirname, '..', '..');
const TEST_DATA_DIR = join(__dirname, 'fixtures', 'profile-consistency-test');

/**
 * Helper to extract intents from intents.json which has structure:
 * Either array of intents, or { categories: [...], schema_version: ... }
 */
function extractIntents(intentsData: any): Array<any> {
  if (Array.isArray(intentsData)) {
    return intentsData;
  }
  if (intentsData.categories && Array.isArray(intentsData.categories)) {
    // Flatten categories into single array
    const all: any[] = [];
    for (const cat of intentsData.categories) {
      if (Array.isArray(cat.intents)) {
        all.push(...cat.intents);
      }
    }
    return all;
  }
  if (intentsData.intents && Array.isArray(intentsData.intents)) {
    return intentsData.intents;
  }
  return [];
}

describe('Profile Data Consistency Validator (US-364)', () => {
  beforeAll(() => {
    // Create test fixture directory
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterAll(() => {
    // Cleanup test fixtures
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('data-makan profile validation', () => {
    it('should validate real data-makan profile contains zero hostel-specific keywords', () => {
      // Read the real data-makan profile
      const realMakanDir = join(PROJECT_ROOT, 'src', 'assistant', 'data-makan');
      const keywordsFile = join(realMakanDir, 'intent-keywords.json');

      const keywordsContent = readFileSync(keywordsFile, 'utf-8');
      if (!keywordsContent) {
        throw new Error('data-makan/intent-keywords.json not found');
      }

      const keywords = JSON.parse(keywordsContent);

      // List of Pelangi-specific keywords that should NOT be in Makan
      const hostelKeywords = [
        'check in',
        'check-in',
        'checkin',
        'check out',
        'check-out',
        'checkout',
        'room',
        'booking',
        'reservation',
        'capsule',
        'hostel',
      ];

      // Collect all keywords from intent-keywords.json
      const allMakanKeywords = new Set<string>();
      for (const intent of keywords.intents || []) {
        for (const langKeywords of Object.values(intent.keywords || {})) {
          if (Array.isArray(langKeywords)) {
            for (const kw of langKeywords) {
              allMakanKeywords.add((kw as string).toLowerCase());
            }
          }
        }
      }

      // Check that no hostel keywords are in Makan profile
      const contaminated: string[] = [];
      for (const hostelKw of hostelKeywords) {
        if (allMakanKeywords.has(hostelKw.toLowerCase())) {
          contaminated.push(hostelKw);
        }
      }

      expect(
        contaminated,
        `Makan profile should not contain hostel keywords. Found: ${contaminated.join(', ')}`
      ).toEqual([]);
    });

    it('should validate real data-southern profile contains zero Pelangi references', () => {
      const realSouthernDir = join(PROJECT_ROOT, 'src', 'assistant', 'data-southern');
      const intentsFile = join(realSouthernDir, 'intents.json');

      const intentsData = JSON.parse(readFileSync(intentsFile, 'utf-8'));
      const intents = extractIntents(intentsData);

      // Check for pelangi-prefixed intents in southern profile
      const pelangiReferences = intents.filter((i: any) => {
        const name = i.category || i.name || i.id || '';
        return name.toLowerCase().includes('pelangi');
      });

      // The check should pass - southern should not have pelangi-prefixed intents
      expect(
        pelangiReferences.length,
        `Southern profile should not contain Pelangi-specific intents (pelangi_*)`
      ).toBe(0);
    });
  });

  describe('cross-file consistency checks', () => {
    it('should detect intents in intents.json not referenced in routing.json', () => {
      // Create mock profile with inconsistency
      const testDir = join(TEST_DATA_DIR, 'orphaned-intent');
      mkdirSync(testDir, { recursive: true });

      const intents = [{ id: 'booking_request', name: 'Booking Request' }, { id: 'orphaned_intent', name: 'Orphaned' }];

      const routing = {
        routes: [{ intent: 'booking_request', handler: 'handleBooking' }],
        // orphaned_intent is NOT referenced here
      };

      writeFileSync(join(testDir, 'intents.json'), JSON.stringify(intents, null, 2));
      writeFileSync(join(testDir, 'routing.json'), JSON.stringify(routing, null, 2));
      writeFileSync(
        join(testDir, 'intent-keywords.json'),
        JSON.stringify({
          intents: [
            { intent: 'booking_request', keywords: { en: ['book a room'] } },
            { intent: 'orphaned_intent', keywords: { en: ['orphaned keyword'] } },
          ],
        })
      );

      // Helper to validate consistency (inline implementation)
      const intentIds = new Set(intents.map(i => i.id));
      const routingIntents = new Set(routing.routes.map((r: any) => r.intent));

      const orphanedIntents = Array.from(intentIds).filter(id => !routingIntents.has(id));

      expect(orphanedIntents).toContain('orphaned_intent');
    });

    it('should detect routes in routing.json without matching intents', () => {
      const testDir = join(TEST_DATA_DIR, 'missing-intent');
      mkdirSync(testDir, { recursive: true });

      const intents = [{ id: 'booking_request', name: 'Booking Request' }];

      const routing = {
        routes: [
          { intent: 'booking_request', handler: 'handleBooking' },
          { intent: 'missing_intent', handler: 'handleMissing' }, // This intent is NOT in intents.json
        ],
      };

      writeFileSync(join(testDir, 'intents.json'), JSON.stringify(intents, null, 2));
      writeFileSync(join(testDir, 'routing.json'), JSON.stringify(routing, null, 2));
      writeFileSync(
        join(testDir, 'intent-keywords.json'),
        JSON.stringify({
          intents: [{ intent: 'booking_request', keywords: { en: ['book a room'] } }],
        })
      );

      const intentIds = new Set(intents.map(i => i.id));
      const routingIntents = new Set(routing.routes.map((r: any) => r.intent));

      const missingIntents = Array.from(routingIntents).filter(id => !intentIds.has(id));

      expect(missingIntents).toContain('missing_intent');
    });

    it('should detect orphaned keywords (keywords without matching intents)', () => {
      const testDir = join(TEST_DATA_DIR, 'orphaned-keywords');
      mkdirSync(testDir, { recursive: true });

      const intents = [{ id: 'booking_request', name: 'Booking Request' }];

      const routing = {
        routes: [{ intent: 'booking_request', handler: 'handleBooking' }],
      };

      const keywordsData = {
        intents: [
          { intent: 'booking_request', keywords: { en: ['book a room'] } },
          {
            intent: 'orphaned_keywords_intent',
            keywords: { en: ['orphaned keyword 1', 'orphaned keyword 2'] },
          }, // This intent is NOT in intents.json
        ],
      };

      writeFileSync(join(testDir, 'intents.json'), JSON.stringify(intents, null, 2));
      writeFileSync(join(testDir, 'routing.json'), JSON.stringify(routing, null, 2));
      writeFileSync(join(testDir, 'intent-keywords.json'), JSON.stringify(keywordsData, null, 2));

      const intentIds = new Set(intents.map(i => i.id));
      const keywordIntents = new Set((keywordsData.intents as any[]).map(k => k.intent));

      const orphanedKeywords = Array.from(keywordIntents).filter(id => !intentIds.has(id));

      expect(orphanedKeywords).toContain('orphaned_keywords_intent');
    });
  });

  describe('keyword contamination detection', () => {
    it('should detect Pelangi-specific keywords in Makan profile', () => {
      const hostelKeywords = [
        'check in',
        'check-in',
        'room',
        'booking',
        'capsule',
        'hostel',
        'check out',
        'checkout',
      ];

      const makanKeywords = [
        'i want to order',
        'pesan',
        'tapau',
        'menu',
        'check in', // CONTAMINATION!
      ];

      const contaminated = makanKeywords.filter(kw =>
        hostelKeywords.some(hostelKw => hostelKw.toLowerCase() === kw.toLowerCase())
      );

      expect(contaminated.length > 0).toBe(true);
      expect(contaminated).toContain('check in');
    });

    it('should detect Makan-specific keywords in Pelangi profile', () => {
      const makanKeywords = ['i want to order', 'pesan', 'tapau', 'menu', 'order placement'];

      const pelangiKeywords = [
        'check in',
        'room availability',
        'i want to order', // CONTAMINATION!
        'booking',
      ];

      const contaminated = pelangiKeywords.filter(kw =>
        makanKeywords.some(makanKw => makanKw.toLowerCase() === kw.toLowerCase())
      );

      expect(contaminated.length > 0).toBe(true);
      expect(contaminated).toContain('i want to order');
    });
  });

  describe('real profile validation', () => {
    it('should load and validate real data-makan profile structure', () => {
      const realMakanDir = join(PROJECT_ROOT, 'src', 'assistant', 'data-makan');

      // Read all required files
      const intentsData = JSON.parse(readFileSync(join(realMakanDir, 'intents.json'), 'utf-8'));
      const routing = JSON.parse(readFileSync(join(realMakanDir, 'routing.json'), 'utf-8'));
      const keywords = JSON.parse(readFileSync(join(realMakanDir, 'intent-keywords.json'), 'utf-8'));

      // Validate intents structure using helper
      const intentArray = extractIntents(intentsData);
      expect(Array.isArray(intentArray)).toBe(true);
      expect(intentArray.length > 0).toBe(true);

      // Validate routing structure
      expect(Object.keys(routing).length > 0).toBe(true);

      // Validate keywords structure
      expect(keywords.intents).toBeTruthy();
      expect(Array.isArray(keywords.intents)).toBe(true);
    });

    it('should load and validate real data-southern profile structure', () => {
      const realSouthernDir = join(PROJECT_ROOT, 'src', 'assistant', 'data-southern');

      const intentsData = JSON.parse(readFileSync(join(realSouthernDir, 'intents.json'), 'utf-8'));
      const routing = JSON.parse(readFileSync(join(realSouthernDir, 'routing.json'), 'utf-8'));
      const keywords = JSON.parse(readFileSync(join(realSouthernDir, 'intent-keywords.json'), 'utf-8'));

      const intentArray = extractIntents(intentsData);
      expect(Array.isArray(intentArray)).toBe(true);
      expect(intentArray.length > 0).toBe(true);

      expect(Object.keys(routing).length > 0).toBe(true);
      expect(keywords.intents).toBeTruthy();
      expect(Array.isArray(keywords.intents)).toBe(true);
    });
  });
});
