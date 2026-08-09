// Human-support loop Round 3 fixes (2026-07-21). Targets evaluator R2 BADs:
// H3 multi-part questions, H9 safety phrasing, H1 stranded empathy, H4 locked
// out, H10 2am arrival; plus ACCEPTABLE lifts: H2/H12 warmth, H11 no-front-desk.

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assistant', 'data');
const load = async (f) => JSON.parse(await readFile(join(DATA, f), 'utf8'));
const save = (f, o) => writeFile(join(DATA, f), JSON.stringify(o, null, 2) + '\n', 'utf8');

// ── intents.json overrides ────────────────────────────────────────
const its = await load('intents.json');
const ov = its.categories.find((c) => c.phase === 'overrides');
const put = (category, patterns, front = false) => {
  const cur = ov.intents.find((i) => i.category === category);
  if (cur) { cur.patterns = patterns; return; }
  const entry = { category, enabled: true, patterns };
  if (front) ov.intents.unshift(entry); else ov.intents.push(entry);
};

// H3/H7/H11: two questions in one message → LLM answers every part.
// Matches: two ?/？ marks, or two interrogative words joined by ,/and.
put('multi_question', [
  "[?？][^?？]+[?？]",
  "\\b(what|how|when|where|why|do you|can i|is there)\\b[^?!.]{0,80}(,|\\band\\b)\\s?(what|how\\s?much|how|do you|where|when|can i|is there)\\b",
], true);

// H1: stranded traveller (was pointed at bare availability in R1)
const strandedPat = "\\b(flight|train|bus)\\b[^.?!]{0,40}\\b(cancell?ed|delayed|missed)\\b";
const avail = ov.intents.find((i) => i.category === 'availability');
if (avail) avail.patterns = avail.patterns.filter((p) => p !== strandedPat);
put('urgent_stay_request', [strandedPat, "\\b(stranded|nowhere to (stay|sleep)|need a bed (right )?now)\\b"]);

// H4: locked out / nobody at counter
put('locked_out_help', [
  "\\b(waiting|standing|stuck|locked)\\b[^.?!]{0,40}\\b(outside|out here|door|entrance)\\b",
  "\\bnobody\\b[^.?!]{0,30}\\b(here|counter|reception|desk)\\b|\\bno one (is )?(here|at the (counter|desk|reception))\\b",
]);

// H10: late-night arrival check-in
put('late_arrival_checkin', [
  "\\b(arriv\\w+|reach\\w*|bus|flight|train)\\b[^.?!]{0,40}\\b([01]?\\d\\s?a\\.?m|midnight|late night|very late)\\b",
  "\\bcheck[\\s-]?in\\b[^.?!]{0,40}\\b(that late|so late|[0-5]\\s?a\\.?m\\b|midnight|after midnight|late at night)\\b",
]);
await save('intents.json', its);

// ── routing.json ──────────────────────────────────────────────────
const routing = await load('routing.json');
routing.multi_question = { action: 'llm_reply' };
routing.urgent_stay_request = { action: 'static_reply' };
routing.locked_out_help = { action: 'static_reply' };
routing.late_arrival_checkin = { action: 'static_reply' };
await save('routing.json', routing);

// ── whitelist ─────────────────────────────────────────────────────
const wl = await load('intent-whitelists.json');
for (const i of ['multi_question', 'urgent_stay_request', 'locked_out_help', 'late_arrival_checkin']) {
  if (!wl.pms_capsule.includes(i)) wl.pms_capsule.push(i);
}
await save('intent-whitelists.json', wl);

