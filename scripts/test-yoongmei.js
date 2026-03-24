#!/usr/bin/env node
/**
 * test-yoongmei.js — Yoong Mei Transport Chat Tester
 * Tests Rainbow AI's yoongmei profile across EN/MS/ZH and various intents.
 * Usage: node scripts/test-yoongmei.js
 */

import crypto from 'crypto';

const BASE = 'http://localhost:3002';
const PROFILE = 'yoongmei';
const SESSION_ID = 'test_' + crypto.randomUUID().slice(0, 8);

const SCENARIOS = [
  // ── Greetings ──────────────────────────────────────────────────────────────
  { id: 'greet-en',      cat: 'GREETING',       lang: 'en', msg: 'Hello!' },
  { id: 'greet-ms',      cat: 'GREETING',       lang: 'ms', msg: 'Selamat pagi' },
  { id: 'greet-zh',      cat: 'GREETING',       lang: 'zh', msg: '你好！' },

  // ── Transport / Pricing ────────────────────────────────────────────────────
  { id: 'quote-en',      cat: 'QUOTE',          lang: 'en', msg: 'I want to ship 5 pallets from Nilai to Penang. Can I get a quote?' },
  { id: 'quote-ms',      cat: 'QUOTE',          lang: 'ms', msg: 'Boleh tolong bagi harga untuk hantar barang dari Nilai ke Johor Bahru?' },
  { id: 'quote-zh',      cat: 'QUOTE',          lang: 'zh', msg: '我想从Nilai运货到吉隆坡，请问价格是多少？' },
  { id: 'price-kg',      cat: 'PRICING',        lang: 'en', msg: 'What is the rate per pallet to Selangor?' },
  { id: 'price-ms',      cat: 'PRICING',        lang: 'ms', msg: 'Berapa harga untuk 1 pallet ke Melaka?' },
  { id: 'price-sg',      cat: 'PRICING',        lang: 'en', msg: 'How much to ship to Singapore?' },

  // ── Services ───────────────────────────────────────────────────────────────
  { id: 'lcl-fcl',       cat: 'SERVICES',       lang: 'en', msg: 'What is the difference between LCL and FCL?' },
  { id: 'lorry-size',    cat: 'SERVICES',       lang: 'en', msg: 'What lorry sizes do you have?' },
  { id: 'cross-border',  cat: 'SERVICES',       lang: 'en', msg: 'Do you do cross-border shipments to Thailand?' },
  { id: 'min-shipment',  cat: 'SERVICES',       lang: 'ms', msg: 'Berapa minimum kuantiti yang boleh dihantar?' },
  { id: 'console-svc',   cat: 'SERVICES',       lang: 'en', msg: 'What is a Console service?' },
  { id: 'hazmat',        cat: 'SERVICES',       lang: 'en', msg: 'Can you transport hazardous materials?' },

  // ── Company Info / Operations ───────────────────────────────────────────────
  { id: 'contact',       cat: 'COMPANY',        lang: 'en', msg: 'How do I contact Yoong Mei?' },
  { id: 'hours',         cat: 'COMPANY',        lang: 'en', msg: 'What are your business hours?' },
  { id: 'track',         cat: 'COMPANY',        lang: 'en', msg: 'How do I track my shipment?' },
  { id: 'transit-jb',    cat: 'COMPANY',        lang: 'en', msg: 'How long does delivery to Johor Bahru take?' },
  { id: 'transit-ipoh',  cat: 'COMPANY',        lang: 'ms', msg: 'Berapa hari untuk sampai ke Ipoh?' },

  // ── False-positive guard ───────────────────────────────────────────────────
  { id: 'tolong-fp',     cat: 'REGRESSION',     lang: 'ms', msg: 'Boleh tolong quote untuk hantar barang dari Penang ke KL?',
    mustNotContain: ['URGENT', 'emergency', 'notified staff'] },
  { id: 'pukul-fp',      cat: 'REGRESSION',     lang: 'ms', msg: 'Pukul berapa korang operate?',
    mustNotContain: ['URGENT', 'emergency'] },

  // ── Emergency detection ────────────────────────────────────────────────────
  { id: 'emergency-en',  cat: 'EMERGENCY',      lang: 'en', msg: 'SOS! My driver has been in an accident on the highway!' },
  { id: 'theft-en',      cat: 'EMERGENCY',      lang: 'en', msg: 'My cargo was stolen!' },
  { id: 'theft-ms',      cat: 'EMERGENCY',      lang: 'ms', msg: 'Barang saya dicuri!' },

  // ── Escalation ─────────────────────────────────────────────────────────────
  { id: 'complaint',     cat: 'ESCALATION',     lang: 'en', msg: 'I want to make a complaint about damaged goods.' },
  { id: 'human',         cat: 'ESCALATION',     lang: 'en', msg: 'Can I speak to a human agent?' },

  // ── Out-of-scope ───────────────────────────────────────────────────────────
  { id: 'oos-hotel',     cat: 'OUT_OF_SCOPE',   lang: 'en', msg: 'Do you have hotel rooms?' },
  { id: 'oos-food',      cat: 'OUT_OF_SCOPE',   lang: 'en', msg: 'What food do you serve?' },

  // ── Thanks ─────────────────────────────────────────────────────────────────
  { id: 'thanks-en',     cat: 'THANKS',         lang: 'en', msg: 'Thank you!' },
  { id: 'thanks-ms',     cat: 'THANKS',         lang: 'ms', msg: 'Terima kasih!' },
  { id: 'thanks-zh',     cat: 'THANKS',         lang: 'zh', msg: '谢谢你！' },
];

