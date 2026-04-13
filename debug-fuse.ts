import { readFileSync } from 'fs';
import { join } from 'path';
import Fuse from 'fuse.js';

const keywordPath = join(process.cwd(), 'src', 'assistant', 'data', 'intent-keywords-pelangi.json');
const data = JSON.parse(readFileSync(keywordPath, 'utf-8'));

// Build searchData like the matcher does
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

console.log(`Total searchData items: ${searchData.length}`);

// Create Fuse instance with same config as FuzzyIntentMatcher
const fuse = new Fuse(searchData, {
  keys: ['keyword'],
  threshold: 0.3,
  distance: 100,
  ignoreLocation: true,
  minMatchCharLength: 2,
  includeScore: true,
});

// Test search
const testText = 'I want to book a room';
const results = fuse.search(testText.toLowerCase());

console.log(`\nSearching for: "${testText}"`);
console.log(`Found ${results.length} results (threshold 0.3):`);
for (const r of results.slice(0, 10)) {
  console.log(`  - ${r.item.keyword} (${r.item.intent}, score: ${r.score?.toFixed(3)})`);
}
