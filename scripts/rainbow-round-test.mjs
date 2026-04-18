// Rainbow AI round-based test harness
// Usage: node scripts/rainbow-round-test.mjs --round 1
// Rounds 1..N each cover DIFFERENT scenarios; results saved to reports/round-tests/

import fs from 'node:fs/promises';
import path from 'node:path';

const PORT = process.env.PORT || 3002;
const BASE = `http://localhost:${PORT}`;
const ENDPOINT = `${BASE}/api/rainbow/preview/chat`;

const ROUNDS = {
  1: {
    label: 'Core Features — EN Baseline',
    scenarios: [
      { id: 'greeting-en',       message: 'Hi there!',                                           expectKeywords: ['rainbow', 'hello', 'hi', 'welcome'], expectLang: 'en' },
      { id: 'wifi-en',           message: 'What is the wifi password?',                         expectKeywords: ['pelangi', 'ilovestaycapsule', 'password', 'wifi'], expectLang: 'en' },
      { id: 'checkin-time-en',   message: 'What time can I check in?',                          expectKeywords: ['2', 'check'], expectLang: 'en' },
      { id: 'checkout-time-en',  message: 'What time is check out?',                            expectKeywords: ['11', '12', 'check'], expectLang: 'en' },
      { id: 'price-en',          message: 'How much for one night?',                            expectKeywords: ['rm', 'price', 'night'], expectLang: 'en' },
      { id: 'location-en',       message: 'Where is the hostel located?',                       expectKeywords: ['johor', 'bahru', 'jb', 'address', 'pelangi'], expectLang: 'en' },
      { id: 'amenities-en',      message: 'What amenities do you have?',                        expectKeywords: ['wifi', 'towel', 'air', 'breakfast', 'kitchen', 'amenit'], expectLang: 'en' },
      { id: 'booking-en',        message: 'Can I book a room for this Friday?',                 expectKeywords: ['book', 'room', 'available', 'friday'], expectLang: 'en' },
      { id: 'parking-en',        message: 'Do you have parking available?',                     expectKeywords: ['park'], expectLang: 'en' },
      { id: 'breakfast-en',      message: 'Is breakfast included?',                             expectKeywords: ['breakfast', 'include'], expectLang: 'en' },
    ],
  },
  2: {
    label: 'Multilingual — Malay + Chinese',
    scenarios: [
      { id: 'wifi-ms',           message: 'Apa password wifi?',                                 expectKeywords: ['pelangi', 'ilovestaycapsule', 'wifi'], expectLang: 'ms' },
      { id: 'harga-ms',          message: 'Berapa harga bilik satu malam?',                     expectKeywords: ['rm', 'malam', 'harga'], expectLang: 'ms' },
      { id: 'checkin-ms',        message: 'Pukul berapa boleh check in?',                       expectKeywords: ['2', 'pm', 'pukul', 'check'], expectLang: 'ms' },
      { id: 'terima-kasih-ms',   message: 'Terima kasih!',                                      expectKeywords: ['sama', 'welcome', 'kasih'], expectLang: 'ms' },
      { id: 'wifi-zh',           message: 'wifi密码是什么?',                                      expectKeywords: ['pelangi', 'ilovestaycapsule', '密码'], expectLang: 'zh' },
      { id: 'price-zh',          message: '一晚多少钱?',                                          expectKeywords: ['rm', '一晚', '块'], expectLang: 'zh' },
      { id: 'greeting-zh',       message: '你好',                                                expectKeywords: ['你好', '好', 'rainbow'], expectLang: 'zh' },
      { id: 'room-zh',           message: '有没有房间?',                                          expectKeywords: ['房', 'room', 'available'], expectLang: 'zh' },
      { id: 'mixed-1',           message: 'wifi password apa?',                                 expectKeywords: ['pelangi', 'ilovestaycapsule'], expectLang: null },
      { id: 'mixed-2',           message: 'nak book untuk 2 nights',                            expectKeywords: ['book', 'night', '2'], expectLang: null },
    ],
  },
  3: {
    label: 'Edge Cases — Problem Reports + Escalation',
    scenarios: [
      { id: 'complaint-ac',      message: 'The air conditioner in my room is broken',           expectKeywords: ['sorry', 'staff', 'help', 'fix'], expectLang: 'en' },
      { id: 'complaint-noise',   message: "It's too noisy next door, I can't sleep",            expectKeywords: ['sorry', 'staff', 'help'], expectLang: 'en' },
      { id: 'lost-item',         message: 'I lost my phone in the hostel',                      expectKeywords: ['sorry', 'staff', 'lost', 'help'], expectLang: 'en' },
      { id: 'refund',            message: 'I want a refund for my booking, please help',        expectKeywords: ['refund', 'staff', 'policy', 'booking', 'team', 'contact'], expectLang: 'en' },
      { id: 'emergency',         message: 'There is a fire!',                                   expectKeywords: ['staff', 'emergency', 'fire', '999'], expectLang: 'en' },
      { id: 'rude',              message: 'You are useless',                                    expectKeywords: ['sorry', 'help', 'understand'], expectLang: 'en' },
      { id: 'vague',             message: 'uh',                                                 expectKeywords: [], expectLang: null },
      { id: 'empty-like',        message: '?',                                                  expectKeywords: [], expectLang: null },
      { id: 'long-rant',         message: 'I am very unhappy with my stay because nothing is working and I want to speak to someone now', expectKeywords: ['sorry', 'staff'], expectLang: 'en' },
      { id: 'offtopic',          message: 'What is the weather in Tokyo?',                      expectKeywords: ['hostel', 'help', "can't", "don't have", 'connect', 'team', 'pelangi', 'assist'], expectLang: 'en' },
    ],
  },
  4: {
    label: 'Booking/Operational — MCP Dependent',
    scenarios: [
      { id: 'availability-today',  message: 'Any availability tonight?',                         expectKeywords: ['available', 'room', 'tonight'], expectLang: 'en' },
      { id: 'availability-weekend',message: 'Do you have rooms this weekend?',                   expectKeywords: ['available', 'room', 'weekend'], expectLang: 'en' },
      { id: 'cancel-booking',      message: 'How do I cancel my booking?',                       expectKeywords: ['cancel', 'booking', 'policy'], expectLang: 'en' },
      { id: 'extend-stay',         message: 'I want to extend my stay by one more night',        expectKeywords: ['extend', 'stay', 'help'], expectLang: 'en' },
      { id: 'early-checkin',       message: 'Can I do early check-in at 10am?',                  expectKeywords: ['early', 'check', '2'], expectLang: 'en' },
      { id: 'late-checkout',       message: 'Can I check out late at 2pm?',                      expectKeywords: ['late', 'check'], expectLang: 'en' },
      { id: 'group-booking',       message: 'We are 6 people, any discount for group?',          expectKeywords: ['group', 'discount', 'booking'], expectLang: 'en' },
      { id: 'long-stay',           message: 'Monthly rate for 30 nights stay?',                  expectKeywords: ['monthly', 'long', 'stay', 'rate'], expectLang: 'en' },
      { id: 'family-room',         message: 'Do you have family rooms for 2 adults and 1 kid?',  expectKeywords: ['family', 'room', 'kid', 'child'], expectLang: 'en' },
      { id: 'pay-on-arrival',      message: 'Can I pay on arrival?',                             expectKeywords: ['pay', 'arrival', 'book'], expectLang: 'en' },
    ],
  },
};

