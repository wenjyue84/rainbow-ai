import { readFileSync } from 'fs';
import { join } from 'path';

const keywordPath = join(process.cwd(), 'src', 'assistant', 'data', 'intent-keywords-pelangi.json');
const data = JSON.parse(readFileSync(keywordPath, 'utf-8'));

// Find all booking-related intents
const bookingIntents = data.intents.filter((i: any) => 
  i.intent.includes('booking') || 
  i.intent.includes('check_in') || 
  i.intent.includes('availability')
);

console.log('Booking-related intents:');
for (const intent of bookingIntents) {
  console.log(`\n${intent.intent}:`);
  const enKeywords = intent.keywords.en || [];
  console.log(`  EN: ${enKeywords.slice(0, 10).join(', ')}`);
}
