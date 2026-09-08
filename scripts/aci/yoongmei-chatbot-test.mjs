#!/usr/bin/env node
/**
 * yoongmei-chatbot-test.mjs — End-to-end chatbot test for the yoongmei profile.
 *
 * Sends real messages through POST /chat (the webchat pipeline) and asserts:
 *   - HTTP status matches expected
 *   - intent classification matches expected category
 *   - reply body contains at least one required keyword
 *
 * Usage:
 *   node scripts/aci/yoongmei-chatbot-test.mjs
 *   node scripts/aci/yoongmei-chatbot-test.mjs --verbose
 *   BASE_URL=http://localhost:3003 node scripts/aci/yoongmei-chatbot-test.mjs
 *
 * Env:
 *   BASE_URL   — target server (default: http://5.223.54.57:3003)
 *   VERBOSE=1  — print reply snippet per test
 *
 * Exit: 0 = all pass, 1 = some fail, 2 = fatal/connection error.
 */

import { parseArgs } from 'node:util';

const BASE_URL = (process.env.BASE_URL ?? 'http://5.223.54.57:3003').replace(/\/$/, '');
const PROFILE  = 'yoongmei';
const SESSION  = `aci-yoongmei-${Date.now()}`;

const { values: flags } = parseArgs({
  options: { verbose: { type: 'boolean', short: 'v', default: false } },
  strict: false,
});
const VERBOSE = flags.verbose || process.env.VERBOSE === '1';

// ─── test cases ──────────────────────────────────────────────────────────────
//
// expectIntents  — any one match is a pass (intent OR action fallback)
// expectKeywords — at least one must appear in reply (case-insensitive)
// expectStatus   — defaults to 200
//
const TESTS = [
  // Greetings
  {
    label: 'EN greeting',
    message: 'Hello',
    expectIntents: ['greeting'],
    expectKeywords: ['Rainbow', 'Yoong Mei', 'logistics', 'freight'],
  },
  {
    label: 'MS greeting',
    message: 'Hai selamat pagi',
    expectIntents: ['greeting'],
    expectKeywords: ['Rainbow', 'Yoong Mei', 'logistik', 'pengangkutan'],
  },
  {
    label: 'ZH greeting',
    message: '你好',
    expectIntents: ['greeting'],
    expectKeywords: ['Rainbow', '永美', '货运', '物流'],
  },

  // Transport / Quote enquiries
  {
    label: 'EN pallets to Singapore',
    message: 'I have 5 pallets to send from JB to Singapore, can you help?',
    expectIntents: ['transport_enquiry', 'pricing_query', 'singapore', 'services_query'],
    expectKeywords: ['Singapore', 'customs', 'FTL', 'LTL', 'info@yoongmei', 'quote', '+60'],
  },
  {
    label: 'EN cargo to Thailand — price',
    message: 'How much does it cost to ship cargo from Johor to Thailand?',
    expectIntents: ['transport_enquiry', 'pricing_query', 'thailand', 'services_query'],
    expectKeywords: ['Thailand', 'Hat Yai', 'quote', 'info@yoongmei', 'rate', '+60'],
  },
  {
    label: 'MS transport — berapa harga ke Penang',
    message: 'Saya nak hantar barang dari Selangor ke Penang, berapa harga?',
    expectIntents: ['transport_enquiry', 'pricing_query'],
    expectKeywords: ['harga', 'kadar', 'info@yoongmei', 'FTL', 'LTL', 'sebut harga'],
  },
  {
    label: 'ZH pricing — 新山到新加坡运费',
    message: '从新山到新加坡运费多少？',
    expectIntents: ['transport_enquiry', 'pricing_query', 'singapore'],
    expectKeywords: ['新加坡', '报价', '运费', 'info@yoongmei', '联系', '+60'],
  },

  // Services
  {
    label: 'EN services query',
    message: 'What services do you offer?',
    expectIntents: ['services_query', 'services'],
    expectKeywords: ['Cross-Border', 'Warehousing', 'Customs', 'LCL', 'FCL', 'FTL'],
  },
  {
    label: 'ZH services — 提供什么服务',
    message: '你们提供什么服务？',
    expectIntents: ['services_query', 'services'],
    expectKeywords: ['跨境', '仓储', '清关', 'LCL', 'FCL'],
  },

  // Singapore route
  {
    label: 'EN Singapore cross-border route',
    message: 'Do you deliver to Singapore from Johor Bahru?',
    expectIntents: ['singapore', 'transport_enquiry', 'services_query'],
    expectKeywords: ['Singapore', 'customs', 'GST', 'JB', 'Johor'],
  },

  // Warehousing
  {
    label: 'EN warehousing query',
    message: 'Do you have a warehouse? I need to store my goods.',
    expectIntents: ['warehousing', 'services_query'],
    expectKeywords: ['warehouse', 'storage', '3PL', 'Masai', 'Puchong', 'Klang'],
  },

  // Customs
  {
    label: 'EN customs clearance from China',
    message: 'Can you handle customs clearance for import from China?',
    expectIntents: ['customs', 'services_query'],
    expectKeywords: ['customs', 'declaration', 'import', 'info@yoongmei'],
  },

  // Company info
  {
    label: 'EN company info — office location',
    message: 'Where is your office located?',
    expectIntents: ['company_info', 'contact'],
    expectKeywords: ['Masai', 'Johor', 'Puchong', '+60', 'info@yoongmei'],
  },
  {
    label: 'MS company info — hubungi',
    message: 'Bagaimana nak hubungi Yoong Mei?',
    expectIntents: ['company_info', 'contact'],
    expectKeywords: ['Masai', 'Johor', 'Puchong', '+60', 'info@yoongmei'],
  },

  // Escalate human
  {
    label: 'EN escalate — speak to staff',
    message: 'I want to speak to a real person urgently',
    expectIntents: ['escalate_human'],
    expectKeywords: ['+60', 'info@yoongmei', 'staff', 'team', 'contact'],
  },
  {
    label: 'MS escalate — aduan barang rosak',
    message: 'Ada aduan, barang saya rosak semasa penghantaran',
    expectIntents: ['escalate_human'],
    expectKeywords: ['+60', 'info@yoongmei', 'pasukan', 'hubungi'],
  },

  // Thanks
  {
    label: 'EN thanks',
    message: 'Thank you, that is very helpful',
    expectIntents: ['thanks'],
    expectKeywords: ['welcome', 'info@yoongmei', '+60'],
  },
  {
    label: 'ZH thanks',
    message: '谢谢你的帮助',
    expectIntents: ['thanks'],
    expectKeywords: ['不客气', 'info@yoongmei', '+60'],
  },

  // Profile isolation guard
  {
    label: 'Unknown profile returns 404',
    message: 'hello',
    overrideProfile: 'nonexistent-profile-xyz',
    expectStatus: 404,
    expectIntents: [],
    expectKeywords: [],
  },
];

