#!/usr/bin/env node
/**
 * test-multilingual-concurrent.js — Rainbow AI Multilingual Test Suite
 * Tests EN/MS/ZH capabilities concurrently and generates an HTML report.
 *
 * Usage:
 *   node scripts/test-multilingual-concurrent.js
 *   node scripts/test-multilingual-concurrent.js --concurrency 10 --port 3002
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CLI Args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const PORT = getArg('--port', '3002');
const CONCURRENCY = parseInt(getArg('--concurrency', '5'), 10);
const BASE = `http://localhost:${PORT}`;
const PREVIEW_API = `${BASE}/api/rainbow/preview/chat`;

// ─── Test Scenarios (18 tests) ───────────────────────────────────────
const MULTILINGUAL_TEST_SCENARIOS = [
  // ── T2 Fuzzy Matching ─────────────────────────────────────────────
  {
    id: 'fuzzy-wifi-ms',
    name: 'WiFi password (Malay keyword)',
    category: 'T2_FUZZY',
    language: 'ms',
    messages: [{ text: 'password wifi apa?' }],
    expectedIntent: 'wifi',
    expectedTier: ['T2', 'T3'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['wifi', 'password', 'kata laluan', 'rangkaian'], critical: true },
      { type: 'not_contains', values: ['error', 'undefined', 'null'], critical: false },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
  {
    id: 'fuzzy-price-ms',
    name: 'Price query (Malay keyword)',
    category: 'T2_FUZZY',
    language: 'ms',
    messages: [{ text: 'berapa harga bilik?' }],
    expectedIntent: 'pricing',
    expectedTier: ['T2', 'T3'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['RM', 'harga', 'rate', 'malam', 'price'], critical: false },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
  {
    id: 'fuzzy-wifi-zh',
    name: 'WiFi password (Chinese keyword)',
    category: 'T2_FUZZY',
    language: 'zh',
    messages: [{ text: 'wifi密码是多少？' }],
    expectedIntent: 'wifi',
    expectedTier: ['T2', 'T3'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['wifi', 'WiFi', '密码', 'password', '网络'], critical: true },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
  {
    id: 'fuzzy-price-zh',
    name: 'Price query (Chinese keyword)',
    category: 'T2_FUZZY',
    language: 'zh',
    messages: [{ text: '多少钱一晚？' }],
    expectedIntent: 'pricing',
    expectedTier: ['T2', 'T3'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['RM', '价格', '价钱', '费用', 'rate', 'price'], critical: false },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },

  // ── T3 Semantic Matching ───────────────────────────────────────────
  {
    id: 'semantic-greeting-ms',
    name: 'Greeting (Malay colloquial)',
    category: 'T3_SEMANTIC',
    language: 'ms',
    messages: [{ text: 'apa khabar' }],
    expectedIntent: 'greeting',
    expectedTier: ['T2', 'T3'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'not_contains', values: ['error', 'undefined'], critical: true },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
  {
    id: 'semantic-thanks-ms',
    name: 'Thanks (Malay)',
    category: 'T3_SEMANTIC',
    language: 'ms',
    messages: [{ text: 'terima kasih' }],
    expectedIntent: 'thanks',
    expectedTier: ['T2', 'T3'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['sama-sama', 'welcome', 'terima kasih', 'boleh', 'selamat'], critical: false },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
  {
    id: 'semantic-checkin-ms',
    name: 'Check-in query (Malay colloquial)',
    category: 'T3_SEMANTIC',
    language: 'ms',
    messages: [{ text: 'bila boleh check in?' }],
    expectedIntent: 'checkin_info',
    expectedTier: ['T2', 'T3'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['check-in', 'check in', 'daftar masuk', 'pm', 'pagi', 'petang', '2', '3'], critical: false },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
  {
    id: 'semantic-greeting-zh',
    name: 'Greeting (Chinese)',
    category: 'T3_SEMANTIC',
    language: 'zh',
    messages: [{ text: '你好' }],
    expectedIntent: 'greeting',
    expectedTier: ['T2', 'T3'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'not_contains', values: ['error', 'undefined'], critical: true },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
  {
    id: 'semantic-thanks-zh',
    name: 'Thanks (Chinese)',
    category: 'T3_SEMANTIC',
    language: 'zh',
    messages: [{ text: '谢谢' }],
    expectedIntent: 'thanks',
    expectedTier: ['T2', 'T3'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['不客气', '欢迎', '谢谢', 'welcome', '帮'], critical: false },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
  {
    id: 'semantic-availability-zh',
    name: 'Availability query (Chinese)',
    category: 'T3_SEMANTIC',
    language: 'zh',
    messages: [{ text: '有没有房间？' }],
    expectedIntent: 'availability',
    expectedTier: ['T2', 'T3'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['房间', '预订', '可用', 'available', 'book', 'Booking.com', '入住'], critical: false },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },

  // ── Common Intents ─────────────────────────────────────────────────
  {
    id: 'common-booking-ms',
    name: 'Booking enquiry (Malay)',
    category: 'COMMON_INTENTS',
    language: 'ms',
    messages: [{ text: 'Saya nak buat tempahan untuk 2 malam' }],
    expectedIntent: 'booking',
    expectedTier: ['T2', 'T3', 'T4'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['Booking.com', 'tempahan', 'menempah', 'book', 'online', 'website', 'hubungi', 'malam', 'tarikh'], critical: false },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
  {
    id: 'common-directions-ms',
    name: 'Directions (Malay)',
    category: 'COMMON_INTENTS',
    language: 'ms',
    messages: [{ text: 'Macam mana nak sampai ke sini?' }],
    expectedIntent: 'directions',
    expectedTier: ['T2', 'T3', 'T4'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['Jalan', 'jalan', 'Google Maps', 'Waze', 'bas', 'grab', 'stesen', 'MRT', 'LRT', 'Johor'], critical: false },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
  {
    id: 'common-checkout-ms',
    name: 'Checkout info (Malay)',
    category: 'COMMON_INTENTS',
    language: 'ms',
    messages: [{ text: 'Check out pukul berapa?' }],
    expectedIntent: 'checkout_info',
    expectedTier: ['T2', 'T3'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', rules: ['am', 'pagi', '11', '12', 'check-out', 'checkout'], critical: false },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
  {
    id: 'common-booking-zh',
    name: 'Booking enquiry (Chinese)',
    category: 'COMMON_INTENTS',
    language: 'zh',
    messages: [{ text: '我想预订两晚' }],
    expectedIntent: 'booking',
    expectedTier: ['T2', 'T3', 'T4'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['Booking.com', '预订', '订房', 'online', '网站', '联系', '入住', '日期', '胶囊', '退房', '晚'], critical: false },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
  {
    id: 'common-directions-zh',
    name: 'Directions (Chinese)',
    category: 'COMMON_INTENTS',
    language: 'zh',
    messages: [{ text: '请问怎么去你们那里？' }],
    expectedIntent: 'directions',
    expectedTier: ['T2', 'T3', 'T4'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      // Accept both: static address reply OR LLM asking for origin to give personalized directions
      { type: 'contains_any', values: ['地址', 'Jalan', 'Google Maps', 'Waze', '路线', '出发', '指引', '位置', '抵达', '导航', '前往'], critical: false },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
  {
    id: 'common-checkout-zh',
    name: 'Checkout info (Chinese)',
    category: 'COMMON_INTENTS',
    language: 'zh',
    messages: [{ text: '退房时间是几点？' }],
    expectedIntent: 'checkout_info',
    expectedTier: ['T2', 'T3'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['11', '12', '退房', 'check-out', 'checkout', '上午'], critical: false },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },

  // ── Code-Switching ─────────────────────────────────────────────────
  {
    id: 'mixed-wifi',
    name: 'WiFi (mixed Malay+English)',
    category: 'CODE_SWITCHING',
    language: 'mixed',
    messages: [{ text: 'wifi password apa?' }],
    expectedIntent: 'wifi',
    expectedTier: ['T2', 'T3'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['wifi', 'WiFi', 'password', 'kata laluan'], critical: true },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
  {
    id: 'mixed-booking',
    name: 'Booking (mixed Malay+English)',
    category: 'CODE_SWITCHING',
    language: 'mixed',
    messages: [{ text: 'nak book untuk 2 nights' }],
    expectedIntent: 'booking',
    expectedTier: ['T2', 'T3', 'T4'],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['Booking.com', 'book', 'tempahan', 'menempah', 'online', 'website', 'malam', 'tarikh'], critical: false },
      { type: 'response_time', max: 10000, critical: false },
    ]}],
  },
];

// ─── Concurrency Pool ────────────────────────────────────────────────
async function runWithConcurrency(tasks, limit) {
  const results = [];
  let idx = 0;
  async function runNext() {
    if (idx >= tasks.length) return;
    const i = idx++;
    results[i] = await tasks[i]();
    await runNext();
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, runNext);
  await Promise.all(workers);
  return results;
}

// ─── API Call ────────────────────────────────────────────────────────
async function sendMessage(text) {
  const t0 = Date.now();
  try {
    const res = await fetch(PREVIEW_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        sessionId: 'test_' + Math.random().toString(36).slice(2, 10),
        history: [],
      }),
    });
    const elapsed = Date.now() - t0;
    if (!res.ok) return { reply: null, elapsed, error: `HTTP ${res.status}`, data: null };
    const data = await res.json();
    return {
      reply: data.message || '',
      elapsed,
      intent: data.intent || 'unknown',
      confidence: data.confidence || 0,
      source: data.source || 'unknown',
      tier: data.tier || (data.source?.toUpperCase?.() || 'unknown'),
      model: data.model || 'unknown',
      detectedLang: data.detectedLanguage || 'unknown',
      data,
    };
  } catch (err) {
    return { reply: null, elapsed: Date.now() - t0, error: err.message, data: null };
  }
}

// ─── Validate One Turn ────────────────────────────────────────────────
function validateTurn(rules, result) {
  const ruleResults = [];
  for (const rule of rules) {
    let passed = true;
    let note = '';
    if (rule.type === 'not_empty') {
      passed = !!(result.reply && result.reply.trim());
      note = passed ? 'Response is not empty' : 'Response was empty';
    } else if (rule.type === 'contains_any') {
      const values = rule.values || rule.rules || [];
      passed = values.some(v => result.reply?.toLowerCase().includes(v.toLowerCase()));
      note = passed
        ? `Contains: "${values.find(v => result.reply?.toLowerCase().includes(v.toLowerCase()))}"`
        : `Missing: ${values.slice(0, 3).join(', ')}`;
    } else if (rule.type === 'not_contains') {
      const bad = (rule.values || []).find(v => result.reply?.toLowerCase().includes(v.toLowerCase()));
      passed = !bad;
      note = passed ? 'No forbidden keywords' : `Contains forbidden: "${bad}"`;
    } else if (rule.type === 'response_time') {
      passed = result.elapsed <= rule.max;
      note = `${result.elapsed}ms / ${rule.max}ms limit`;
    } else if (rule.type === 'intent_match') {
      passed = result.intent === rule.expected;
      note = `Expected: ${rule.expected}, Got: ${result.intent}`;
    }
    ruleResults.push({ rule, passed, note, critical: rule.critical });
  }
  return ruleResults;
}

// ─── Run Single Scenario ─────────────────────────────────────────────
async function runScenario(scenario) {
  const turnResults = [];
  for (let t = 0; t < scenario.messages.length; t++) {
    const msg = scenario.messages[t];
    const result = await sendMessage(msg.text);
    const validation = scenario.validate?.[t];
    const ruleResults = validation ? validateTurn(validation.rules, result) : [];
    const criticalFail = ruleResults.some(r => r.critical && !r.passed);
    const anyFail = ruleResults.some(r => !r.passed);
    const slow = result.elapsed > 10000;
    const status = result.error || criticalFail ? 'fail' : (slow || anyFail) ? 'warn' : 'pass';
    turnResults.push({ msg, result, ruleResults, status });
  }
  const overallStatus = turnResults.some(t => t.status === 'fail') ? 'fail'
    : turnResults.some(t => t.status === 'warn') ? 'warn' : 'pass';
  return { scenario, turnResults, overallStatus };
}

// ─── HTML Report Builder ─────────────────────────────────────────────
function buildHTMLReport(scenarioResults, durationMs) {
  const total = scenarioResults.length;
  const passed = scenarioResults.filter(r => r.overallStatus === 'pass').length;
  const warned = scenarioResults.filter(r => r.overallStatus === 'warn').length;
  const failed = scenarioResults.filter(r => r.overallStatus === 'fail').length;
  const avgTime = Math.round(
    scenarioResults.flatMap(r => r.turnResults.map(t => t.result.elapsed || 0))
      .reduce((a, b) => a + b, 0) / Math.max(1, scenarioResults.flatMap(r => r.turnResults).length)
  );

  const byCategory = {};
  for (const r of scenarioResults) {
    const cat = r.scenario.category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(r);
  }

  const statusColor = { pass: '#22c55e', warn: '#f59e0b', fail: '#ef4444' };
  const statusBg = { pass: '#dcfce7', warn: '#fef9c3', fail: '#fee2e2' };
  const statusIcon = { pass: '✅', warn: '⚠️', fail: '❌' };

  const cardStyle = (color) =>
    `style="background:${color};border-radius:8px;padding:16px;text-align:center;min-width:100px"`;

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Rainbow Multilingual Test — ${new Date().toLocaleString()}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #1e293b; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; }
  .meta { color: #64748b; font-size: 0.85rem; margin-bottom: 20px; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 28px; }
  .card { ${cardStyle('#fff')} border: 1px solid #e2e8f0; }
  .card .val { font-size: 2rem; font-weight: 700; }
  .card .lbl { font-size: 0.75rem; color: #64748b; margin-top: 4px; }
  .category { margin-bottom: 28px; }
  .category h2 { font-size: 1rem; color: #475569; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }
  .scenario { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
  .scenario-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; }
  .badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
  .scenario-name { font-weight: 600; flex: 1; }
  .lang-badge { background: #e0f2fe; color: #0369a1; font-size: 0.7rem; padding: 2px 8px; border-radius: 4px; }
  .turn { padding: 12px 16px; }
  .message { font-size: 0.85rem; color: #475569; margin-bottom: 8px; }
  .message span { font-weight: 600; color: #0f172a; }
  .response { background: #f8fafc; border-radius: 6px; padding: 10px; font-size: 0.85rem; line-height: 1.5; margin-bottom: 8px; border-left: 3px solid #94a3b8; }
  .meta-row { display: flex; gap: 10px; flex-wrap: wrap; font-size: 0.75rem; color: #64748b; margin-bottom: 8px; }
  .meta-pill { background: #f1f5f9; border-radius: 4px; padding: 2px 8px; }
  .rules { display: flex; flex-direction: column; gap: 4px; }
  .rule { display: flex; align-items: center; gap: 8px; font-size: 0.78rem; padding: 4px 8px; border-radius: 4px; }
  .rule.pass { background: #f0fdf4; color: #166534; }
  .rule.fail { background: #fef2f2; color: #991b1b; }
  .rule.warn { background: #fffbeb; color: #92400e; }
</style>
</head>
<body>
<h1>🌏 Rainbow Multilingual Test Report</h1>
<div class="meta">Generated ${new Date().toLocaleString()} · ${total} tests · ${CONCURRENCY} concurrent · Duration: ${(durationMs / 1000).toFixed(1)}s</div>

<div class="summary">
  <div class="card"><div class="val">${total}</div><div class="lbl">Total</div></div>
  <div class="card" style="border-color:#22c55e"><div class="val" style="color:#22c55e">${passed}</div><div class="lbl">Passed</div></div>
  <div class="card" style="border-color:#f59e0b"><div class="val" style="color:#f59e0b">${warned}</div><div class="lbl">Warnings</div></div>
  <div class="card" style="border-color:#ef4444"><div class="val" style="color:#ef4444">${failed}</div><div class="lbl">Failed</div></div>
  <div class="card"><div class="val">${avgTime}ms</div><div class="lbl">Avg Time</div></div>
  <div class="card" style="border-color:#6366f1"><div class="val" style="color:#6366f1">${Math.round(passed / total * 100)}%</div><div class="lbl">Pass Rate</div></div>
</div>
`;

  for (const [cat, results] of Object.entries(byCategory)) {
    html += `<div class="category"><h2>${cat} (${results.length} tests)</h2>`;
    for (const r of results) {
      const st = r.overallStatus;
      html += `
<div class="scenario">
  <div class="scenario-header" style="background:${statusBg[st]}">
    <span class="badge" style="background:${statusColor[st]};color:#fff">${statusIcon[st]} ${st.toUpperCase()}</span>
    <span class="scenario-name">${r.scenario.name}</span>
    <span class="lang-badge">${r.scenario.language}</span>
    <span class="meta-pill" style="background:#e0f2fe;color:#0369a1;font-size:0.7rem;padding:2px 8px;border-radius:4px">${r.scenario.id}</span>
  </div>`;

      for (let ti = 0; ti < r.turnResults.length; ti++) {
        const { msg, result, ruleResults } = r.turnResults[ti];
        const safeReply = (result.reply || result.error || '(no response)')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `
  <div class="turn">
    <div class="message">💬 <span>Guest:</span> ${msg.text}</div>
    <div class="response">${safeReply}</div>
    <div class="meta-row">
      <span class="meta-pill">Intent: ${result.intent || '—'}</span>
      <span class="meta-pill">Tier: ${result.source || '—'}</span>
      <span class="meta-pill">Conf: ${result.confidence?.toFixed?.(2) || '—'}</span>
      <span class="meta-pill">Lang: ${result.detectedLang || '—'}</span>
      <span class="meta-pill">Time: ${result.elapsed}ms</span>
      <span class="meta-pill">Model: ${result.model || '—'}</span>
    </div>
    <div class="rules">`;
        for (const rv of ruleResults) {
          const rc = rv.passed ? 'pass' : (rv.critical ? 'fail' : 'warn');
          html += `<div class="rule ${rc}">${rv.passed ? '✓' : '✗'} [${rv.rule.type}] ${rv.note}</div>`;
        }
        html += `    </div>
  </div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }

  html += `</body></html>`;
  return html;
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  // Check server is up
  try {
    const ping = await fetch(`${BASE}/health`);
    if (!ping.ok) throw new Error(`Status ${ping.status}`);
  } catch (err) {
    console.error(`❌ Cannot connect to server at ${BASE}: ${err.message}`);
    process.exit(1);
  }

  const startTime = Date.now();
  const GREEN  = '\x1b[32m';
  const YELLOW = '\x1b[33m';
  const RED    = '\x1b[31m';
  const CYAN   = '\x1b[36m';
  const DIM    = '\x1b[2m';
  const RESET  = '\x1b[0m';

  console.log(`\n${CYAN}═══ Rainbow Multilingual Test — ${new Date().toLocaleTimeString()} ═══${RESET}`);
  console.log(`${DIM}Server: ${BASE} | Tests: ${MULTILINGUAL_TEST_SCENARIOS.length} | Concurrency: ${CONCURRENCY}${RESET}\n`);

  const tasks = MULTILINGUAL_TEST_SCENARIOS.map(s => () => runScenario(s));
  const scenarioResults = await runWithConcurrency(tasks, CONCURRENCY);
  const durationMs = Date.now() - startTime;

  // Print results
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const r of scenarioResults) {
    const st = r.overallStatus;
    counts[st]++;
    const icon = st === 'pass' ? `${GREEN}✓${RESET}` : st === 'warn' ? `${YELLOW}⚠${RESET}` : `${RED}✗${RESET}`;
    const t0 = r.turnResults[0];
    const time = t0?.result?.elapsed ?? 0;
    const timeColor = time > 10000 ? YELLOW : DIM;
    console.log(`${icon} [${r.scenario.category.padEnd(14)}] ${r.scenario.id.padEnd(18)} ${DIM}(${r.scenario.language})${RESET} ${timeColor}${time}ms${RESET}`);
    console.log(`  ${DIM}Q: ${r.scenario.messages[0].text}${RESET}`);
    const reply = t0?.result?.reply || t0?.result?.error || '(empty)';
    console.log(`  A: ${reply.slice(0, 110)}${reply.length > 110 ? '…' : ''}`);
    const fails = r.turnResults.flatMap(t => t.ruleResults.filter(rv => !rv.passed));
    for (const f of fails) console.log(`  ${YELLOW}⚠ [${f.rule.type}] ${f.note}${RESET}`);
    console.log();
  }

  const total = scenarioResults.length;
  const pct = Math.round(counts.pass / total * 100);
  const summaryColor = counts.fail > 0 ? RED : counts.warn > 0 ? YELLOW : GREEN;
  console.log(`${CYAN}═══ Summary ═══${RESET}`);
  console.log(`${summaryColor}Pass: ${counts.pass}/${total} (${pct}%) | Warn: ${counts.warn} | Fail: ${counts.fail} | Duration: ${(durationMs / 1000).toFixed(1)}s${RESET}\n`);

  // Save HTML report
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `rainbow-multilingual-${ts}.html`;
  const reportDir = path.join(__dirname, '..', 'src', 'public', 'reports', 'autotest');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, filename);
  fs.writeFileSync(reportPath, buildHTMLReport(scenarioResults, durationMs), 'utf8');
  console.log(`${GREEN}✓ Report saved:${RESET} ${reportPath}`);
  console.log(`  ${DIM}View at: ${BASE}/reports/autotest/${filename}${RESET}\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
