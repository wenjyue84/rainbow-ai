// Follow-up fix for 3 pre-existing 50-suite misroutes surfaced 2026-07-21:
// #7 deposit question → booking workflow, #21 after-booking question → booking
// workflow, #38 change-date → checkin_info. Adds override patterns + routing.

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assistant', 'data');
const load = async (f) => JSON.parse(await readFile(join(DATA, f), 'utf8'));
const save = (f, o) => writeFile(join(DATA, f), JSON.stringify(o, null, 2) + '\n', 'utf8');

const its = await load('intents.json');
const ov = its.categories.find((c) => c.phase === 'overrides');
const add = (category, patterns) => {
  if (!ov.intents.some((i) => i.category === category)) ov.intents.push({ category, enabled: true, patterns });
};
// #7: deposit questions → pricing static reply (lists both deposits)
add('pricing', ["\\bdeposit\\b|\\bcagaran\\b|(订金|押金|訂金)"]);
// #38: modify an existing booking → booking_modification workflow
add('booking_modification', [
  "\\b(change|modify|move|postpone|reschedule)\\b[^.?!]{0,30}\\b(check[\\s-]?in|check[\\s-]?out|date|booking|reservation)\\b",
  "\\btukar\\s?(tarikh|tempahan)\\b|(改.{0,6}(日期|订单|预订))",
]);
// #21: question about what happens after booking → LLM answers from KB
add('booking_info_query', [
  "\\b(what|when|how)\\b[^.?!]{0,40}\\b(receive|get|happens?|confirmation)\\b[^.?!]{0,40}\\b(book|booking|reservation)\\b",
  "\\bafter\\s+booking\\b",
]);
await save('intents.json', its);

const r = await load('routing.json');
r.booking_info_query = { action: 'llm_reply' };
await save('routing.json', r);

const wl = await load('intent-whitelists.json');
if (!wl.pms_capsule.includes('booking_info_query')) wl.pms_capsule.push('booking_info_query');
await save('intent-whitelists.json', wl);

console.log('3 override intents added');