// ─── runner ───────────────────────────────────────────────────────────────────

const results = [];
let passed = 0, failed = 0, fatal = 0;

function note(msg) { process.stderr.write(msg + '\n'); }

async function chat(message, sessionId, profile) {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId, profile, test: true }),
    signal: AbortSignal.timeout(20_000),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, data };
}

async function runTest(tc, index) {
  const sid     = `${SESSION}-t${index}`;
  const profile = tc.overrideProfile ?? PROFILE;
  const label   = tc.label;

  let res;
  try {
    res = await chat(tc.message, sid, profile);
  } catch (err) {
    fatal++;
    results.push({ label, pass: false, fatal: true, error: String(err) });
    note(`  ✗ [FATAL] ${label} — ${err.message}`);
    return;
  }

  const { status, data } = res;
  const issues = [];

  // HTTP status
  const expectStatus = tc.expectStatus ?? 200;
  if (status !== expectStatus) {
    issues.push(`HTTP ${status} (expected ${expectStatus})`);
  }

  // Intent
  if (tc.expectIntents?.length && status === 200) {
    const gotIntent = data?.intent ?? data?.result?.intent ?? '';
    const ok = tc.expectIntents.some(i => gotIntent === i || gotIntent?.startsWith(i));
    if (!ok) issues.push(`intent="${gotIntent}" not in [${tc.expectIntents.join('|')}]`);
  }

  // Keywords in reply
  if (tc.expectKeywords?.length && status === 200) {
    const reply = (data?.reply ?? data?.result?.reply ?? '').toLowerCase();
    const found = tc.expectKeywords.some(k => reply.includes(k.toLowerCase()));
    if (!found) {
      issues.push(`reply missing all keywords: [${tc.expectKeywords.slice(0, 5).join('|')}]`);
    }
  }

  const pass = issues.length === 0;
  if (pass) passed++; else failed++;

  results.push({
    label,
    pass,
    status,
    intent: data?.intent ?? data?.result?.intent ?? null,
    issues: issues.length ? issues : undefined,
    ...(VERBOSE ? { reply: data?.reply ?? null } : {}),
  });

  const icon = pass ? '✓' : '✗';
  note(`  ${icon} ${label}${pass ? '' : ' — ' + issues.join('; ')}`);
  if (VERBOSE && data?.reply) {
    const snippet = data.reply.slice(0, 130);
    note(`    └ ${snippet}${data.reply.length > 130 ? '…' : ''}`);
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  note(`\nyoongmei chatbot tests — ${BASE_URL}`);
  note(`profile: ${PROFILE} | session: ${SESSION} | tests: ${TESTS.length}\n`);

  // Connectivity probe
  try {
    const probe = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(5_000) });
    note(`server reachable (HTTP ${probe.status})\n`);
  } catch (err) {
    process.stdout.write(JSON.stringify({
      ok: false, error: `server unreachable at ${BASE_URL}: ${err.message}`,
    }) + '\n');
    process.exit(2);
  }

  for (let i = 0; i < TESTS.length; i++) {
    await runTest(TESTS[i], i);
    if (i < TESTS.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  const total = TESTS.length;
  note(`\n─── ${passed}/${total} passed · ${failed} failed · ${fatal} fatal ───\n`);

  process.stdout.write(JSON.stringify({
    ok: failed === 0 && fatal === 0,
    profile: PROFILE,
    target:  BASE_URL,
    summary: { total, passed, failed, fatal },
    tests:   results,
  }, null, 2) + '\n');

  process.exit(failed > 0 || fatal > 0 ? 1 : 0);
}

main().catch(err => {
  process.stdout.write(JSON.stringify({ ok: false, fatal: String(err) }) + '\n');
  process.exit(2);
});
