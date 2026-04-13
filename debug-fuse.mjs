import Fuse from 'fuse.js';

// Create simple test data
const searchData = [
  { keyword: 'i want to book', intent: 'booking' },
  { keyword: 'want to book', intent: 'booking' },
  { keyword: 'book a room', intent: 'booking' },
  { keyword: 'reserve', intent: 'booking' },
];

const fuse = new Fuse(searchData, {
  keys: ['keyword'],
  threshold: 0.3,
  distance: 100,
  ignoreLocation: true,
  minMatchCharLength: 2,
  includeScore: true,
});

// Test queries
const queries = [
  'i want to book a room',
  'want to book',
  'book a room',
  'can i reserve',
];

for (const query of queries) {
  const results = fuse.search(query);
  console.log(`Query: "${query}"`);
  console.log(`  Results: ${results.length}`);
  for (const result of results) {
    console.log(`    - ${result.item.keyword} (score: ${result.score?.toFixed(3)}, intent: ${result.item.intent})`);
  }
}
