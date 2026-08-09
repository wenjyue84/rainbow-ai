// Human-support loop Round 1 fixes (2026-07-21):
// A. capsule_conflict_handling: steps-only format → nodes (go-core only executes
//    nodes; the steps format produced an EMPTY reply to a scared guest, H9).
// B. intents.json overrides: stranded traveller → availability; double-charge /
//    refund → billing_dispute; upgrade ask + booking-lookup → llm_reply intents.
// C. cancel_booking noun list: drop "bed" ("flight got cancelled and I need a
//    bed" hijacked into the cancel flow, H1).
// D. routing + whitelist for the two new llm intents.

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assistant', 'data');
const load = async (f) => JSON.parse(await readFile(join(DATA, f), 'utf8'));
const save = (f, o) => writeFile(join(DATA, f), JSON.stringify(o, null, 2) + '\n', 'utf8');

// ── A. workflows.json: convert capsule_conflict_handling to nodes ─
const wfs = await load('workflows.json');
const cc = wfs.workflows.find((w) => w.id === 'capsule_conflict_handling');
if (cc && (!cc.nodes || cc.nodes.length === 0)) {
  const s = Object.fromEntries(cc.steps.map((x) => [x.id, x]));
  cc.startNodeId = 'cc_wait_capsule';
  cc.nodes = [
    { id: 'cc_wait_capsule', type: 'wait_reply', config: { storeAs: 'capsule_number', prompt: s.s1.message }, next: 'cc_ack_msg' },
    { id: 'cc_ack_msg', type: 'message', config: { message: s.s2.message }, next: 'cc_notify_staff' },
    {
      id: 'cc_notify_staff', type: 'whatsapp_send', config: {
        receiver: '{{system.admin_phone}}',
        content: {
          en: '🚨 *Capsule Conflict / Security*\nGuest: {{guest.name}}\nPhone: {{guest.phone}}\nCapsule: {{workflow.data.capsule_number}}\nGuest reports someone in/at their capsule. Please attend NOW and resolve (move the other person or reassign).',
          ms: '🚨 *Konflik Kapsul / Keselamatan*\nTetamu: {{guest.name}}\nTelefon: {{guest.phone}}\nKapsul: {{workflow.data.capsule_number}}\nTetamu melaporkan ada orang di kapsul mereka. Sila hadir SEKARANG dan selesaikan.',
          zh: '🚨 *胶囊冲突/安全*\n客人：{{guest.name}}\n电话：{{guest.phone}}\n胶囊：{{workflow.data.capsule_number}}\n客人报告有人在其胶囊处。请立即到场处理。',
        },
        urgency: 'high',
      }, next: 'cc_wait_state',
    },
    { id: 'cc_wait_state', type: 'wait_reply', config: { storeAs: 'occupant_state', prompt: s.s3.message }, next: 'cc_final_msg' },
    { id: 'cc_final_msg', type: 'message', config: { message: s.s4.message }, next: null },
  ];
  delete cc.steps;
}
await save('workflows.json', wfs);

// ── B+C. intents.json ─────────────────────────────────────────────
const its = await load('intents.json');
const ov = its.categories.find((c) => c.phase === 'overrides');
const add = (category, patterns) => {
  const cur = ov.intents.find((i) => i.category === category);
  if (cur) { for (const p of patterns) if (!cur.patterns.includes(p)) cur.patterns.push(p); }
  else ov.intents.push({ category, enabled: true, patterns });
};
// stranded traveller needs a bed NOW → availability, not cancel flow
add('availability', ["\\b(flight|train|bus)\\b[^.?!]{0,40}\\b(cancell?ed|delayed|missed)\\b"]);
// double-charge / refund demand → billing_dispute (escalate workflow)
add('billing_dispute', [
  "\\b(paid|charged|payment|money)\\b[^.?!]{0,40}\\b(twice|double|two\\s?times)\\b",
  "\\brefund\\b|\\bmoney\\s?back\\b|\\bcaj\\s?dua\\s?kali\\b|(退款|重复收费|扣了两次)",
]);
// upgrade ask → honest LLM answer, not the booking flow
add('upgrade_request', ["\\bupgrade\\b[^.?!]{0,30}\\b(room|free|hotel)\\b|\\bfree\\s?upgrade\\b"]);
// "not sure if I booked here / how do I check my booking" → LLM guidance
add('booking_lookup_query', [
  "\\b(not\\s?sure|how\\s?(do|can)\\s?i\\s?(check|confirm|verify)|did\\s?i)\\b[^.?!]{0,50}\\b(book(ed|ing)?|reservation)\\b",
  "\\bbook(ed|ing)?\\b[^.?!]{0,50}\\b(not\\s?sure|which\\s?hostel|check\\s?if)\\b",
]);
// drop "bed" from cancel_booking noun list (H1 hijack)
for (const c of its.categories) {
  if (c.phase === 'overrides') continue;
  for (const it of c.intents || []) {
    if (it.category === 'cancel_booking') {
      it.patterns = it.patterns.map((p) => p.replace('|room|stay|bed|capsule', '|room|stay|capsule'));
    }
  }
}
await save('intents.json', its);

// ── D. routing + whitelist ────────────────────────────────────────
const routing = await load('routing.json');
routing.upgrade_request = { action: 'llm_reply' };
routing.booking_lookup_query = { action: 'llm_reply' };
await save('routing.json', routing);

const wl = await load('intent-whitelists.json');
for (const i of ['upgrade_request', 'booking_lookup_query']) {
  if (!wl.pms_capsule.includes(i)) wl.pms_capsule.push(i);
}
await save('intent-whitelists.json', wl);

console.log('R1 fixes applied: capsule_conflict nodes, stranded/refund/upgrade/lookup patterns, cancel-bed removed');
