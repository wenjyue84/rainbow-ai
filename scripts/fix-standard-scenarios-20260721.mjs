// One-shot data fix for the 2026-07-21 standard-scenarios eval defects.
// Edits: intents.json (override phase + pattern widening), knowledge.json
// (tourism_tax + found_item_report static replies), routing.json (new intents +
// MAINTENANCE_ISSUE reroute), intent-whitelists.json (pms_capsule additions).
// Backups already taken as *.bak-20260721-scenariofix. Idempotent.

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assistant', 'data');
const load = async (f) => JSON.parse(await readFile(join(DATA, f), 'utf8'));
const save = (f, o) => writeFile(join(DATA, f), JSON.stringify(o, null, 2) + '\n', 'utf8');

// ── intents.json ──────────────────────────────────────────────────
const intents = await load('intents.json');

if (!intents.categories.some((c) => c.phase === 'overrides')) {
  intents.categories.unshift({
    phase: 'overrides',
    description:
      'High-specificity patterns that must win before generic pricing/payment/amenity intents (2026-07-21 standard-scenarios fixes). T1 is first-match-wins, so these sit at the top.',
    intents: [
      {
        category: 'tourism_tax',
        enabled: true,
        patterns: [
          "\\b(tourism|tourist|heritage)\\s?tax\\b|cukai\\s?(pelancongan|pelancong)",
          "(旅游税|旅遊稅)",
        ],
      },
      {
        category: 'found_item_report',
        enabled: true,
        patterns: [
          "\\bfound\\s+(a|an|someone|somebody|this)\\b[^.?!]{0,60}\\b(wallet|purse|phone|watch|passport|key|card|bag|item|charger)\\b",
          "\\b(wallet|purse|phone|watch|passport|bag)\\b[^.?!]{0,30}\\bnot\\s?mine\\b",
          "(捡到|撿到|拾到)",
        ],
      },
      {
        category: 'forgot_item_post_checkout',
        enabled: true,
        patterns: [
          "\\b(left|forgot)\\s?(my|a|an|behind)\\b[^.?!]{0,40}\\b(charger|phone|wallet|passport|watch|bag|clothes|shirt|adapter|powerbank|laptop|earphones?|glasses|keys?)\\b",
          "\\b(left|forgot)\\s?(my|something)\\b[^.?!]{0,40}\\b(in|at)\\s?(my\\s|the\\s)?(capsule|room|locker|hostel)\\b",
          "\\btertinggal\\b",
          "(忘了拿|落在|遗留|遺留)",
        ],
      },
      {
        category: 'late_checkout_request',
        enabled: true,
        patterns: [
          "\\bcheck[\\s-]?out\\b[^.?!]{0,25}\\b(at\\s?)?([1-9]|1[0-2])\\s?[ap]\\.?m\\.?\\b",
          "\\bcheck[\\s-]?out\\s?(late|later)\\b|\\blate\\s?check[\\s-]?out\\b|\\bcheck\\s?out\\s?lambat\\b",
          "(晚退房|延迟退房|退房晚|晚点退房)",
        ],
      },
    ],
  });
}

for (const c of intents.categories) {
  for (const it of c.intents || []) {
    if (it.category === 'group_booking') {
      it.patterns = it.patterns.map((p) =>
        p
          .replace('people|persons?|pax|ppl|guests?|of us|adults?|orang', 'people|persons?|pax|ppl|guests?|of us|adults?|orang|friends?|kawan')
      );
    }
    if (it.category === 'climate_control_complaint' && c.phase !== 'overrides') {
      const extra =
        "\\b(ac|aircon\\w*|air\\s?cond\\w*|air[- ]?con)\\b[^.?!]{0,40}\\b(not\\s?(cold|cool|cooling|working)|too\\s?hot|very\\s?hot|tak\\s?sejuk|panas)\\b";
      const zh = "(空调|冷气)[^。？!]{0,20}(不冷|不凉|不制冷|坏了|不行)";
      if (!it.patterns.includes(extra)) it.patterns.push(extra, zh);
    }
  }
}
await save('intents.json', intents);

// ── knowledge.json ────────────────────────────────────────────────
const kn = await load('knowledge.json');
const upsert = (intent, response) => {
  const cur = kn.static.find((s) => s.intent === intent);
  if (cur) cur.response = response;
  else kn.static.push({ intent, response });
};
upsert('tourism_tax', {
  en: "🏷️ *Tourism Tax*\n\nRM10 per room per night — applies to *foreign tourists only*. Malaysians and permanent residents are exempt. It's collected at check-in. — Rainbow 🌈",
  ms: "🏷️ *Cukai Pelancongan*\n\nRM10 satu bilik satu malam — untuk *pelancong asing sahaja*. Warganegara Malaysia dan penduduk tetap dikecualikan. Dikutip semasa daftar masuk. — Rainbow 🌈",
  zh: "🏷️ *旅游税*\n\n每房每晚 RM10 — *只适用于外国游客*。马来西亚公民与永久居民免缴，入住时收取。— Rainbow 🌈",
});
upsert('found_item_report', {
  en: "Thank you for your honesty! 🙏 Please hand the item to our staff at the reception counter (26A Jalan Perang). If no staff is around, keep it safe for now and message Maya at +60127088789 — we'll take it from there. — Rainbow 🌈",
  ms: "Terima kasih atas kejujuran anda! 🙏 Sila serahkan barang itu kepada staf kami di kaunter penyambut tetamu (26A Jalan Perang). Jika tiada staf, simpan dulu dengan selamat dan hubungi Maya di +60127088789. — Rainbow 🌈",
  zh: "谢谢您的诚实！🙏 请把物品交给前台工作人员（26A Jalan Perang）。如果前台没有人，请先妥善保管并联系 Maya（+60127088789），我们会处理。— Rainbow 🌈",
});
await save('knowledge.json', kn);

// ── routing.json ──────────────────────────────────────────────────
const routing = await load('routing.json');
routing.tourism_tax = { action: 'static_reply' };
routing.found_item_report = { action: 'static_reply' };
// MAINTENANCE_ISSUE = a fault report, not an amenity request → complaint flow
// (apology + maintenance/relocate/staff support + escalation), per Jay's rule
// that facility faults must escalate.
routing.MAINTENANCE_ISSUE = { action: 'workflow', workflow_id: 'complaint_handling' };
await save('routing.json', routing);

// ── intent-whitelists.json ────────────────────────────────────────
const wl = await load('intent-whitelists.json');
for (const intent of ['tourism_tax', 'found_item_report']) {
  if (!wl.pms_capsule.includes(intent)) wl.pms_capsule.push(intent);
}
await save('intent-whitelists.json', wl);

console.log('done: intents.json, knowledge.json, routing.json, intent-whitelists.json');