async function sendMessage(msg, sessionId) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat/${PROFILE}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, sessionId }),
  });
  const elapsed = Date.now() - t0;
  if (!res.ok) return { reply: null, elapsed, error: `HTTP ${res.status}` };
  const json = await res.json();
  return { reply: json.reply || json.message || JSON.stringify(json), elapsed };
}

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';

function truncate(s, n = 120) {
  if (!s) return '(empty)';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function main() {
  console.log(`\n${CYAN}═══ Yoong Mei Chat Test — ${new Date().toLocaleTimeString()} ═══${RESET}`);
  console.log(`${DIM}Profile: ${PROFILE} | Session: ${SESSION_ID} | Tests: ${SCENARIOS.length}${RESET}\n`);

  const results = { pass: 0, warn: 0, fail: 0 };
  const failures = [];

  // Run sequentially to avoid rate-limit (10/min)
  for (const s of SCENARIOS) {
    const sid = `test_${s.id}_${Date.now()}`;  // fresh session per test
    const { reply, elapsed, error } = await sendMessage(s.msg, sid);

    let status = 'PASS';
    let reason = '';

    if (error || !reply) {
      status = 'FAIL'; reason = error || 'empty reply';
    } else if (s.mustNotContain && s.mustNotContain.some(kw => reply.toLowerCase().includes(kw.toLowerCase()))) {
      status = 'FAIL'; reason = `false-positive: reply contains forbidden keyword`;
    } else if (elapsed > 15000) {
      status = 'FAIL'; reason = `timeout (${elapsed}ms)`;
    } else if (elapsed > 8000) {
      status = 'WARN'; reason = `slow (${elapsed}ms)`;
    }

    const icon = status === 'PASS' ? `${GREEN}✓${RESET}` : status === 'WARN' ? `${YELLOW}⚠${RESET}` : `${RED}✗${RESET}`;
    const timeColor = elapsed > 8000 ? YELLOW : DIM;
    console.log(`${icon} [${s.cat.padEnd(12)}] ${s.id.padEnd(14)} ${DIM}(${s.lang})${RESET} ${timeColor}${elapsed}ms${RESET}`);
    console.log(`  ${DIM}Q: ${s.msg}${RESET}`);
    console.log(`  A: ${truncate(reply)}`);
    if (reason) console.log(`  ${RED}⚠ ${reason}${RESET}`);
    console.log();

    if (status === 'PASS') results.pass++;
    else if (status === 'WARN') { results.warn++; }
    else { results.fail++; failures.push({ id: s.id, reason, reply }); }

    // Rate limit: 10 req/min per IP = 6s minimum. Use 7s for safety.
    await new Promise(r => setTimeout(r, 7000));
  }

  const total = SCENARIOS.length;
  const pct = Math.round((results.pass / total) * 100);
  const summaryColor = results.fail > 0 ? RED : results.warn > 0 ? YELLOW : GREEN;

  console.log(`${CYAN}═══ Summary ═══${RESET}`);
  console.log(`${summaryColor}Pass: ${results.pass}/${total} (${pct}%) | Warn: ${results.warn} | Fail: ${results.fail}${RESET}`);

  if (failures.length > 0) {
    console.log(`\n${RED}Failures:${RESET}`);
    for (const f of failures) {
      console.log(`  ${RED}✗ ${f.id}${RESET}: ${f.reason}`);
      if (f.reply) console.log(`    Reply: ${truncate(f.reply, 200)}`);
    }
  }

  console.log();
}

main().catch(err => { console.error('Test error:', err); process.exit(1); });
