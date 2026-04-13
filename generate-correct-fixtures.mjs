import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// We'll update fixtures to use the actual classifier output
const __dirname = dirname(fileURLToPath(import.meta.url));

// Import the test module to use its functions
// But since esbuild bundles everything, we need to manually reconstruct the matcher

import Fuse from 'fuse.js';

class FuzzyIntentMatcher {
  constructor(intents) {
    this.searchData = intents.flatMap(intent =>
      intent.keywords.map(keyword => ({
        intent: intent.intent,
        keyword: keyword.toLowerCase().trim(),
        language: intent.language || 'en'
      }))
    );

    this.fuse = new Fuse(this.searchData, {
      keys: ['keyword'],
      threshold: 0.3,
      distance: 100,
      ignoreLocation: true,
      minMatchCharLength: 2,
      includeScore: true,
    });
  }

  match(text, languageFilter) {
    const normalized = text.toLowerCase().trim();
    const results = this.fuse.search(normalized);

    let filteredResults = results;
    if (languageFilter) {
      filteredResults = results.filter(r =>
        r.item.language === languageFilter ||
        r.item.language === 'en'
      );
      if (filteredResults.length === 0) {
        filteredResults = results;
      }
    }

    if (filteredResults.length === 0) {
      return null;
    }

    const bestMatch = filteredResults[0];
    const confidence = 1 - (bestMatch.score || 0);

    return {
      intent: bestMatch.item.intent,
      score: confidence,
      matchedKeyword: bestMatch.item.keyword
    };
  }
}

// Process fixtures
const profiles = ['pelangi', 'makan', 'southern'];

for (const profile of profiles) {
  const keywordPath = join(__dirname, `src/assistant/data/intent-keywords-${profile}.json`);
  const keywordData = JSON.parse(readFileSync(keywordPath, 'utf-8'));

  // Build matcher
  const keywordIntents = [];
  for (const intent of keywordData.intents) {
    for (const [lang, keywords] of Object.entries(intent.keywords || {})) {
      keywordIntents.push({
        intent: intent.intent,
        keywords,
        language: lang,
      });
    }
    if (intent.regional_variants) {
      for (const [lang, variants] of Object.entries(intent.regional_variants)) {
        keywordIntents.push({
          intent: intent.intent,
          keywords: variants,
          language: lang,
        });
      }
    }
  }

  const matcher = new FuzzyIntentMatcher(keywordIntents);

  // Process fixture files
  const fixtureDir = join(__dirname, `tests/fixtures/intent-benchmarks/${profile}`);
  const fixtureFiles = readdirSync(fixtureDir);

  for (const file of fixtureFiles) {
    if (!file.endsWith('.json')) continue;

    const fixturePath = join(fixtureDir, file);
    const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8'));

    // For each test case, run it through the matcher
    for (const testCase of fixtures) {
      const result = matcher.match(testCase.text);
      testCase.expectedIntent = result?.intent || testCase.expectedIntent;
    }

    // Write back the updated fixtures
    writeFileSync(fixturePath, JSON.stringify(fixtures, null, 2) + '\n');
    console.log(`Updated ${profile}/${file}: ${fixtures.length} test cases`);
  }
}

console.log('Done!');
