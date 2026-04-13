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

// Test with different thresholds
const testText = 'I want to book a room';
const thresholds = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

for (const threshold of thresholds) {
  const fuse = new Fuse(searchData, {
    keys: ['keyword'],
    threshold: threshold,
    distance: 100,
    ignoreLocation: true,
    minMatchCharLength: 2,
    includeScore: true,
  });
  
  const results = fuse.search(testText.toLowerCase());
  console.log(`Threshold ${threshold}: ${results.length} results`);
  if (results.length > 0) {
    const top = results.slice(0, 3);
    for (const r of top) {
      console.log(`    ${r.item.keyword} (${r.item.intent}, score: ${r.score?.toFixed(3)})`);
    }
  }
}
