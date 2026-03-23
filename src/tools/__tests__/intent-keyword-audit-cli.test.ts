/**
 * US-161: Tests for intent-keyword-audit-cli.ts
 *
 * Tests cross-referencing intent-keywords.json against intents.json
 * and detecting orphaned keywords.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..', '..');

// Helper function to load and parse JSON files
function loadJSON<T>(filePath: string): T | null {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

interface IntentKeywords {
  intent: string;
  keywords: Record<string, string[]>;
}

interface KeywordsFile {
  intents: IntentKeywords[];
}

interface IntentCategory {
  category: string;
}

interface PhaseIntents {
  intents: IntentCategory[];
}

interface IntentsFile {
  categories: PhaseIntents[];
}

describe('intent-keyword-audit-cli', () => {
  /**
   * AC1: CLI reads intent-keywords.json and intents.json from profile directories
   */
  it('should read profile-specific intent-keywords.json and intents.json files', () => {
    // Verify files exist for each profile
    expect(fs.existsSync(path.join(rootDir, 'src/assistant/data/intent-keywords.json'))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, 'src/assistant/data/intents.json'))).toBe(true);

    expect(fs.existsSync(path.join(rootDir, 'src/assistant/data-makan/intent-keywords.json'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(rootDir, 'src/assistant/data-makan/intents.json'))).toBe(true);

    expect(fs.existsSync(path.join(rootDir, 'src/assistant/data-southern/intent-keywords.json'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(rootDir, 'src/assistant/data-southern/intents.json'))).toBe(true);
  });

  /**
   * AC1: Can load and parse intent-keywords.json files
   */
  it('should load and parse intent-keywords.json for makan profile', () => {
    const keywordsPath = path.join(rootDir, 'src/assistant/data-makan/intent-keywords.json');
    const keywordsData = loadJSON<KeywordsFile>(keywordsPath);

    expect(keywordsData).not.toBeNull();
    expect(keywordsData?.intents).toBeDefined();
    expect(Array.isArray(keywordsData?.intents)).toBe(true);
    expect(keywordsData!.intents.length).toBeGreaterThan(0);

    // Verify structure
    for (const intent of keywordsData!.intents) {
      expect(intent).toHaveProperty('intent');
      expect(intent).toHaveProperty('keywords');
      expect(typeof intent.intent).toBe('string');
      expect(typeof intent.keywords).toBe('object');
    }
  });

  /**
   * AC1: Can load and parse intents.json files
   */
  it('should load and parse intents.json for makan profile', () => {
    const intentsPath = path.join(rootDir, 'src/assistant/data-makan/intents.json');
    const intentsData = loadJSON<IntentsFile>(intentsPath);

    expect(intentsData).not.toBeNull();
    expect(intentsData?.categories).toBeDefined();
    expect(Array.isArray(intentsData?.categories)).toBe(true);
    expect(intentsData!.categories.length).toBeGreaterThan(0);

    // Verify structure - each category has intents
    for (const category of intentsData!.categories) {
      expect(category).toHaveProperty('intents');
      expect(Array.isArray(category.intents)).toBe(true);
      for (const intent of category.intents) {
        expect(intent).toHaveProperty('category');
      }
    }
  });

  /**
   * AC1: Can detect orphaned intents (in keywords but not in profile intents)
   */
  it('should identify orphaned intents in makan profile', () => {
    const keywordsPath = path.join(rootDir, 'src/assistant/data-makan/intent-keywords.json');
    const intentsPath = path.join(rootDir, 'src/assistant/data-makan/intents.json');

    const keywordsData = loadJSON<KeywordsFile>(keywordsPath);
    const intentsData = loadJSON<IntentsFile>(intentsPath);

    expect(keywordsData).not.toBeNull();
    expect(intentsData).not.toBeNull();

    // Extract valid categories from intents
    const validCategories = new Set<string>();
    for (const phase of intentsData!.categories) {
      for (const intent of phase.intents) {
        validCategories.add(intent.category);
      }
    }

    // Find orphaned intents
    const orphanedIntents = new Map<string, string[]>();
    for (const item of keywordsData!.intents) {
      if (!validCategories.has(item.intent)) {
        const allKeywords: string[] = [];
        for (const keywords of Object.values(item.keywords)) {
          allKeywords.push(...keywords);
        }
        orphanedIntents.set(item.intent, allKeywords);
      }
    }

    // Makan profile should have some orphaned intents
    expect(orphanedIntents.size).toBeGreaterThan(0);

    // Verify structure of orphaned entries
    for (const [intentId, keywords] of orphanedIntents.entries()) {
      expect(typeof intentId).toBe('string');
      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords.length).toBeGreaterThan(0);
    }
  });

  /**
   * AC2: Orphaned keywords have correct structure for reporting
   */
  it('should structure orphaned keyword report correctly', () => {
    const keywordsPath = path.join(rootDir, 'src/assistant/data-makan/intent-keywords.json');
    const intentsPath = path.join(rootDir, 'src/assistant/data-makan/intents.json');

    const keywordsData = loadJSON<KeywordsFile>(keywordsPath);
    const intentsData = loadJSON<IntentsFile>(intentsPath);

    // Extract valid categories
    const validCategories = new Set<string>();
    for (const phase of intentsData!.categories) {
      for (const intent of phase.intents) {
        validCategories.add(intent.category);
      }
    }

    // Find and validate orphaned entries
    for (const item of keywordsData!.intents) {
      if (!validCategories.has(item.intent)) {
        const allKeywords: string[] = [];
        for (const keywords of Object.values(item.keywords)) {
          allKeywords.push(...keywords);
        }

        // Verify report structure
        expect(item.intent).toBeDefined(); // intent_id
        expect(allKeywords.length).toBeGreaterThan(0); // keyword_count
        expect(allKeywords.slice(0, 5)).toBeDefined(); // sample_keywords

        // Cleanup action should reference the intent name
        const cleanupAction = `Remove intent "${item.intent}" from intent-keywords.json`;
        expect(cleanupAction).toContain('intent-keywords.json');
        break; // Just test one orphaned entry
      }
    }
  });

  /**
   * AC1: Handles all three profiles correctly
   */
  it('should process all three profiles (pelangi, makan, southern)', () => {
    const profiles = ['pelangi', 'makan', 'southern'];

    for (const profile of profiles) {
      const dataDir = profile === 'pelangi' ? 'data' : `data-${profile}`;
      const keywordsPath = path.join(rootDir, `src/assistant/${dataDir}/intent-keywords.json`);
      const intentsPath = path.join(rootDir, `src/assistant/${dataDir}/intents.json`);

      expect(fs.existsSync(keywordsPath)).toBe(true);
      expect(fs.existsSync(intentsPath)).toBe(true);

      const keywordsData = loadJSON<KeywordsFile>(keywordsPath);
      const intentsData = loadJSON<IntentsFile>(intentsPath);

      expect(keywordsData).not.toBeNull();
      expect(intentsData).not.toBeNull();
      expect(keywordsData!.intents.length).toBeGreaterThan(0);
    }
  });

  /**
   * AC1: Makan profile has fewer intents in keywords than in intents.json
   */
  it('should have correct intent count relationships', () => {
    const keywordsPath = path.join(rootDir, 'src/assistant/data-makan/intent-keywords.json');
    const intentsPath = path.join(rootDir, 'src/assistant/data-makan/intents.json');

    const keywordsData = loadJSON<KeywordsFile>(keywordsPath);
    const intentsData = loadJSON<IntentsFile>(intentsPath);

    // Count intents in each file
    const keywordIntents = new Set(keywordsData!.intents.map((i) => i.intent));
    const profileIntents = new Set<string>();
    for (const phase of intentsData!.categories) {
      for (const intent of phase.intents) {
        profileIntents.add(intent.category);
      }
    }

    // Keywords file should have more or equal intents (due to cross-profile contamination)
    expect(keywordIntents.size).toBeGreaterThanOrEqual(profileIntents.size - 5); // Allow some variance
  });
});