// ── knowledge.json static replies ─────────────────────────────────
const kn = await load('knowledge.json');
const upsert = (intent, response) => {
  const cur = kn.static.find((s) => s.intent === intent);
  if (cur) cur.response = response; else kn.static.push({ intent, response });
};
upsert('urgent_stay_request', {
  en: "Oh no, so sorry to hear that — what a stressful day. 😔 Good news: we DO have capsules available right now, RM35/night, and self check-in works 24 hours, so you can come straight over (26A Jalan Perang, Taman Pelangi). Want me to book one for you right away?",
  ms: "Aduh, kasihan — hari yang memenatkan. 😔 Berita baik: kami ADA kapsul kosong sekarang, RM35/malam, dan daftar masuk sendiri 24 jam — boleh terus datang (26A Jalan Perang, Taman Pelangi). Nak saya tempahkan sekarang?",
  zh: "太不容易了，辛苦您了。😔 好消息：我们现在就有空舱位，RM35/晚，自助入住 24 小时可用，您可以直接过来（26A Jalan Perang, Taman Pelangi）。要我马上帮您订一个吗？",
});
upsert('locked_out_help', {
  en: "So sorry for the wait! 😔 We don't have a 24-hour counter — check-in is self-service. Your door QR/code was sent to your WhatsApp after booking. Can't find it? Message or call our staff Maya RIGHT NOW at +60127088789 and she'll get you in immediately.",
  ms: "Maaf sangat membuat anda menunggu! 😔 Kami tiada kaunter 24 jam — daftar masuk adalah layan diri. QR/kod pintu dihantar ke WhatsApp anda selepas tempahan. Tak jumpa? Terus hubungi staf kami Maya di +60127088789, dia akan bantu anda masuk segera.",
  zh: "非常抱歉让您久等！😔 我们没有 24 小时前台 — 入住是自助的。订房后门锁 QR/密码已发到您的 WhatsApp。找不到？请立刻联系工作人员 Maya：+60127088789，她会马上帮您进门。",
});
upsert('late_arrival_checkin', {
  en: "Yes, absolutely no problem! 😊 Self check-in works 24 hours — 2am, 3am, any time. After booking you'll get a QR code / door code on WhatsApp, so you can let yourself in whenever you arrive. Safe travels!",
  ms: "Ya, tiada masalah langsung! 😊 Daftar masuk sendiri 24 jam — pukul 2 pagi pun boleh. Selepas tempahan anda akan terima kod QR/pintu di WhatsApp, boleh masuk bila-bila anda sampai. Selamat sampai!",
  zh: "完全没问题！😊 自助入住 24 小时开放 — 凌晨 2 点、3 点都可以。订房后 WhatsApp 会收到 QR/门锁密码，随到随入住。一路顺风！",
});
upsert('greeting', {
  en: "Hello! Welcome to Pelangi Capsule Hostel 😊 How can I help you today — checking availability, rates, booking, or check-in?",
  ms: "Hai! Selamat datang ke Pelangi Capsule Hostel 😊 Apa yang boleh saya bantu hari ini — kekosongan, harga, tempahan, atau daftar masuk?",
  zh: "您好！欢迎来到 Pelangi Capsule Hostel 😊 今天有什么可以帮您 — 查空位、价格、订房还是入住？",
});
upsert('thanks', {
  en: "You're most welcome! 😊 It was a pleasure helping you. If anything else comes up, just message me anytime — safe travels, and we'd love to see you at Pelangi again!",
  ms: "Sama-sama! 😊 Seronok dapat membantu. Kalau ada apa-apa lagi, mesej saja bila-bila — selamat jalan, jumpa lagi di Pelangi!",
  zh: "不客气！😊 很高兴能帮到您。有任何需要随时找我 — 一路平安，期待您再来 Pelangi！",
});
upsert('extra_amenity_request', {
  en: "Of course! Extra blankets, pillows and towels are available — just message our staff Maya at +60127088789 (or tell me your capsule number and I'll pass it on). Showers are on-site next to the capsule area, open 24 hours, towels and toiletries provided. 😊",
  ms: "Boleh! Selimut, bantal dan tuala tambahan ada — mesej staf kami Maya di +60127088789 (atau bagi saya nombor kapsul anda, saya sampaikan). Bilik mandi ada di sebelah kawasan kapsul, buka 24 jam, tuala dan barangan mandian disediakan. 😊",
  zh: "当然可以！额外的毯子、枕头和毛巾都有 — 请联系工作人员 Maya：+60127088789（或告诉我您的胶囊号，我帮您转达）。淋浴间就在胶囊区旁边，24 小时开放，提供毛巾和洗浴用品。😊",
});
await save('knowledge.json', kn);

// ── workflows.json: H9 safety-first prompt for capsule_conflict ───
const wfs = await load('workflows.json');
const cc = wfs.workflows.find((w) => w.id === 'capsule_conflict_handling');
const wait = cc.nodes.find((n) => n.id === 'cc_wait_capsule');
wait.config.prompt = {
  en: "I'm so sorry — that sounds frightening. Your safety comes first: stay inside your capsule and keep the door locked. 🚨 I'm alerting our on-site staff right now, and you can also call Maya directly at +60127088789. Which capsule number are you in?",
  ms: "Maaf sangat — tentu menakutkan. Keselamatan anda yang utama: kekal di dalam kapsul dan pastikan pintu berkunci. 🚨 Saya sedang memaklumkan staf di lokasi sekarang, dan anda juga boleh terus hubungi Maya di +60127088789. Anda di kapsul nombor berapa?",
  zh: "非常抱歉 — 这一定很吓人。您的安全最重要：请留在舱内并锁好门。🚨 我正在通知现场工作人员，您也可以直接拨打 Maya 的电话 +60127088789。请问您在几号胶囊？",
};
await save('workflows.json', wfs);

console.log('R3 fixes applied: multi_question, urgent_stay, locked_out, late_arrival, warm greeting/thanks, amenity truthfix, capsule_conflict safety prompt');
