// Human-support loop R4 (final text pass, 2026-07-21). Evaluator R3 leftovers:
// H7 availability reply lacks the nightly rate; H8 escalate wording (claim is
// actually TRUE — escalate_notify_admin does whatsapp_send — but empathy was
// missing); H11 amenity double-ask fell into multi_question→LLM which invented
// shower locations — give it the accurate static instead.

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assistant', 'data');
const load = async (f) => JSON.parse(await readFile(join(DATA, f), 'utf8'));
const save = (f, o) => writeFile(join(DATA, f), JSON.stringify(o, null, 2) + '\n', 'utf8');

// ── workflows.json ────────────────────────────────────────────────
const wfs = await load('workflows.json');

const av = wfs.workflows.find((w) => w.id === 'availability_check');
const yes = av.nodes.find((n) => n.id === 'av_reply_yes');
yes.config.message = {
  en: '✅ Yes — we have {{workflow.data.available_count}} capsule(s) available right now, at a flat *RM35/night*. Would you like to book one? 😊',
  ms: '✅ Ya — kami ada {{workflow.data.available_count}} kapsul kosong sekarang, harga tetap *RM35/malam*. Nak tempah satu? 😊',
  zh: '✅ 有的 — 我们现在有 {{workflow.data.available_count}} 个空舱位，统一价 *RM35/晚*。要帮您预订一个吗？😊',
};

const esc = wfs.workflows.find((w) => w.id === 'escalate');
const escMsg = esc.nodes.find((n) => n.id === 'escalate_msg');
escMsg.config.message = {
  en: "I'm really sorry about this — I understand it's frustrating. Let me connect you to our staff right away. 🙏",
  ms: 'Saya benar-benar minta maaf — saya faham ini menyusahkan. Saya hubungkan anda dengan staf kami sekarang. 🙏',
  zh: '非常抱歉给您带来困扰 — 我马上为您联系我们的工作人员。🙏',
};
const escConfirm = esc.nodes.find((n) => n.id === 'escalate_confirm_msg');
escConfirm.config.message = {
  en: '✅ Our staff have been notified and will get back to you shortly. If it involves a payment, please keep your receipts/screenshots handy — it speeds things up. You can also reach Maya directly at +60127088789.',
  ms: '✅ Staf kami telah dimaklumkan dan akan menghubungi anda tidak lama lagi. Jika melibatkan bayaran, sila sediakan resit/tangkapan skrin — ia mempercepatkan urusan. Anda juga boleh terus hubungi Maya di +60127088789.',
  zh: '✅ 我们的工作人员已收到通知，会尽快回复您。如涉及付款，请准备好收据/截图，能加快处理。您也可以直接联系 Maya：+60127088789。',
};
await save('workflows.json', wfs);

// ── intents.json: amenity double-ask beats multi_question ─────────
const its = await load('intents.json');
const ov = its.categories.find((c) => c.phase === 'overrides');
const mqIdx = ov.intents.findIndex((i) => i.category === 'multi_question');
const amenityPat = {
  category: 'extra_amenity_request',
  enabled: true,
  patterns: [
    "\\b(blanket|towel|pillow|toiletries)\\b[^!.]{0,80}\\b(shower|bathroom|toilet|wash)\\b",
    "\\b(extra|another|more)\\s+(blanket|towel|pillow)s?\\b",
  ],
};
if (!ov.intents.some((i) => i.category === 'extra_amenity_request')) {
  ov.intents.splice(mqIdx, 0, amenityPat); // before multi_question
}
await save('intents.json', its);

console.log('R4 applied: availability price, escalate empathy, amenity override');
