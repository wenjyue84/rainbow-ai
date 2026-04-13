import { readFileSync } from 'fs';
import { join } from 'path';
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

// Test pelangi
const keywordPath = join(process.cwd(), `src/assistant/data/intent-keywords-pelangi.json`);
const keywordData = JSON.parse(readFileSync(keywordPath, 'utf-8'));

const keywordIntents = [];
for (const intent of keywordData.intents) {
  for (const [lang, keywords] of Object.entries(intent.keywords || {})) {
    keywordIntents.push({
      intent: intent.intent,
      keywords,
      language: lang,
    });
  }
}

const matcher = new FuzzyIntentMatcher(keywordIntents);

// Test cases from pelangi/booking.json
const testCases = [
  "I want to book a room",
  "Can I reserve a capsule for tomorrow?",
  "I'd like to make a booking",
  "Book me a bed for 3 nights",
  "Can I check in this weekend?",
  "Saya nak booking untuk esok",
  "Macam mana nak book?",
];

for (const text of testCases) {
  const result = matcher.match(text);
  console.log(`"${text}"`);
  console.log(`  → ${result?.intent || 'null'} (score: ${result?.score?.toFixed(2) || 'N/A'})`);
  console.log(`  → matched keyword: "${result?.matchedKeyword || 'N/A'}"`);
}