function pickRound(n) {
  const r = ROUNDS[n];
  if (!r) throw new Error(`Round ${n} not defined`);
  return r;
}

async function callChat(message) {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const elapsed = Date.now() - t0;
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, elapsed };
}

function validate(res, scenario) {
  const problems = [];
  if (res.status !== 200) problems.push(`HTTP ${res.status}`);
  const msg = (res.body?.message || '').toLowerCase();
  if (!msg) problems.push('empty response');
  if (scenario.expectKeywords?.length) {
    const hit = scenario.expectKeywords.some((k) => msg.includes(k.toLowerCase()));
    if (!hit) problems.push(`missing any of keywords: ${scenario.expectKeywords.join(', ')}`);
  }
  if (scenario.expectLang && res.body?.detectedLanguage && res.body.detectedLanguage !== scenario.expectLang) {
    problems.push(`lang mismatch: got ${res.body.detectedLanguage}, want ${scenario.expectLang}`);
  }
  if (res.elapsed > 20000) problems.push(`slow (${res.elapsed}ms)`);
  return { pass: problems.length === 0, problems };
}

async function main() {
  const roundArg = process.argv.indexOf('--round');
  const roundNum = roundArg >= 0 ? Number(process.argv[roundArg + 1]) : 1;
  const round = pickRound(roundNum);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const results = [];
  console.log(`\n▸ Rainbow Round ${roundNum} — ${round.label}\n▸ Endpoint: ${ENDPOINT}\n`);

  for (const s of round.scenarios) {
    try {
      const r = await callChat(s.message);
      const v = validate(r, s);
      const status = v.pass ? 'PASS' : 'FAIL';
      results.push({
        id: s.id, status, elapsed: r.elapsed,
        message: s.message,
        reply: r.body?.message,
        intent: r.body?.intent,
        source: r.body?.source,
        tier: r.body?.tier,
        lang: r.body?.detectedLanguage,
        model: r.body?.model,
        problems: v.problems,
      });
      console.log(`${status} ${s.id.padEnd(20)} ${r.elapsed}ms  ${v.problems.join('; ') || '✓'}`);
    } catch (err) {
      results.push({ id: s.id, status: 'ERROR', error: String(err?.message || err) });
      console.log(`ERR  ${s.id.padEnd(20)} ${err?.message || err}`);
    }
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const total = results.length;
  const pct = total ? Math.round((passed / total) * 100) : 0;
  console.log(`\nRound ${roundNum} summary: ${passed}/${total} passed (${pct}%)`);

  const outDir = path.join(process.cwd(), 'reports', 'round-tests');
  await fs.mkdir(outDir, { recursive: true });
  const out = path.join(outDir, `round-${roundNum}-${ts}.json`);
  await fs.writeFile(out, JSON.stringify({ round: roundNum, label: round.label, ts, passed, total, pct, results }, null, 2));
  console.log(`→ Saved: ${out}`);

  // exit 0 regardless so orchestrator can continue; caller inspects JSON
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
