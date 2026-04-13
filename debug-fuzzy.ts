import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { FuzzyIntentMatcher, type KeywordIntent } from './src/assistant/fuzzy-matcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

function buildMatcher(profileId: string): FuzzyIntentMatcher {
  const keywordPath = join(ROOT, 'src', 'assistant', 'data', `intent-keywords-${profileId}.json`);
  const keywordData = JSON.parse(readFileSync(keywordPath, 'utf-8'));

  const keywordIntents: KeywordIntent[] = [];
  for (const intent of keywordData.intents) {
    for (const [lang, keywords] of Object.entries<string[]>(intent.keywords)) {
      keywordIntents.push({
        intent: intent.intent,
        keywords,
        language: lang as 'en' | 'ms' | 'zh' | 'ta',
      });
    }
    if (intent.regional_variants) {
      for (const [lang, variants] of Object.entries<string[]>(intent.regional_variants)) {
        keywordIntents.push({
          intent: intent.intent,
          keywords: variants,
          language: lang as 'en' | 'ms' | 'zh' | 'ta',
        });
      }
    }
  }
  
  console.log(`Built matcher for ${profileId} with ${keywordIntents.length} keyword intent entries`);
  return new FuzzyIntentMatcher(keywordIntents);
}

// Test
const matcher = buildMatcher('pelangi');
const testTexts = [
  'I want to book a room',
  'Can I reserve a capsule for tomorrow?',
  'booking please'
];

console.log('\n--- Testing Pelangi Matcher ---');
for (const text of testTexts) {
  const result = matcher.match(text);
  console.log(`"${text}" -> ${result ? `${result.intent} (${result.score.toFixed(2)})` : 'null'}`);
}
