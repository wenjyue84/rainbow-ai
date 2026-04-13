import { readFileSync } from 'fs';
import { join } from 'path';
import Fuse from 'fuse.js';

const keywordPath = join(process.cwd(), 'src', 'assistant', 'data', 'intent-keywords-pelangi.json');
const data = JSON.parse(readFileSync(keywordPath, 'utf-8'));

// Build searchData
const searchData: any[] = [];
for (const intent of data.intents) {
  for (const [lang, keywords] of Object.entries<string[]>(intent.keywords)) {
    for (const keyword of keywords) {
      searchData.push({
        intent: intent.intent,
        keyword: keyword.toLowerCase().trim(),
        language: lang
      });
    }
  }
}

// Test "booking please" with the same threshold as FuzzyIntentMatcher (0.3)
const fuse = new Fuse(searchData, {
  keys: ['keyword'],
  threshold: 0.3,
  distance: 100,
  ignoreLocation: true,
  minMatchCharLength: 2,
  includeScore: true,
});

const testText = 'booking please';
const results = fuse.search(testText.toLowerCase());
console.log(`"${testText}" with threshold 0.3: ${results.length} results`);
for (const r of results.slice(0, 10)) {
  console.log(`  - ${r.item.keyword} (${r.item.intent}, score: ${r.score?.toFixed(3)})`);
}

// Now test with threshold 0.6
const fuse2 = new Fuse(searchData, {
  keys: ['keyword'],
  threshold: 0.6,
  distance: 100,
  ignoreLocation: true,
  minMatchCharLength: 2,
  includeScore: true,
});

const results2 = fuse2.search(testText.toLowerCase());
console.log(`\n"${testText}" with threshold 0.6: ${results2.length} results`);
for (const r of results2.slice(0, 10)) {
  console.log(`  - ${r.item.keyword} (${r.item.intent}, score: ${r.score?.toFixed(3)})`);
}
