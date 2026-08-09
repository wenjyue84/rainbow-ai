// One-shot data patch: ensure cancel_booking T1 patterns sit BEFORE booking in
// intents.json (RE2 has no lookahead — order is the only guard against the
// booking pattern matching "cancel my booking"). Safe to re-run.
import { readFileSync, writeFileSync } from 'fs';

const p = new URL('../src/assistant/data/intents.json', import.meta.url);
const d = JSON.parse(readFileSync(p, 'utf8'));

const entry = {
  category: 'cancel_booking',
  description:
    'Guest wants to cancel an existing booking — must outrank the booking pattern (RE2 has no lookahead, so order is the guard).',
  patterns: [
    '\\b(cancel|cancelling|cancelled|cancellation)\\b.{0,40}\\b(book|booking|reservation|reserve|room|stay|bed|capsule)\\b',
    '\\b(batal|pembatalan|membatalkan)\\b.{0,40}\\b(tempahan|booking|bilik)\\b',
    '(取消|退订|退单)',
    '^\\s*(cancel|cancellation|batal|取消)\\s*(please|pls)?\\s*$',
  ],
  flags: 'i',
  min_confidence: 0.9,
};

let done = false;
for (const cat of d.categories) {
  const intents = cat.intents || [];
  const existing = intents.findIndex((i) => i.category === 'cancel_booking');
  const bookingIdx = intents.findIndex((i) => i.category === 'booking');
  if (existing >= 0) {
    intents[existing] = entry; // replace (fixes earlier mangled escapes)
    done = true;
    break;
  }
  if (bookingIdx >= 0) {
    intents.splice(bookingIdx, 0, entry);
    done = true;
    break;
  }
}
if (!done) {
  console.error('booking intent not found in intents.json');
  process.exit(1);
}
writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
console.log('cancel_booking T1 entry written (patterns verified below):');
for (const pat of entry.patterns) console.log('  ', JSON.stringify(pat));
